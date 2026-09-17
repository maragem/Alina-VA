> **Superseded (September 2026):** authentication no longer uses Amazon Cognito. Accounts, passwords and roles are managed inside ALINA (PostgreSQL `users` table, Auth.js Credentials provider). Skip every Cognito step and the `AUTH_COGNITO_*` / `AUTH_POST_LOGOUT_URL` variables below; see the README section "Authentication and User Management".

# AWS production deployment

This guide deploys ALINA with the AWS console. It deliberately does not require
Terraform, CDK, RDS Proxy, or an additional application dependency.

## Target architecture

- ECR stores one immutable image tagged with the Git commit SHA.
- An internet-facing HTTPS ALB forwards traffic to two ECS Fargate tasks in
  private subnets across two Availability Zones.
- RDS PostgreSQL 17 runs privately in Multi-AZ mode. Only the ECS security group
  can reach port 5432.
- ECS receives secrets from Secrets Manager at task startup.
- A one-off ECS task runs `node scripts/migrate.mjs` before each service update.
- CloudWatch receives application, migration, ALB, ECS, and RDS signals.

## Values to prepare

Choose an AWS Region and record:

```text
AWS account ID
Region
VPC ID
Two public subnet IDs (ALB)
Two private subnet IDs with NAT egress (ECS and RDS)
Public application hostname
ACM certificate ARN for that hostname
```

Private ECS subnets need outbound HTTPS through a NAT gateway because ALINA
calls Cognito and Haystack. RDS must not be publicly accessible.

## 1. Create security groups

Open **VPC > Security groups** and create:

1. `alina-alb`: inbound TCP 443 from the allowed user networks; outbound TCP
   3000 to `alina-ecs`.
2. `alina-ecs`: inbound TCP 3000 from `alina-alb`; outbound TCP 5432 to
   `alina-rds`; outbound TCP 443 to the internet through the private subnets'
   NAT route.
3. `alina-rds`: inbound TCP 5432 from `alina-ecs`; no public inbound rule.

AWS may require temporarily broad outbound rules while groups reference each
other. Tighten them after all three groups exist.

## 2. Create RDS PostgreSQL

Open **RDS > Databases > Create database**:

1. Select **Standard create**, **PostgreSQL**, version **17**.
2. Select the **Production** template and **Multi-AZ DB instance deployment**.
3. Set identifier `alina-prod`, database name `alina`, and let RDS manage the
   master password in Secrets Manager.
4. Choose the application VPC, the two private subnets, **Public access: No**,
   and security group `alina-rds`.
5. Enable storage encryption with the approved KMS key, deletion protection,
   automated backups/PITR, Performance Insights, and Enhanced Monitoring.
6. Start with a modest instance and GP3 storage; enable storage autoscaling.

Record the RDS endpoint and secret ARN. The application validates TLS using the
AWS RDS CA bundle already embedded in its Docker image.

## 3. Create application secrets

Open **Secrets Manager > Store a new secret > Other type of secret**. Create
one JSON secret named `alina/prod/application`:

```json
{
  "AUTH_SECRET": "...",
  "AUTH_COGNITO_SECRET": "...",
  "HAYSTACK_API_KEY": "...",
  "DB_PASSWORD": "..."
}
```

Use the password from the RDS-managed secret. Do not put secrets in the image or
task definition environment section. A DB password rotation requires updating
this value and forcing a new ECS deployment because RDS Proxy is not used.

## 4. Create and push the ECR image

Open **ECR > Repositories > Create repository**, create private repository
`alina`, enable scan-on-push and immutable tags. Select **View push commands**
and run the displayed login commands. Build from the repository root:

```bash
export IMAGE_TAG=$(git rev-parse --short=12 HEAD)
docker build --platform linux/amd64 -t alina:$IMAGE_TAG .
docker tag alina:$IMAGE_TAG ACCOUNT.dkr.ecr.REGION.amazonaws.com/alina:$IMAGE_TAG
docker push ACCOUNT.dkr.ecr.REGION.amazonaws.com/alina:$IMAGE_TAG
```

Use the SHA tag in ECS, never `latest`.

## 5. Create IAM roles

Open **IAM > Roles**:

1. Create `alina-ecs-execution` for **Elastic Container Service Task** with
   `AmazonECSTaskExecutionRolePolicy` plus permission to read only
   `alina/prod/application` and the RDS secret.
2. Create `alina-ecs-task` for the same trusted service. It needs no RDS API
   permission; database access is network and password based.

## 6. Create the ECS task definition

Open **ECS > Task definitions > Create**:

1. Family: `alina-prod`; launch type: **AWS Fargate**; Linux x86_64.
2. Start with 1 vCPU and 2 GB memory because the image includes LibreOffice.
3. Assign the execution and task roles above.
4. Container name: `alina`; image: the ECR SHA URI; port mapping: TCP 3000.
5. Send logs to `/ecs/alina-prod` with the `awslogs` driver.
6. Add non-secret environment values:

