import { existsSync, readFileSync } from "node:fs";
import pg from "pg";

const { Pool } = pg;
const APPLY = process.argv.includes("--apply");
const CHECK = process.argv.includes("--check");
const REINDEX = process.argv.includes("--reindex");
const API_KEY =
  process.env.HAYSTACK_API_KEY?.trim() ??
  process.env.DEEPSET_API_KEY?.trim() ??
  "";
const WORKSPACE = process.env.HAYSTACK_WORKSPACE?.trim() ?? "";
const PAGE_SIZE = 100;
const UPDATE_BATCH_SIZE = 100;
const REINDEX_BATCH_SIZE = 10;
const SCOPE_FIELD = "alina_scope";
const PROJECT_IDS_FIELD = "alina_project_ids";

if ([APPLY, CHECK, REINDEX].filter(Boolean).length > 1) {
  throw new Error("Use only one of --apply, --check, or --reindex.");
}
if (!API_KEY || !WORKSPACE) {
  throw new Error("Set HAYSTACK_API_KEY and HAYSTACK_WORKSPACE.");
}

function positiveInteger(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function databaseConfig() {
  const connectionString = process.env.DATABASE_URL?.trim();
  const useTls = process.env.DB_SSL
    ? process.env.DB_SSL === "true"
    : process.env.NODE_ENV === "production";
  const certificate =
    process.env.DB_SSL_CA?.replaceAll("\\n", "\n") ??
    (existsSync("/app/aws-rds-global-bundle.pem")
      ? readFileSync("/app/aws-rds-global-bundle.pem", "utf8")
      : undefined);
  const shared = {
    application_name: "alina-haystack-access-backfill",
    max: 1,
    connectionTimeoutMillis: positiveInteger("DB_CONNECTION_TIMEOUT_MS", 5_000),
    statement_timeout: positiveInteger("DB_STATEMENT_TIMEOUT_MS", 30_000),
    ...(useTls
      ? {
          ssl: {
            rejectUnauthorized: true,
            ...(certificate ? { ca: certificate } : {}),
          },
        }
      : {}),
  };
  if (connectionString) return { ...shared, connectionString };

  const host = process.env.DB_HOST?.trim();
  const database = process.env.DB_NAME?.trim();
  const user = process.env.DB_USER?.trim();
  const password = process.env.DB_PASSWORD;
  if (!host || !database || !user || !password) {
    throw new Error(
      "Set DATABASE_URL or DB_HOST, DB_NAME, DB_USER, and DB_PASSWORD.",
    );
  }
  return {
    ...shared,
    host,
    port: positiveInteger("DB_PORT", 5432),
    database,
    user,
    password,
  };
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedProjectIds(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === "string"))].sort()
    : [];
}

function metadataMatches(meta, expected) {
  return (
    meta[SCOPE_FIELD] === expected[SCOPE_FIELD] &&
    JSON.stringify(normalizedProjectIds(meta[PROJECT_IDS_FIELD])) ===
      JSON.stringify(expected[PROJECT_IDS_FIELD])
  );
}

