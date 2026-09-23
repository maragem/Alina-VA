# ALINA

Procurement intelligence assistant for DIGIT.R3: source-grounded answers over
a curated procurement corpus, project-scoped retrieval, document management,
and an LLM wiki read by the agent over MCP (see `docs/llmwiki.md`).

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

To deploy on Railway instead, see
[`docs/railway-deployment-guide.md`](docs/railway-deployment-guide.md). The
repository ships a `railway.toml` that selects the Dockerfile builder, runs
the migrations as a pre-deploy command, and points the health check at
`/api/health/ready`. Set `DB_SSL=false` with the Railway Postgres plugin.

The AWS guides above still describe Amazon Cognito. Authentication has since
moved into the application (see below); ignore the Cognito steps and the
`AUTH_COGNITO_*` variables in those documents.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Authentication and User Management

ALINA manages its own user accounts in PostgreSQL. Auth.js provides the
session (an encrypted JWT in an HTTP-only cookie, valid for eight hours) and
a Credentials provider verifies the email and password against the `users`
table. There is no external identity provider and no self-registration:
administrators create every account from the **Admin** tab.

### How accounts work

- An administrator creates a user with an email, a display name, a role
  (`admin` or `member`) and receives a generated temporary password to hand
  over. The user must replace it at first sign-in before reaching any page.
- Passwords are hashed with scrypt (`node:crypto`, N=2^17) and must be at
  least 12 characters long. Users change their own password from the
  **Password** link in the header.
- Five failed sign-ins lock an account for 15 minutes. An administrator can
  clear the lock immediately by issuing a new temporary password.
- Disabling an account blocks sign-in and invalidates the existing session on
  the next request, because every request re-reads the account from the
  database. Conversations and files are kept.
- At least one active administrator must always remain; the last one cannot
  be demoted or disabled.

### First administrator

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (optionally `ADMIN_NAME`) in the
environment. When the server starts and the database contains no
administrator, it creates that account with a temporary password that must
be changed at first sign-in. Afterwards the variables are ignored, so they
can stay in place or be removed. Further administrators are promoted from the
Admin tab.

### Local environment

Use `.env.example` as the variable reference and create an ignored `.env.local`.
Generate the Auth.js secret with:

```bash
openssl rand -base64 33
```

The minimum set is:

```bash
AUTH_SECRET=...
ADMIN_EMAIL=you@example.eu
ADMIN_PASSWORD=a-temporary-password-of-12-chars-or-more
DATABASE_URL=postgresql://alina:alina-local@localhost:5432/alina
```

All application pages, Haystack routes, and UAT routes require authentication.
Only `/login`, `/api/auth/**`, `/api/health/**`, and static assets are public.
The `/admin` page and the `/api/admin/**` routes additionally require the
`admin` role.

### Deployed runtime

Supply `AUTH_SECRET` at container runtime and store it as a secret; do not
add it to the Docker image. Behind a reverse proxy or load balancer (ECS with
an ALB, Railway) set `AUTH_TRUST_HOST=true` and `AUTH_URL` to the public
HTTPS URL.

Accounts that existed before local authentication (created by the previous
Cognito integration) have no password. They appear in the Admin tab with a
**No password** badge; use **Set password** to give them an email, if
missing, and a temporary password.

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
