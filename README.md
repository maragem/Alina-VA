# ALINA

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Local PostgreSQL

Conversation history requires PostgreSQL. Start the local database and apply
the versioned migrations before starting Next.js:

```bash
docker compose up -d postgres
DATABASE_URL=postgresql://alina:alina-local@localhost:5432/alina pnpm db:migrate
pnpm dev
```

The named Docker volume preserves data between restarts. To intentionally
erase local history, run `docker compose down -v`.

For production, follow the AWS console walkthrough in
[`docs/aws-production-runbook.md`](docs/aws-production-runbook.md). The same
Docker image runs both the ECS service and the one-off migration task; no IaC
or RDS Proxy is required.

For a simpler, beginner-friendly AWS console path focused on ECS Express mode,
Cognito, and RDS, see
[`docs/aws-simple-deployment-guide.md`](docs/aws-simple-deployment-guide.md).

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Authentication Configuration

ALINA uses Amazon Cognito Managed Login as its identity provider and Auth.js
for the application session. Cognito owns credentials and account recovery;
ALINA stores an encrypted JWT session in an HTTP-only cookie. The session lasts
eight hours and no application database is required for this authentication
slice.

### Cognito user pool

Create a Cognito user pool with these settings:

1. Use email addresses as sign-in identifiers.
2. Disable self-registration so pilot users are created by an administrator.
3. Enable email-based account recovery and use Cognito's default password
   policy.
4. Add an AWS-managed prefix domain and set its branding version to **Managed
   login**.
5. Create a **Traditional web application** app client with a client secret.
6. Under **Managed login > Styles**, create a style and assign it to the app
   client. Without an assigned style, Cognito displays `Login pages
   unavailable` even when the domain and OAuth settings are valid.
7. Enable only the authorization-code grant and the `openid`, `email`, and
   `profile` scopes.
8. Select the Cognito user pool as the identity provider.

Register these local URLs on the app client:

```text
Allowed callback URL: http://localhost:3000/api/auth/callback/cognito
Allowed sign-out URL: http://localhost:3000/login
```

Add the corresponding HTTPS URLs for the deployed application. A separate app
client for production is recommended before the pilot expands.

Create pilot users from the Cognito console. Cognito sends a temporary password
and requires users to replace it on first sign-in.

### Local environment

Use `.env.example` as the variable reference and create an ignored `.env.local`.
Generate the Auth.js secret with:

```bash
openssl rand -base64 33
```

Set the following values:

```bash
AUTH_SECRET=...
AUTH_COGNITO_ID=...
AUTH_COGNITO_SECRET=...
AUTH_COGNITO_ISSUER=https://cognito-idp.<region>.amazonaws.com/<user-pool-id>
AUTH_COGNITO_DOMAIN=https://<prefix>.auth.<region>.amazoncognito.com
AUTH_POST_LOGOUT_URL=http://localhost:3000/login
```

`AUTH_COGNITO_ISSUER` uses the user pool ID, not the app client ID. The domain
is the Managed Login domain. Signing out first clears the Auth.js cookie and
then redirects directly to the configured Cognito `/logout` URL so the Cognito
browser session is also terminated. Auth.js accepts this external redirect only
when it exactly matches the server-generated logout URL.

All application pages, Haystack routes, and UAT routes require authentication.
Only `/login`, `/api/auth/**`, and static assets are public.

### ECS runtime

Supply all authentication variables at container runtime; do not add them to
the Docker image. Store `AUTH_SECRET` and `AUTH_COGNITO_SECRET` in AWS Secrets
Manager and set `AUTH_TRUST_HOST=true` because ECS is behind a reverse proxy or
load balancer. Use the externally visible HTTPS login URL for
`AUTH_POST_LOGOUT_URL` and register the exact callback and sign-out URLs in
Cognito.

JWT sessions are intentionally stateless for this pilot. Disabling a Cognito
account does not invalidate an ALINA cookie that was already issued; it expires
within eight hours. Immediate administrative revocation belongs in the later
database-backed user and role implementation.

## Haystack Configuration

Set these server-only environment variables when running or deploying ALINA:

```bash
HAYSTACK_API_KEY=...
HAYSTACK_WORKSPACE=workspace-name
HAYSTACK_PIPELINE=pipeline-name
HAYSTACK_WORKSPACE_ID=workspace-uuid
HAYSTACK_PIPELINE_ID=pipeline-uuid
HAYSTACK_INDEX=index-name
HAYSTACK_ACCESS_METADATA_FILTERS_ENABLED=true
```

`HAYSTACK_WORKSPACE` and `HAYSTACK_PIPELINE` are names used by the v1 Chat
Stream endpoint. `HAYSTACK_PIPELINE_ID` is used to create the v1 search session
that persists chat history; both UUID variables are also used by the v2
feedback endpoint. The application accepts `DEEPSET_API_KEY` as an alternative
to `HAYSTACK_API_KEY`.

`HAYSTACK_ACCESS_METADATA_FILTERS_ENABLED` is now informational only — the
search-stream route always filters by `meta.alina_project_ids`, since the
pipeline's `files` request field is not honored by its retriever. Run
`pnpm haystack:access:check` after bulk file changes to confirm zero drift.

The `/documents` workspace lists files from the workspace Files API and
enriches them with `FAILED` and `NO_DOCUMENTS` status checks against
`HAYSTACK_INDEX`. All deepset requests are made by Next.js API routes so
credentials remain on the server.

Project retrieval uses the app-owned Haystack metadata fields `alina_scope`
and `alina_project_ids`. PostgreSQL remains authoritative for assignments. For
an existing workspace, deploy with the filter flag disabled, run
`pnpm haystack:access:dry-run`, `pnpm haystack:access:apply`, and
`pnpm haystack:access:check` against the target database, then run
`pnpm haystack:access:reindex`. Enable the flag only after the check reports
zero drift and the reindex has no pending or failed files. Global files carry a
`global` token in `alina_project_ids`; project files carry their assigned
project IDs. The disabled path preserves the legacy project file-ID allowlist
during rollout.

The document upload panel accepts a batch of PDF, DOC, DOCX, ODT, XLSX, TXT,
and MD files up to 50 MB each. DOC and ODT inputs are converted server-side
with LibreOffice and stored with a DOCX filename; both the source and converted
files must remain within the 50 MB limit. Local development outside Docker
therefore requires `soffice` on `PATH`. The browser sends one file at a time to
the local `POST /api/haystack/files` route, which forwards it to the deepset
Files API with `write_mode=OVERWRITE`. Optional comma-separated tags are stored as
`meta.tags`; an optional hierarchy classification is stored as
`meta.authority_category`. Classifications in Levels 1 through 4 also store
the corresponding integer in `meta.authority_rank`; Procurement documents and
Templates are classified as Unranked. The user interface translates these
metadata values into the selected document classification.

The upload, list, preview, hierarchy-update, and deletion flows are
implemented. The Update action replaces a file's content while preserving its
existing name, tags, and hierarchy metadata. Changing a row's Data hierarchy
updates only the hierarchy metadata through the server-side Files API proxy.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
