> **Superseded (September 2026):** authentication no longer uses Amazon Cognito. Accounts, passwords and roles are managed inside ALINA (PostgreSQL `users` table, Auth.js Credentials provider). Skip every Cognito step and the `AUTH_COGNITO_*` / `AUTH_POST_LOGOUT_URL` variables below; see the README section "Authentication and User Management".

# Simple AWS Deployment Guide

This guide explains the simplest practical way to deploy ALINA on a new AWS
environment when you are not deeply familiar with AWS yet.

The goal is to keep the setup easy to reason about:

- ECS with Fargate to run the containerized app
- ECS Express mode to simplify service creation
- Cognito for authentication
- RDS PostgreSQL for the database
- Secrets Manager for sensitive configuration

This is a console-first guide. It does not require Terraform, CDK, or any
other infrastructure-as-code tool.

## What Fargate means

Fargate is the easiest ECS runtime for this project.

With ECS on Fargate:

- you deploy a Docker image
- AWS runs the container for you
- you do not manage EC2 instances yourself

For this application, that is the right default unless you have a strong reason
to optimize cost or infrastructure at a lower level.

## Recommended deployment order

Do the setup in this order:

1. Create the RDS PostgreSQL database.
2. Create the Cognito user pool and app client.
3. Create the application secrets in Secrets Manager.
4. Build and push the Docker image to ECR.
5. Create the ECS service in Express mode.
6. Run the database migration as a one-off ECS task.
7. Test login, application access, and database-backed features.

This order matters. ECS depends on values produced by RDS, Cognito, ECR, and
Secrets Manager.

## High-level architecture

The target setup is:

- an ECR repository containing the ALINA image
- an ECS Fargate service running the ALINA container
- a public Application Load Balancer in front of ECS
- a private PostgreSQL database on RDS
- a Cognito Managed Login page for authentication
- application secrets injected into ECS from Secrets Manager

The application already expects this model. The Docker image listens on port
`3000`, authentication is handled by Cognito, and PostgreSQL is required for
conversation persistence.

## 1. Create RDS first

Create the database before creating ECS. ECS needs the database endpoint and
credentials.

Recommended starting choices:

- Engine: `PostgreSQL`
- Version: `17`
- Creation method: `Standard create`
- Template: `Production` if available
- DB name: `alina`
- Public access: `No`
- Deploy it in the same VPC that ECS will use

What to record after creation:

- RDS endpoint hostname
- database name
- database username
- database password or the secret ARN if AWS manages it in Secrets Manager

Keep the database private. Do not make RDS publicly reachable just to simplify
the setup.

## 2. Create Cognito

Create a Cognito user pool for authentication.

Recommended choices:

- Sign-in identifier: email
- Self-registration: disabled
- App client type: traditional web application
- Generate a client secret: yes
- Managed login: enabled
- OAuth flow: authorization code grant only
- Scopes: `openid`, `email`, `profile`

Create and note these values:

- Cognito user pool ID
- Cognito app client ID
- Cognito app client secret
- Cognito domain URL
- Region

The application expects these runtime values:

- `AUTH_COGNITO_ID`
- `AUTH_COGNITO_SECRET`
- `AUTH_COGNITO_ISSUER`
- `AUTH_COGNITO_DOMAIN`

`AUTH_COGNITO_ISSUER` must use the user pool ID, in this format:

```text
https://cognito-idp.<region>.amazonaws.com/<user-pool-id>
```

`AUTH_COGNITO_DOMAIN` is the Cognito Managed Login domain URL.

### Callback and sign-out URLs

You do not need the final public URL before creating Cognito. Create the user
pool and app client first, then come back and add the production URLs once the
public endpoint exists.

For local development, keep the localhost URLs already configured in Cognito.
For production, register these URLs in the Cognito app client once you know the
public ECS or load balancer URL:

```text
Allowed callback URL: https://<your-public-url>/api/auth/callback/cognito
Allowed sign-out URL: https://<your-public-url>/login
```

Important points:

- the callback URL must match exactly
- the sign-out URL must match exactly
- include the callback path exactly as shown: `/api/auth/callback/cognito`
- if you do not yet know the final URL, leave the production entries for later
- if Cognito Managed Login styling is available, assign a style to the app
  client; otherwise Cognito can show a login page unavailable error

## 3. Create the application secrets

Create a JSON secret in Secrets Manager, for example named:

```text
alina/prod/application
```

Add at least these keys:

```json
{
  "AUTH_SECRET": "...",
  "AUTH_COGNITO_SECRET": "...",
  "HAYSTACK_API_KEY": "...",
  "DB_PASSWORD": "..."
}
```

Notes:

- `AUTH_SECRET` is the Auth.js secret used by the application session layer
- `AUTH_COGNITO_SECRET` is the Cognito app client secret
- `HAYSTACK_API_KEY` is the deepset or Haystack API key
- `DB_PASSWORD` is the PostgreSQL password used by the app

Do not bake these values into the Docker image.

## 4. Push the image to ECR

Create a private ECR repository, for example named `alina`.

Then:

1. build the Docker image from the repository root
2. tag it with an immutable tag such as the Git commit SHA
3. push it to ECR

Avoid using `latest` for deployments. A fixed image tag makes rollbacks and
troubleshooting much simpler.

## 5. Create the ECS service in Express mode

ECS Express mode is a good fit here because it reduces the number of screens and
manual decisions.

Use Express mode to create the service, but remember that Cognito and RDS are
still separate services that must already exist.

### What to enter in Express mode

For the container image:

- Image URI: use the full ECR image URI you pushed earlier

For the execution role:

