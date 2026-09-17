> **Superseded (September 2026):** authentication no longer uses Amazon Cognito. Accounts, passwords and roles are managed inside ALINA (PostgreSQL `users` table, Auth.js Credentials provider). Skip every Cognito step and the `AUTH_COGNITO_*` / `AUTH_POST_LOGOUT_URL` variables below; see the README section "Authentication and User Management".

# Diagram A — Deployment / Infrastructure View

> Trust boundaries: **OCTO AWS tenant** (application), **DIGIT.B1 AI@EC / Haystack SaaS tenant** (retrieval), **GPT@EC** (LLM gateway). Region is operator-chosen and not hardcoded (TBC).

```mermaid
flowchart TB
    User["End-user browser<br/>(HTTPS)"]

    subgraph OCTO["OCTO AWS tenant — application VPC (2 AZs)"]
      direction TB

      subgraph PUB["Public subnets (2 AZs)"]
        ALB["Application Load Balancer<br/>internet-facing, HTTPS :443 (ACM/TLS termination)<br/>optional :80 → :443 redirect<br/>target group: IP, :3000, health /api/health/ready"]
        NAT["NAT Gateway<br/>(egress for private subnets)"]
      end

      subgraph PRIV["Private subnets (2 AZs) — no public IP"]
        subgraph ECS["ECS Fargate service — family alina-prod (2 tasks)"]
          TASK["Container 'alina' :3000<br/>Next.js prod runtime (node server.js)<br/>1 vCPU / 2 GB, LibreOffice bundled<br/>image from ECR (git-SHA tag)"]
          MIG["One-off migration task<br/>same image/task-def<br/>override: node scripts/migrate.mjs<br/>(advisory-locked)"]
        end
        RDS[("Amazon RDS PostgreSQL 17<br/>Multi-AZ, private, no public access<br/>id alina-prod / db alina<br/>KMS-encrypted, TLS (RDS CA bundle)")]
      end

      ECR["ECR repo 'alina'<br/>private, immutable tags,<br/>scan-on-push"]
      SM["Secrets Manager<br/>alina/prod/application<br/>(AUTH_SECRET, AUTH_COGNITO_SECRET,<br/>HAYSTACK_API_KEY, DB_PASSWORD)<br/>+ RDS-managed master password"]
      CW["CloudWatch Logs<br/>/ecs/alina-prod<br/>(app, migration, ALB, ECS, RDS signals)"]
      COG["Amazon Cognito<br/>Managed Login (OIDC IdP)<br/>callback /api/auth/callback/cognito"]
    end

    subgraph EC_HAY["DIGIT.B1 AI@EC — Haystack Enterprise / deepset Cloud (SaaS)"]
      HAY["Haystack query + indexing pipelines<br/>(agent, retrievers, rerankers)<br/>api.cloud.deepset.ai (v1; v2 for feedback)"]
      OS[("OpenSearch document store<br/>index ALINA-V0.3 (query) /<br/>ALINA-V0.4 (indexing writer) — mismatch, TBC")]
      HAY --- OS
    end

    subgraph GPTEC["GPT@EC — EC LLM gateway"]
      GPT["ECGPT gateway<br/>api.tech.ec.europa.eu/ecgpt/v1<br/>model gpt-5.1 (/chat/completions)"]
    end

    User -->|HTTPS| ALB
    ALB -->|:3000| TASK

    TASK -->|:5432 TLS, private| RDS
    MIG -->|:5432 TLS| RDS
    TASK -. reads at start .-> SM
    MIG -. reads at start .-> SM
    TASK -->|logs| CW
    MIG -->|logs| CW
    ECR -->|image pull| TASK

    TASK -->|:443 via NAT| NAT
    NAT -->|OIDC| COG
    NAT -->|HTTPS: search-stream, doc/file CRUD, feedback| HAY

    HAY -->|LLM tool-calling| GPT

    classDef octo fill:#eaf2ff,stroke:#1f5fbf,stroke-width:2px,color:#0b2545;
    classDef echay fill:#eafbea,stroke:#2e8b2e,stroke-width:2px,color:#0b350b;
    classDef gpt fill:#fff2e0,stroke:#cc7a00,stroke-width:2px,color:#5a3600;
    classDef store fill:#f3f0ff,stroke:#6b3fa0,stroke-width:2px,color:#2a1a4a;

    class ALB,NAT,TASK,MIG,ECR,SM,CW,COG octo;
    class RDS store;
    class HAY,OS echay;
    class GPT gpt;
```

## Caption

ALINA runs as a single Next.js container image (pulled from a private ECR repository, git-SHA tagged) on ECS Fargate in the OCTO AWS tenant, fronted by an internet-facing HTTPS Application Load Balancer that terminates TLS in the public subnets and forwards to two Fargate tasks on port 3000 in private subnets. Application state persists in a Multi-AZ RDS PostgreSQL 17 instance reached over TLS on 5432; database schema changes run as a one-off migration task built from the same image with a `node scripts/migrate.mjs` command override. Secrets (auth, Haystack API key, DB password) are injected from AWS Secrets Manager at task start, container logs go to the CloudWatch log group `/ecs/alina-prod`, and all outbound calls from the private subnets — OIDC to Amazon Cognito and HTTPS to the Haystack SaaS backend — egress through a NAT gateway. Retrieval itself lives in the DIGIT.B1 AI@EC / Haystack (deepset Cloud) SaaS tenant, whose pipelines call the GPT@EC gateway (`api.tech.ec.europa.eu/ecgpt/v1`, model `gpt-5.1`) for the agent's LLM steps.

## Could not confirm from the sources

- **AWS Region** — chosen and recorded by the operator; no region is hardcoded in the repo.
- **Haystack/deepset base URL** — confirmed in the application code as `https://api.cloud.deepset.ai` (v1 for files/pipelines/chat-stream/search_sessions/temporary_files; v2 for feedback). The deployment runbook itself does not name it. Whether this SaaS instance is the "Haystack Enterprise" tenant operated by DIGIT.B1 (vs. public deepset Cloud) is not evidenced.
- **Whether Cognito is in the same OCTO AWS account** as the app resources — it is an AWS-native service configured for this app, but account ownership/segregation is not stated; drawn inside the OCTO tenant on that assumption.
- **NAT gateway count** (one shared vs one per AZ) — docs say private subnets egress via NAT but do not specify the number.
- **Index-name mismatch** — the indexing pipeline's writer targets `ALINA-V0.4` while the query pipeline reads `ALINA-V0.3`; both YAMLs flag this as an intended-but-not-yet-completed bump. Shown as a discrepancy, not resolved.
- **GPT@EC network path** — whether the Haystack→GPT@EC call is tenant-internal to AI@EC or traverses the public internet is not evidenced.
- No Terraform/CloudFormation/CDK exists; infrastructure is described in console-driven prose only, so resource wiring is transcribed from the runbook rather than from declarative IaC.