```text
NODE_ENV=production
NEXT_TELEMETRY_DISABLED=1
AUTH_TRUST_HOST=true
AUTH_COGNITO_ID=...
AUTH_COGNITO_ISSUER=...
AUTH_COGNITO_DOMAIN=...
AUTH_POST_LOGOUT_URL=https://HOST/login
HAYSTACK_WORKSPACE=...
HAYSTACK_PIPELINE=...
HAYSTACK_WORKSPACE_ID=...
HAYSTACK_PIPELINE_ID=...
HAYSTACK_INDEX=...
HAYSTACK_ACCESS_METADATA_FILTERS_ENABLED=true
DB_HOST=RDS_ENDPOINT
DB_PORT=5432
DB_NAME=alina
DB_USER=RDS_USERNAME
DB_SSL=true
DB_POOL_MAX=5
```

7. Under **Secrets**, map `AUTH_SECRET`, `AUTH_COGNITO_SECRET`,
   `HAYSTACK_API_KEY`, and `DB_PASSWORD` to their corresponding JSON keys in
   `alina/prod/application`.

The maximum number of ECS tasks must remain known. Keep:

$$
DB\_POOL\_MAX \times ECS\_MAX\_TASKS < RDS\_MAX\_CONNECTIONS - 20
$$

## 7. Run the initial migration

Open **ECS > Clusters**, create `alina-prod`, then choose **Run new task**:

1. Use the `alina-prod` task definition, Fargate, private subnets, no public IP,
   and security group `alina-ecs`.
2. Expand **Container overrides** and set the command to:

```text
node,scripts/migrate.mjs
```

3. Run the task and wait for **Stopped / exit code 0**. Check its CloudWatch
   log before proceeding. The script takes a PostgreSQL advisory lock, so two
   accidental migration tasks cannot migrate concurrently.

Repeat this step before every ECS service update. Never run migrations from the
application container startup command.

## 8. Create ALB and ECS service

1. In **EC2 > Load balancers**, create an internet-facing Application Load
   Balancer in the two public subnets with security group `alina-alb`.
2. Add HTTPS listener 443 with the ACM certificate. Redirect HTTP 80 to HTTPS
   if port 80 is allowed.
3. Create an IP target group on port 3000. Health check path:
   `/api/health/ready`; success code 200; interval 30 seconds; timeout 5 seconds.
4. Set ALB idle timeout above the maximum Haystack stream duration (start at
   300 seconds). Disable sticky sessions.
5. In **ECS > Clusters > alina-prod**, create a Fargate service using two tasks,
   the private subnets, no public IP, `alina-ecs`, and the target group.
6. Enable deployment circuit breaker with automatic rollback and set a
   deregistration delay long enough for active streams (start at 300 seconds).

Register the final HTTPS callback and sign-out URLs in the Cognito app client.

## 9. Deployment sequence

For every release:

1. Build, scan, and push a new immutable SHA image.
2. Register a task-definition revision pointing to that SHA.
3. Run that revision once with command `node,scripts/migrate.mjs`.
4. Continue only when the migration exits 0.
5. Update the ECS service to the revision and wait for ALB targets to become
   healthy.
6. Test login, create a conversation, refresh it, and delete it.

Schema changes must follow expand/migrate/contract so old and new ECS tasks can
run concurrently during a rolling deployment.

### One-time Haystack access-metadata cutover

`HAYSTACK_ACCESS_METADATA_FILTERS_ENABLED` no longer gates anything in code —
metadata filtering is unconditional, because the pipeline's `files` request
field was found not to be honored by the retriever at all. Run these one-off
ECS command overrides against the same task definition, in order:

```text
node,scripts/backfill-haystack-access-metadata.mjs
node,scripts/backfill-haystack-access-metadata.mjs,--apply
node,scripts/backfill-haystack-access-metadata.mjs,--check
node,scripts/backfill-haystack-access-metadata.mjs,--reindex
```

The first command is a dry run. Review its global, project, unmanaged, and drift
counts before applying. The check must exit 0 with `driftCount: 0`. The reindex
must report every file as scheduled with an empty `failedReindexFileIds` list;
wait until the index has no pending files. Run these tasks against the
production RDS database; it is authoritative for project assignments. Only
deploy the metadata-filtering code revision after a clean check and completed
reindex — otherwise queries will filter out documents whose Haystack metadata
hasn't been backfilled yet. Roll back by redeploying the previous code
revision; the additive metadata can safely remain in Haystack either way.

## 10. Operations

Create CloudWatch alarms for ALB 5xx, unhealthy targets, ECS task restarts,
RDS CPU/storage/connections, and failed migration tasks. Retain application
logs for the approved period and do not log message content, sources, emails,
tokens, or secrets. Before risky migrations, create a manual RDS snapshot.
Regularly restore a snapshot into a temporary database and verify the history.