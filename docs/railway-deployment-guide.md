# Deploying ALINA on Railway

Railway builds the root `Dockerfile`, provisions PostgreSQL as a plugin, and
runs the database migrations from the same image before each deployment. The
retrieval backend (deepset / Haystack) and the identity provider (Amazon
Cognito) stay where they are; only the Next.js container and its database
move to Railway.

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

Set these on the ALINA service (Settings > Variables). Values marked *ref*
are Railway reference variables and must be typed exactly as shown.

| Variable | Value | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` *(ref)* | Private-network URL, no egress cost. |
| `DB_SSL` | `false` | Railway's internal Postgres endpoint has no TLS. Without this the production default enforces TLS against the bundled AWS RDS CA and every connection fails. |
| `AUTH_SECRET` | `openssl rand -base64 33` | Mark as sealed. |
| `AUTH_COGNITO_ID` | Cognito app client ID | |
| `AUTH_COGNITO_SECRET` | Cognito app client secret | Mark as sealed. |
| `AUTH_COGNITO_ISSUER` | `https://cognito-idp.<region>.amazonaws.com/<user-pool-id>` | |
| `AUTH_COGNITO_DOMAIN` | `https://<prefix>.auth.<region>.amazoncognito.com` | |
| `AUTH_URL` | `https://<service>.up.railway.app` | The public domain Railway generates, or the custom domain. |
| `AUTH_TRUST_HOST` | `true` | Railway terminates TLS in front of the container. |
| `AUTH_POST_LOGOUT_URL` | `https://<service>.up.railway.app/login` | |
| `HAYSTACK_API_KEY` | deepset API key | Mark as sealed. |
| `HAYSTACK_WORKSPACE` | workspace name | |
| `HAYSTACK_PIPELINE` | pipeline name | |
| `HAYSTACK_WORKSPACE_ID` | workspace UUID | |
| `HAYSTACK_PIPELINE_ID` | pipeline UUID | |
| `HAYSTACK_INDEX` | index name | |

Optional: `COGNITO_ADMIN_GROUP` (defaults to `Admins`), `DB_POOL_MAX`,
`DB_STATEMENT_TIMEOUT_MS`.

Do not set `PORT`; the image listens on 3000 and the domain's target port
must be 3000 (step 3).

## 3. Networking and health

1. Settings > Networking > Generate Domain, target port **3000**.
2. Copy the generated domain into `AUTH_URL` and `AUTH_POST_LOGOUT_URL`.
3. In the Cognito app client, add the callback
   `https://<domain>/api/auth/callback/cognito` and the sign-out URL
   `https://<domain>/login`.
4. The health check (`/api/health/ready`) queries the database, so the
   first deployment turns healthy only after the Postgres service is up and
   the pre-deploy migration has succeeded.

## 4. Resources

Document conversion spawns LibreOffice inside the container. Allow at least
2 GB of memory and 1 vCPU for the ALINA service, matching the ECS sizing in
the AWS runbook. Build time is several minutes because the runtime stage
installs `libreoffice-writer`.

## 5. Migrations

`railway.toml` sets the pre-deploy command to `node scripts/migrate.mjs`.
It runs in the new image with the service variables, takes a PostgreSQL
advisory lock, applies the versioned SQL in `drizzle/`, and only then does
Railway switch traffic. A failed migration aborts the deployment and keeps
the previous version live.

To run it by hand: Railway service > Deployments > the three-dot menu on the
latest deployment > **Run a command**, then `node scripts/migrate.mjs`.

## 6. Differences from the AWS deployment

- Conversation history, users, projects, and file scope records live in
  Railway's PostgreSQL rather than in the EC AWS tenant. Confirm this is
  acceptable for the data involved before using it beyond a pilot.
- There is no NAT or private egress; the container reaches Cognito and
  deepset over Railway's shared egress.
- The AWS RDS CA bundle is still baked into the image (harmless) but not
  used because `DB_SSL=false`.
- Everything in `docs/aws-production-runbook.md` about ECS task
  definitions, Secrets Manager, and the ALB does not apply.
