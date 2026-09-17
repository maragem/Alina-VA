# Diagram B — Application Components View

> Next.js App Router app (`src/app`). Route protection is per-handler (`requireAppUser` / `requireUserId`); there is **no** `middleware.ts`. All Haystack calls are server-side proxies to `api.cloud.deepset.ai`.

```mermaid
flowchart TB
    subgraph BROWSER["Browser (React 19 UI)"]
      T1["Global chat<br/>/global"]
      T2["Projects<br/>/projects, /projects/[projectId]"]
      T3["Documents<br/>/documents"]
      T4["Admin /admin · Login /login"]
    end

    subgraph SERVER["Next.js server layer (TypeScript, App Router route handlers)"]
      direction TB
      AUTH["Auth.js v5 (src/auth.ts)<br/>Cognito OIDC · JWT session, 8h<br/>seeds admin from cognito:groups<br/>guards: requireAppUser / requireUserId"]

      subgraph CHATAPI["Chat / retrieval API"]
        SS["POST /api/haystack/search-stream<br/>proxies chat-stream (SSE), 90s idle watchdog,<br/>builds entitlement filters, persists answer+sources"]
        CONV["/api/conversations (+ /[id]/attachments)<br/>creates search_session, temp-file upload"]
        FB["POST/PATCH /api/haystack/feedback<br/>deepset v2 feedback"]
        UAT["POST /api/uat/search-stream<br/>eval harness, fresh session"]
      end

      subgraph DOCAPI["Document / file API"]
        FILES["GET/POST /api/haystack/files<br/>upload (≤50MB), LibreOffice→DOCX,<br/>attach access metadata, write_mode=OVERWRITE"]
        FILEID["GET/DELETE/PATCH /api/haystack/files/[fileId]<br/>+ /preview, /resolve, index status"]
        PFILES["POST /api/projects/[projectId]/files<br/>assign/sync access metadata"]
      end

      REPO["Drizzle ORM repositories<br/>(src/db)"]
      ACCESS["haystackAccessMetadata.ts<br/>builds meta.alina_project_ids / authority_rank filter"]
    end

    subgraph DB["PostgreSQL (RDS) — authoritative for identity, ownership, scope"]
      direction TB
      D1["users · external_identities"]
      D2["projects · project_memberships"]
      D3["managed_files (scope) · project_files"]
      D4["conversations (haystack_search_session_id)<br/>messages (attachments jsonb) · message_sources"]
      D5["conversation_attachments"]
    end

    subgraph HAYSTACK["Haystack / deepset Cloud (SaaS) — retrieval projection"]
      QP["Query pipeline (agent + tools)"]
      IP["Indexing pipeline"]
      OS[("OpenSearch document store<br/>chunks + metadata + embeddings")]
      QP --- OS
      IP --- OS
    end

    T1 --> SS
    T1 --> CONV
    T1 --> FB
    T2 --> PFILES
    T2 --> CONV
    T3 --> FILES
    T3 --> FILEID
    T4 --> AUTH

    SS --> AUTH
    FILES --> AUTH
    SS --> ACCESS
    SS --> REPO
    CONV --> REPO
    FB --> REPO
    FILES --> REPO
    FILEID --> REPO
    PFILES --> REPO
    PFILES --> ACCESS

    REPO --> DB
    AUTH -->|OIDC| COG["Cognito"]

    SS -->|chat-stream + filters| QP
    CONV -->|temporary_files| IP
    FILES -->|files write OVERWRITE| IP
    FILEID -->|files meta / delete| OS
    PFILES -->|files meta| OS
    FB -->|feedback v2| QP

    classDef ui fill:#eaf2ff,stroke:#1f5fbf,color:#0b2545;
    classDef api fill:#eef7ee,stroke:#2e8b2e,color:#0b350b;
    classDef db fill:#f3f0ff,stroke:#6b3fa0,color:#2a1a4a;
    classDef hay fill:#fff2e0,stroke:#cc7a00,color:#5a3600;
    class T1,T2,T3,T4 ui;
    class AUTH,SS,CONV,FB,UAT,FILES,FILEID,PFILES,REPO,ACCESS api;
    class D1,D2,D3,D4,D5 db;
    class QP,IP,OS,COG hay;
```

## Responsibility ownership

| Concern | Owner |
|---|---|
| Authentication & session | Auth.js + Cognito OIDC (`src/auth.ts`); JWT session, 8h; admin seeded from `cognito:groups` |
| Authorization | Per-handler `requireAppUser` / `requireUserId` (no middleware) |
| Chat streaming & answer persistence | `/api/haystack/search-stream` (SSE proxy → deepset chat-stream) |
| Entitlement filter construction | `haystackAccessMetadata.ts` (`meta.alina_project_ids ∈ [global, projectId]`, optional `authority_rank`) |
| Identity, ownership, scope, history | PostgreSQL via Drizzle (authoritative) |
| Retrieval + chunk/metadata/embedding store | Haystack / deepset Cloud + OpenSearch (projection) |
| Upload + format conversion | `/api/haystack/files` (LibreOffice → DOCX, ≤50MB) |

## Caption

The three UI tabs — global chat (`/global`), projects (`/projects`), and documents (`/documents`) — are React pages that call TypeScript route handlers in the same Next.js server; there is no separate backend and no route middleware, so every handler enforces auth itself via `requireAppUser`/`requireUserId` on top of an Auth.js Cognito-OIDC JWT session. The chat handler `/api/haystack/search-stream` builds the per-user/per-project entitlement filter, proxies the request to the deepset chat-stream pipeline as Server-Sent Events, and persists the assistant message and its citations back to PostgreSQL. PostgreSQL (via Drizzle ORM) is authoritative for users, projects, memberships, file ownership/scope, conversations, messages, and citations, while Haystack/deepset Cloud with its OpenSearch document store holds only the retrieval projection (chunks, metadata, embeddings). Document and file operations — upload with LibreOffice→DOCX conversion, metadata edits, deletion, and project assignment — are separate handlers under `/api/haystack/files*` and `/api/projects/[projectId]/files` that write to both PostgreSQL and Haystack file metadata.

## Could not confirm from the sources

- **Project-level authorization completeness** — CLAUDE.md flags that file/document CRUD and project-scoped mutations may lack full project-role checks (pending Aug-11 audit); the handlers use `requireAppUser`/`requireUserId` but per-route project-role enforcement was not exhaustively verified here.
- **`alina_scope` vs `file_id` filter field** — the app builds filters on `meta.alina_project_ids` / `meta.authority_rank`, but CLAUDE.md states no custom `alina_*` fields are relied upon for retrieval, and the query pipeline's `search_in_file` merges on intrinsic `file_id`. These three sources disagree on the exact metadata field; drawn as "access metadata filter" without asserting one canonical field.
- **`search_sessions` table** — does **not** exist as a standalone table (contrary to CLAUDE.md); the session UUID lives on `conversations.haystack_search_session_id`. Shown that way.
- **UAT harness placement in production** — `/api/uat/search-stream` exists in the codebase; whether it is exposed in the production deployment is not evidenced.
- Exact React component composition per tab is not detailed (page-level routes only).