async function listHaystackFiles() {
  const files = [];
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  while (true) {
    const response = await fetch(
      `https://api.cloud.deepset.ai/api/v1/workspaces/${encodeURIComponent(WORKSPACE)}/files?${params}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
      },
    );
    if (!response.ok)
      throw new Error(`Haystack file listing failed (${response.status}).`);
    const payload = record(await response.json());
    if (!Array.isArray(payload.data) || typeof payload.has_more !== "boolean") {
      throw new Error("Haystack returned an invalid file listing.");
    }
    files.push(...payload.data);
    if (!payload.has_more) return files;

    const lastFile = record(payload.data.at(-1));
    const afterValue = text(lastFile.created_at);
    const afterFileId = text(lastFile.file_id);
    if (!afterValue || !afterFileId)
      throw new Error("Invalid pagination cursor.");
    params.set("after_value", afterValue);
    params.set("after_file_id", afterFileId);
  }
}

async function loadDatabaseProjection(pool) {
  const result = await pool.query(`
    select
      mf.file_id,
      mf.scope,
      coalesce(
        array_agg(pf.project_id::text order by pf.project_id)
          filter (where pf.project_id is not null),
        array[]::text[]
      ) as project_ids
    from managed_files mf
    left join project_files pf on pf.file_id = mf.file_id
    group by mf.file_id, mf.scope
  `);
  return new Map(
    result.rows.map((row) => [
      row.file_id,
      {
        [SCOPE_FIELD]: row.scope,
        [PROJECT_IDS_FIELD]:
          row.scope === "global"
            ? ["global"]
            : normalizedProjectIds(row.project_ids),
      },
    ]),
  );
}

async function updateBatch(entries) {
  const body = Object.fromEntries(
    entries.map(({ fileId, expected }) => [fileId, expected]),
  );
  const response = await fetch(
    `https://api.cloud.deepset.ai/api/v1/workspaces/${encodeURIComponent(WORKSPACE)}/files/update-meta`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok)
    throw new Error(`Bulk metadata update failed (${response.status}).`);
  const result = record(await response.json());
  if (result.failed_count !== 0) {
    throw new Error(
      `Bulk metadata update failed for ${result.failed_count} files.`,
    );
  }
  return Number(result.updated_count) || 0;
}

async function reindexFile(fileId) {
  const response = await fetch(
    `https://api.cloud.deepset.ai/api/v1/workspaces/${encodeURIComponent(WORKSPACE)}/indexes/${encodeURIComponent(process.env.HAYSTACK_INDEX?.trim() ?? "")}/files/${encodeURIComponent(fileId)}/reindex`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Reindex failed for ${fileId} (${response.status}).`);
  }
}

const pool = new Pool(databaseConfig());
try {
  const [files, projection] = await Promise.all([
    listHaystackFiles(),
    loadDatabaseProjection(pool),
  ]);
  const drift = [];
  let unmanagedCount = 0;

  for (const candidate of files) {
    const file = record(candidate);
    const fileId = text(file.file_id);
    if (!fileId) throw new Error("Haystack returned a file without an ID.");
    const managedProjection = projection.get(fileId);
    if (!managedProjection) unmanagedCount += 1;
    const expected = managedProjection ?? {
      [SCOPE_FIELD]: "global",
      [PROJECT_IDS_FIELD]: ["global"],
    };
    if (!metadataMatches(record(file.meta), expected)) {
      drift.push({ fileId, expected });
    }
  }

  let updatedCount = 0;
  if (APPLY) {
    for (let index = 0; index < drift.length; index += UPDATE_BATCH_SIZE) {
      updatedCount += await updateBatch(
        drift.slice(index, index + UPDATE_BATCH_SIZE),
      );
    }
  }

  let reindexedCount = 0;
  const failedReindexFileIds = [];
  if (REINDEX) {
    if (!process.env.HAYSTACK_INDEX?.trim()) {
      throw new Error("Set HAYSTACK_INDEX before using --reindex.");
    }
    const fileIds = files.map((candidate) => text(record(candidate).file_id));
    for (let index = 0; index < fileIds.length; index += REINDEX_BATCH_SIZE) {
      const batch = fileIds.slice(index, index + REINDEX_BATCH_SIZE);
      const results = await Promise.allSettled(batch.map(reindexFile));
      results.forEach((result, resultIndex) => {
        if (result.status === "fulfilled") reindexedCount += 1;
        else failedReindexFileIds.push(batch[resultIndex]);
      });
    }
  }

  console.log(
    JSON.stringify({
      mode: APPLY ? "apply" : CHECK ? "check" : REINDEX ? "reindex" : "dry-run",
      haystackFileCount: files.length,
      managedFileCount: projection.size,
      unmanagedHaystackFileCount: unmanagedCount,
      driftCount: drift.length,
      updatedCount,
      reindexedCount,
      failedReindexFileIds,
      driftFileIds: drift.map(({ fileId }) => fileId),
    }),
  );
  if (CHECK && drift.length > 0) process.exitCode = 1;
  if (REINDEX && failedReindexFileIds.length > 0) process.exitCode = 1;
} finally {
  await pool.end();
}
