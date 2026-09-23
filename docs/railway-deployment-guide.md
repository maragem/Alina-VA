# Deploying ALINA on Railway

Railway builds the root `Dockerfile`, provisions PostgreSQL as a plugin, and
runs the database migrations from the same image before each deployment. The
retrieval backend (deepset / Haystack) stays where it is; the Next.js
container, its database, and the user accounts live on Railway.

Configuration lives in [`railway.toml`](../railway.toml): Dockerfile builder,
pre-deploy migration command, health check path, and restart policy.

## 1. Create the project

1. In Railway, create a new project from the GitHub repository. Railway
   detects the `Dockerfile` and uses it (the `railway.toml` pins this).
2. Add a **PostgreSQL** service to the same project. Railway exposes its
   connection strings as reference variables on the database service.
3. Pick the **EU West (Amsterdam)** region for both services if the
   deployment must stay in the EU.

## 2. Service variables

A Railway project here has two services: the **ALINA** app service (built
from this repository) and the **Postgres** database service (the plugin).
Every variable below is set on the **ALINA** service (select it, then
Variables). The Postgres service manages its own variables; do not edit
them. Values marked *ref* are Railway reference variables that read from
the Postgres service and must be typed exactly as shown.

| Variable | Set on | Value | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | ALINA | `${{Postgres.DATABASE_URL}}` *(ref)* | Private-network URL, no egress cost. If the Postgres service has a different name, use that name in place of `Postgres`. |
| `DB_SSL` | ALINA | `false` | Railway's internal Postgres endpoint has no TLS. Without this the production default enforces TLS against the bundled AWS RDS CA and every connection fails. |
| `AUTH_SECRET` | ALINA | `openssl rand -base64 33` | Mark as sealed. |
| `AUTH_URL` | ALINA | `https://<service>.up.railway.app` | The public domain Railway generates, or the custom domain. |
| `AUTH_TRUST_HOST` | ALINA | `true` | Optional since the app trusts the forwarded host by default; harmless to set. |
| `ADMIN_EMAIL` | ALINA | first administrator's email | Used once, when the database has no admin yet. |
| `ADMIN_PASSWORD` | ALINA | temporary password, 12+ characters | Mark as sealed. Must be changed at first sign-in. |
| `ADMIN_NAME` | ALINA | display name | Optional, defaults to "ALINA administrator". |
| `HAYSTACK_API_KEY` | ALINA | deepset API key | Mark as sealed. |
| `HAYSTACK_WORKSPACE` | ALINA | workspace name | |
| `HAYSTACK_PIPELINE` | ALINA | pipeline name | |
| `HAYSTACK_WORKSPACE_ID` | ALINA | workspace UUID | |
| `HAYSTACK_PIPELINE_ID` | ALINA | pipeline UUID | |
| `HAYSTACK_INDEX` | ALINA | index name | |

Optional, also on ALINA: `DB_POOL_MAX`, `DB_STATEMENT_TIMEOUT_MS`, and
`WIKI_MCP_TOKEN` (enables the knowledge-base MCP endpoint for the pipeline;
see `docs/llmwiki.md`).

Nothing is set on the Postgres service. Railway's `PGHOST`, `PGUSER`,
`PGPASSWORD` and similar variables on that service are read-only outputs
that the `${{Postgres.DATABASE_URL}}` reference resolves against.

Do not set `PORT`; the image listens on 3000 and the domain's target port
must be 3000 (step 3).

## 3. Networking and health

1. Settings > Networking > Generate Domain, target port **3000**.
2. Copy the generated domain into `AUTH_URL`.
3. The health check (`/api/health/ready`) queries the database, so the
   first deployment turns healthy only after the Postgres service is up and
   the pre-deploy migration has succeeded.

## 4. First sign-in

1. Open the domain. You land on the sign-in page.
2. Sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`. You are asked to choose a
   personal password before anything else.
3. Open the **Admin** tab and create accounts for the other users. Each
   creation shows a generated temporary password once; pass it on securely.
   Users replace it at their first sign-in.

The bootstrap only runs when the database holds no administrator, so
`ADMIN_EMAIL` and `ADMIN_PASSWORD` can be deleted from the service after
this step, or left in place; they have no further effect either way.

## 5. Resources

Document conversion spawns LibreOffice inside the container. Allow at least
2 GB of memory and 1 vCPU for the ALINA service, matching the ECS sizing in
the AWS runbook. Build time is several minutes because the runtime stage
installs `libreoffice-writer`.

## 6. Migrations

`railway.toml` sets the pre-deploy command to `node scripts/migrate.mjs`.
It runs in the new image with the service variables, takes a PostgreSQL
advisory lock, applies the versioned SQL in `drizzle/`, and only then does
Railway switch traffic. A failed migration aborts the deployment and keeps
the previous version live.

To run it by hand: Railway service > Deployments > the three-dot menu on the
latest deployment > **Run a command**, then `node scripts/migrate.mjs`.

## 7. Differences from the AWS deployment

- Conversation history, users, password hashes, projects, and file scope
  records live in Railway's PostgreSQL rather than in the EC AWS tenant.
  Confirm this is acceptable for the data involved before using it beyond a
  pilot.
- There is no NAT or private egress; the container reaches deepset over
  Railway's shared egress.
- The AWS RDS CA bundle is still baked into the image (harmless) but not
  used because `DB_SSL=false`.
- Everything in `docs/aws-production-runbook.md` about ECS task
  definitions, Secrets Manager, the ALB, and Cognito does not apply.
