import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const API_KEY =
  process.env.HAYSTACK_API_KEY?.trim() ??
  process.env.DEEPSET_API_KEY?.trim() ??
  "";
const WORKSPACE = process.env.HAYSTACK_WORKSPACE?.trim() ?? "";
const INDEX = process.env.HAYSTACK_INDEX?.trim() ?? "";
const API_BASE = `https://api.cloud.deepset.ai/api/v1/workspaces/${encodeURIComponent(WORKSPACE)}`;
const PAGE_SIZE = 100;
const CONCURRENCY = 4;

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const KEEP = args.includes("--keep");
const statusArg = args.find((value) => value.startsWith("--status="));
const outArg = args.find((value) => value.startsWith("--out="));
// The index UI labels NO_DOCUMENTS files as "Skipped"; the API only accepts FAILED or NO_DOCUMENTS.
const STATUSES = (statusArg?.slice("--status=".length) ?? "NO_DOCUMENTS")
  .split(",")
  .map((value) => value.trim().toUpperCase())
  .map((value) => (value === "SKIPPED" ? "NO_DOCUMENTS" : value))
  .filter(Boolean);
const OUT_DIR = path.resolve(
  outArg?.slice("--out=".length) ??
    `quarantine/${STATUSES.join("-").toLowerCase()}-${new Date()
      .toISOString()
      .replaceAll(/[:.]/g, "-")}`,
);

if (!API_KEY || !WORKSPACE || !INDEX) {
  throw new Error(
    "Set HAYSTACK_API_KEY, HAYSTACK_WORKSPACE and HAYSTACK_INDEX.",
  );
}
if (STATUSES.length === 0) throw new Error("--status must not be empty.");
if (STATUSES.some((value) => value !== "FAILED" && value !== "NO_DOCUMENTS")) {
  throw new Error("--status accepts only FAILED, NO_DOCUMENTS (alias SKIPPED).");
}

const jsonHeaders = {
  Accept: "application/json",
  Authorization: `Bearer ${API_KEY}`,
};

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function listFileIdsByStatus(status) {
  const response = await fetch(
    `${API_BASE}/indexes/${encodeURIComponent(INDEX)}/files?status=${encodeURIComponent(status)}`,
    { headers: jsonHeaders },
  );
  if (!response.ok) {
    throw new Error(`Listing ${status} files failed (${response.status}).`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error(`Haystack returned an invalid ${status} file list.`);
  }
  return payload.filter((value) => typeof value === "string");
}

async function listWorkspaceFiles() {
  const files = new Map();
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  while (true) {
    const response = await fetch(`${API_BASE}/files?${params}`, {
      headers: jsonHeaders,
    });
    if (!response.ok) {
      throw new Error(`Haystack file listing failed (${response.status}).`);
    }
    const payload = record(await response.json());
    if (!Array.isArray(payload.data) || typeof payload.has_more !== "boolean") {
      throw new Error("Haystack returned an invalid file listing.");
    }
    for (const candidate of payload.data) {
      const file = record(candidate);
      const fileId = text(file.file_id);
      if (fileId) files.set(fileId, file);
    }
    if (!payload.has_more) return files;

    const lastFile = record(payload.data.at(-1));
    const afterValue = text(lastFile.created_at);
    const afterFileId = text(lastFile.file_id);
    if (!afterValue || !afterFileId) {
      throw new Error("Haystack returned an invalid pagination cursor.");
    }
    params.set("after_value", afterValue);
    params.set("after_file_id", afterFileId);
  }
}

// Haystack names may contain separators; keep only the basename so writes stay inside OUT_DIR.
function safeFileName(name, fileId) {
  const base = path.basename(name.replaceAll("\\", "/")).replaceAll("\0", "");
  const cleaned = base.replace(/[/:*?"<>|]/g, "_").trim();
  return cleaned && cleaned !== "." && cleaned !== ".."
    ? cleaned
    : `${fileId}.bin`;
}

function uniqueFileName(name, used) {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const extension = path.extname(name);
  const stem = name.slice(0, name.length - extension.length);
  let counter = 2;
  while (used.has(`${stem} (${counter})${extension}`)) counter += 1;
  const unique = `${stem} (${counter})${extension}`;
  used.add(unique);
  return unique;
}

async function downloadFile(fileId, destination) {
  const response = await fetch(`${API_BASE}/files/${encodeURIComponent(fileId)}`, {
    headers: { Accept: "*/*", Authorization: `Bearer ${API_KEY}` },
  });
  if (!response.ok) {
    throw new Error(`Download failed for ${fileId} (${response.status}).`);
  }
  await writeFile(destination, new Uint8Array(await response.arrayBuffer()));
}

async function deleteFile(fileId) {
  const response = await fetch(`${API_BASE}/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: jsonHeaders,
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Delete failed for ${fileId} (${response.status}).`);
  }
}

async function runPooled(items, worker) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) await worker(queue.shift());
  });
  await Promise.all(workers);
}

const statusLists = await Promise.all(STATUSES.map(listFileIdsByStatus));
const targetIds = [...new Set(statusLists.flat())];
const workspaceFiles = await listWorkspaceFiles();

const usedNames = new Set();
const entries = targetIds.map((fileId) => {
  const file = record(workspaceFiles.get(fileId));
  const name = text(file.name) || `${fileId}.bin`;
  return {
    fileId,
    name,
    savedAs: uniqueFileName(safeFileName(name, fileId), usedNames),
    size: file.size ?? null,
    meta: record(file.meta),
    missingFromWorkspace: !workspaceFiles.has(fileId),
  };
});

if (!APPLY) {
  console.log(
    JSON.stringify(
      {
        mode: "dry-run",
        statuses: STATUSES,
        index: INDEX,
        outDir: OUT_DIR,
        wouldDeleteFromIndex: !KEEP,
        fileCount: entries.length,
        files: entries.map(({ fileId, name, savedAs }) => ({
          fileId,
          name,
          savedAs,
        })),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

await mkdir(OUT_DIR, { recursive: true });

const downloaded = [];
const failures = [];
await runPooled(entries, async (entry) => {
  try {
    await downloadFile(entry.fileId, path.join(OUT_DIR, entry.savedAs));
    downloaded.push(entry);
  } catch (error) {
    failures.push({ fileId: entry.fileId, stage: "download", error: String(error) });
  }
});

const deleted = [];
if (!KEEP) {
  await runPooled(downloaded, async (entry) => {
    try {
      await deleteFile(entry.fileId);
      deleted.push(entry.fileId);
    } catch (error) {
      failures.push({ fileId: entry.fileId, stage: "delete", error: String(error) });
    }
  });
}

const manifest = {
  generatedAt: new Date().toISOString(),
  workspace: WORKSPACE,
  index: INDEX,
  statuses: STATUSES,
  deletedFromHaystack: !KEEP,
  files: downloaded.map((entry) => ({
    fileId: entry.fileId,
    name: entry.name,
    savedAs: entry.savedAs,
    size: entry.size,
    meta: entry.meta,
    deleted: deleted.includes(entry.fileId),
  })),
  failures,
};
await writeFile(
  path.join(OUT_DIR, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

console.log(
  JSON.stringify(
    {
      mode: "apply",
      outDir: OUT_DIR,
      targetCount: entries.length,
      downloadedCount: downloaded.length,
      deletedCount: deleted.length,
      failureCount: failures.length,
      failures,
    },
    null,
    2,
  ),
);
if (failures.length > 0) process.exitCode = 1;