- choose the ECS task execution role, likely the existing role named
  `alina-ecs-execution-role` if it already has the correct permissions

The execution role is used by ECS to:

- pull the image from ECR
- send logs to CloudWatch
- read secrets from Secrets Manager

If Express mode also asks for a task role, use the application task role there,
for example `alina-ecs-task-role`.

### Environment variables to set in ECS

Non-secret variables:

```text
NODE_ENV=production
NEXT_TELEMETRY_DISABLED=1
AUTH_TRUST_HOST=true
AUTH_URL=https://<your-public-url>
AUTH_COGNITO_ID=...
AUTH_COGNITO_ISSUER=https://cognito-idp.<region>.amazonaws.com/<user-pool-id>
AUTH_COGNITO_DOMAIN=https://<prefix>.auth.<region>.amazoncognito.com
AUTH_POST_LOGOUT_URL=https://<your-public-url>/login
HAYSTACK_WORKSPACE=...
HAYSTACK_PIPELINE=...
HAYSTACK_WORKSPACE_ID=...
HAYSTACK_PIPELINE_ID=...
HAYSTACK_INDEX=...
DB_HOST=<rds-endpoint>
DB_PORT=5432
DB_NAME=alina
DB_USER=<db-user>
DB_SSL=true
DB_POOL_MAX=5
```

Secret variables from Secrets Manager:

- `AUTH_SECRET`
- `AUTH_COGNITO_SECRET`
- `HAYSTACK_API_KEY`
- `DB_PASSWORD`

The container listens on port `3000`.

## 6. Networking and security groups

Keep the networking simple, but not insecure.

Recommended model:

- the load balancer is public
- ECS runs in the same VPC as RDS, in private subnets with a NAT gateway
  route for outbound HTTPS
- RDS is private

The ECS tasks must be able to resolve DNS and make outbound TCP 443 requests
to the Cognito issuer and Managed Login domain, as well as to Haystack. They
must not have a public IP; use a NAT gateway (or an equivalent controlled
egress path) from each private subnet instead. Without this egress, Auth.js
cannot fetch Cognito's OIDC discovery document and sign-in fails with
`TypeError: fetch failed`.

Security group intent:

- the load balancer accepts HTTPS from users
- ECS accepts port `3000` from the load balancer
- RDS accepts port `5432` from ECS only

If you already have a previous ECS deployment in the same environment, you may
already have reusable security groups or IAM roles. Reuse them only if you are
sure they match the new architecture.

## 7. Health check

Configure the load balancer health check path to:

```text
/api/health/ready
```

This endpoint checks database readiness, not just whether the Node.js process is
alive. That makes it the correct production readiness check for this app.

## 8. Run the database migration

Do not rely on application startup to migrate the database.

After creating the ECS task definition or service, run a one-off ECS task using
the same image and same environment, but override the command with:

```text
node scripts/migrate.mjs
```

In the ECS console, this override must be passed as two separate arguments,
not one single string. Depending on the UI variant, enter one of these forms:

```text
node,scripts/migrate.mjs
```

or:

```text
["node","scripts/migrate.mjs"]
```

If you enter a single value like `node scripts/migrate.mjs`, ECS can forward it
as one argument and Node.js will look for a file named `node scripts/migrate.mjs`,
which causes a `MODULE_NOT_FOUND` error.

Wait until the task finishes successfully before considering the deployment
complete.

This step is required because ALINA uses PostgreSQL-backed persistence and the
schema must exist before the application starts using it.

## 9. Validate the deployment

Once the service is up, test in this order:

1. open the public URL
2. confirm redirection to Cognito login
3. sign in successfully
4. confirm the application loads after login
5. confirm `/api/health/ready` returns success
6. create a conversation or another DB-backed action to prove PostgreSQL works

If all six succeed, the first deployment is in a good state.

## 10. Common failure points

If authentication fails, check first:

- `AUTH_COGNITO_ID`
- `AUTH_COGNITO_SECRET`
- `AUTH_COGNITO_ISSUER`
- `AUTH_COGNITO_DOMAIN`
- `AUTH_URL`
- exact callback and sign-out URLs in Cognito
- ECS private-subnet DNS and outbound HTTPS through NAT

From a temporary diagnostic task using the same networking configuration,
verify that the issuer is reachable:

```bash
curl -fsS "$AUTH_COGNITO_ISSUER/.well-known/openid-configuration"
```

If this request fails, fix the ECS route table, NAT gateway, security-group
egress, or network ACL before changing Auth.js configuration.

For `OAuthCallbackError`, the most common root causes are:

- callback URL mismatch (most often missing `/api/auth/callback/cognito`)
- `AUTH_COGNITO_ID` and `AUTH_COGNITO_SECRET` not from the same app client
- `AUTH_COGNITO_ISSUER` pointing to a different user pool than the app client
- wrong public base URL in `AUTH_URL`

If the service starts but the app is not healthy, check first:

- whether ECS can read secrets from Secrets Manager
- whether the image URI is correct
- whether the migration task was run
- whether ECS can reach RDS
- whether the ECS security group is allowed to reach port `5432` on RDS
- whether `DB_HOST`, `DB_USER`, and `DB_PASSWORD` are correct

## 11. Recommended first deployment path

For a first deployment, the most efficient path is:

1. create RDS
2. create Cognito
3. create the secret in Secrets Manager
4. push the image to ECR
5. create the ECS service in Express mode
6. choose the existing ECS execution role if it already has ECR, logs, and
   secrets access
7. run the migration task
8. test login and a DB-backed action

That is the simplest path that still respects how this application is built.

## Related documentation

For the more operations-oriented production walkthrough, see
[aws-production-runbook.md](./aws-production-runbook.md).
