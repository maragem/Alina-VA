import { NextRequest } from "next/server";
import {
  authorityCategoryRank,
  isAuthorityCategory,
  isAuthorityRank,
} from "@/lib/documentMetadata";
import {
  convertDocumentToDocx,
  DocumentConversionError,
  isConvertibleDocument,
} from "@/lib/documentConversion";
import {
  addProjectFiles,
  getProjectAccess,
  listFileProjectAssignments,
} from "@/db/repositories/projects";
import { requireAppUser } from "@/lib/currentUser";
import { isUuid } from "@/lib/conversations";
import {
  canMutateFile,
  ensureFileOwner,
  getFileAccessProjection,
  listFileMutationPermissions,
  listFileScopes,
  removeManagedFile,
  type FileScope,
} from "@/db/repositories/filePermissions";
import { getNumber, getRecord, getText, type JsonRecord } from "@/lib/apiParsing";
import {
  getHaystackApiKey,
  getHaystackIndex,
  getHaystackWorkspace,
} from "@/lib/haystackConfig";
import {
  getSupportedExtension,
  isStoredFileName,
  isSupportedFileName,
  MAX_FILE_SIZE_BYTES,
} from "@/lib/fileValidation";
import { haystackAccessMetadata, readHaystackAccessScope } from "@/lib/haystackAccessMetadata";

const API_KEY = getHaystackApiKey();
const WORKSPACE = getHaystackWorkspace();
const INDEX = getHaystackIndex();
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 100;
const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const FILE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getTags(meta: JsonRecord): string[] {
  const value = meta.tags ?? meta.tag;
  if (Array.isArray(value)) {
    return value.filter((tag): tag is string => typeof tag === "string");
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeTags(value: string): string[] | null {
  const tags = value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  if (
    tags.length > MAX_TAGS ||
    tags.some((tag) => tag.length > MAX_TAG_LENGTH)
  ) {
    return null;
  }

  return [...new Set(tags)];
}

function configurationError({
  requireIndex = true,
}: { requireIndex?: boolean } = {}): Response | undefined {
  if (!API_KEY) {
    return Response.json(
      { error: "Server is missing a Haystack API key." },
      { status: 500 },
    );
  }
  if (!WORKSPACE || (requireIndex && !INDEX)) {
    return Response.json(
      { error: "Server is missing Haystack workspace or index configuration." },
      { status: 500 },
    );
  }
}

type IndexedFileStatuses = {
  failedIds: Set<string>;
  noDocumentsIds: Set<string>;
};

async function fetchIndexedFileStatuses(
  headers: HeadersInit,
): Promise<IndexedFileStatuses | null> {
  const base = `https://api.cloud.deepset.ai/api/v1/workspaces/${encodeURIComponent(WORKSPACE)}/indexes/${encodeURIComponent(INDEX)}/files`;
  const responses = await Promise.all(
    ["FAILED", "NO_DOCUMENTS"].map((status) =>
      fetch(`${base}?status=${status}`, {
        headers,
        cache: "no-store",
      }),
    ),
  );

  if (responses.some((response) => !response.ok)) return null;

  const payloads = await Promise.all(
    responses.map((response) => response.json().catch(() => null)),
  );
  if (payloads.some((payload) => !Array.isArray(payload))) return null;

  const toIdSet = (payload: unknown) =>
    new Set(
      (payload as unknown[]).filter(
        (fileId): fileId is string => typeof fileId === "string",
      ),
    );

  return {
    failedIds: toIdSet(payloads[0]),
    noDocumentsIds: toIdSet(payloads[1]),
  };
}

function getIndexStatus(value: unknown) {
  const status = getRecord(getRecord(value).status);
  const pendingFileCount = getNumber(status.pending_file_count);
  if (pendingFileCount === null) return null;

  return {
    pendingFileCount,
    indexedFileCount: getNumber(status.indexed_file_count),
    failedFileCount: getNumber(status.failed_file_count),
    noDocumentsFileCount: getNumber(status.indexed_no_documents_file_count),
    totalFileCount: getNumber(status.total_file_count),
  };
}

async function fetchAllFiles(
  baseParams: URLSearchParams,
  headers: HeadersInit,
): Promise<unknown[]> {
  const files: unknown[] = [];
  const params = new URLSearchParams(baseParams);
  params.set("limit", String(MAX_LIMIT));

  while (true) {
    const response = await fetch(
      `https://api.cloud.deepset.ai/api/v1/workspaces/${encodeURIComponent(WORKSPACE)}/files?${params}`,
      { headers, cache: "no-store" },
    );
    if (!response.ok) throw new Error("Haystack file listing failed.");

    const payload = getRecord(await response.json().catch(() => null));
    if (!Array.isArray(payload.data) || typeof payload.has_more !== "boolean") {
      throw new Error("Haystack returned an invalid file listing.");
    }
    files.push(...payload.data);
    if (!payload.has_more) return files;

    const lastFile = getRecord(payload.data.at(-1));
    const afterValue = getText(lastFile.created_at);
    const afterFileId = getText(lastFile.file_id);
    if (!afterValue || !afterFileId) {
      throw new Error("Haystack returned an invalid pagination cursor.");
    }
    params.set("after_value", afterValue);
    params.set("after_file_id", afterFileId);
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;
  const error = configurationError();
  if (error) return error;

  const params = request.nextUrl.searchParams;
  const name = params.get("name")?.trim() ?? "";
  const authorityCategory = params.get("authorityCategory")?.trim() ?? "";
  const scope = params.get("scope")?.trim() ?? "";
  const afterValue = params.get("afterValue")?.trim() ?? "";
  const afterFileId = params.get("afterFileId")?.trim() ?? "";
  const requestedLimit = Number(params.get("limit") ?? DEFAULT_LIMIT);

  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
    return Response.json(
      { error: "limit must be a positive integer." },
      { status: 400 },
    );
  }
  if (name.length > 200) {
    return Response.json({ error: "name is too long." }, { status: 400 });
  }
  if (authorityCategory && !isAuthorityCategory(authorityCategory)) {
    return Response.json(
      { error: "authorityCategory is invalid." },
      { status: 400 },
    );
  }
  if (scope && scope !== "global" && scope !== "project") {
    return Response.json({ error: "scope is invalid." }, { status: 400 });
  }
  if (Boolean(afterValue) !== Boolean(afterFileId)) {
    return Response.json(
      { error: "afterValue and afterFileId must be provided together." },
      { status: 400 },
    );
  }

  const upstreamParams = new URLSearchParams({
    limit: String(Math.min(requestedLimit, MAX_LIMIT)),
    field: "created_at",
    order: "ASC",
  });
  if (name) upstreamParams.set("name", name);
  if (isAuthorityCategory(authorityCategory)) {
    upstreamParams.set(
      "filter",
      `authority_category eq '${authorityCategory}'`,
    );
  }
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${API_KEY}`,
  };

  try {
    const [fileValues, indexedFileStatuses, indexResponse] = await Promise.all([
      fetchAllFiles(upstreamParams, headers),
      fetchIndexedFileStatuses(headers),
      fetch(
        `https://api.cloud.deepset.ai/api/v1/workspaces/${encodeURIComponent(WORKSPACE)}/indexes/${encodeURIComponent(INDEX)}`,
        { headers, cache: "no-store" },
      ),
    ]);

    const items = fileValues.map((value) => {
      const file = getRecord(value);
      const id = getText(file.file_id);
      const createdAt = getText(file.created_at);
      return {
        id,
        name: getText(file.name) || "Untitled file",
        size: getNumber(file.size),
        createdAt: createdAt || null,
        tags: getTags(getRecord(file.meta)),
        metadataScope: readHaystackAccessScope(file.meta),
        authorityRank: isAuthorityRank(getRecord(file.meta).authority_rank)
          ? getRecord(file.meta).authority_rank
          : null,
        authorityCategory: isAuthorityCategory(
          getRecord(file.meta).authority_category,
        )
          ? getRecord(file.meta).authority_category
          : null,
        status:
          indexedFileStatuses === null
            ? "unknown"
            : indexedFileStatuses.failedIds.has(id)
              ? "failed"
              : indexedFileStatuses.noDocumentsIds.has(id)
                ? "no-documents"
                : "available",
      };
    });
    const itemIds = items.map((item) => item.id).filter(Boolean);
    const [assignments, mutatePermissions, scopes] = await Promise.all([
      listFileProjectAssignments(user.id, itemIds),
      listFileMutationPermissions(user.id, itemIds),
      listFileScopes(itemIds),
    ]);
    const enrichedItems = items.flatMap((item) => {
      const { metadataScope, ...rest } = item;
      // Haystack metadata is the fallback for files with no local row (e.g. uploaded from
      // another environment sharing this workspace); it is what retrieval actually filters on.
      const itemScope: FileScope =
        scopes.get(item.id) ?? metadataScope ?? "global";
      const projects = assignments
        .filter((assignment) => assignment.fileId === item.id)
        .map((assignment) => ({
          id: assignment.projectId,
          name: assignment.projectName,
          role: assignment.role,
        }));
      const canMutate = mutatePermissions.get(item.id) ?? false;
      const canView =
        itemScope === "global" || canMutate || projects.length > 0;
      if (!canView || (scope && itemScope !== scope)) return [];
      return [{ ...rest, scope: itemScope, canMutate, projects }];
    });
    const cursorIndex = afterFileId
      ? enrichedItems.findIndex((item) => item.id === afterFileId)
      : -1;
    if (afterFileId && cursorIndex < 0) {
      return Response.json(
        { error: "The file cursor is no longer valid." },
        { status: 400 },
      );
    }
    const pageLimit = Math.min(requestedLimit, MAX_LIMIT);
    const pageItems = enrichedItems.slice(
      cursorIndex + 1,
      cursorIndex + 1 + pageLimit,
    );
    const hasMore = cursorIndex + 1 + pageItems.length < enrichedItems.length;
    const lastItem = pageItems.at(-1);
    const nextCursor =
      hasMore && lastItem
        ? {
            afterValue: lastItem.createdAt ?? "",
            afterFileId: lastItem.id,
          }
        : null;

    if (nextCursor && (!nextCursor.afterValue || !nextCursor.afterFileId)) {
      return Response.json(
        { error: "Haystack returned an invalid pagination cursor." },
        { status: 502 },
      );
    }

    const indexStatus = indexResponse.ok
      ? getIndexStatus(await indexResponse.json().catch(() => null))
      : null;

    return Response.json({
      items: pageItems,
      total: enrichedItems.length,
      hasMore,
      canUploadGlobal: true,
      canManageFiles: user.role === "admin",
      nextCursor,
      statusAvailable: indexedFileStatuses !== null,
      indexStatus,
    });
  } catch {
    return Response.json(
      { error: "Could not reach Haystack file services." },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;
  const error = configurationError({ requireIndex: false });
  if (error) return error;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json(
      { error: "Upload data must use multipart form data." },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  const tagsValue = formData.get("tags");
  const authorityCategoryValue = formData.get("authorityCategory");
  const overwriteFileIdValue = formData.get("overwriteFileId");
  const overwriteFileNameValue = formData.get("overwriteFileName");
  const projectIdValue = formData.get("projectId");

  if (typeof projectIdValue !== "string" && projectIdValue !== null) {
    return Response.json({ error: "projectId must be text." }, { status: 400 });
  }
  const projectId =
    typeof projectIdValue === "string" ? projectIdValue.trim() : "";
  if (projectId && !isUuid(projectId)) {
    return Response.json({ error: "projectId is invalid." }, { status: 400 });
  }
  if (projectId) {
    const access = await getProjectAccess(user.id, projectId);
    if (access?.role !== "admin") {
      return Response.json({ error: "Project not found." }, { status: 404 });
    }
  }

  const overwriteFileId =
    typeof overwriteFileIdValue === "string" ? overwriteFileIdValue.trim() : "";
  if (overwriteFileId && user.role !== "admin") {
    return Response.json(
      { error: "Only admins can replace existing files." },
      { status: 403 },
    );
  }

  if (!(file instanceof File) || file.size === 0) {
    return Response.json(
      { error: "Select a non-empty file to upload." },
      { status: 400 },
    );
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return Response.json(
      { error: "Files must not exceed 50 MB." },
      { status: 413 },
    );
  }
  if (!isSupportedFileName(file.name)) {
    return Response.json(
      {
        error:
          "Supported file types are PDF, DOC, DOCX, ODT, XLSX, TXT, and MD.",
      },
      { status: 400 },
    );
  }
  if (
    typeof overwriteFileIdValue !== "string" &&
    overwriteFileIdValue !== null
  ) {
    return Response.json(
      { error: "overwriteFileId must be text." },
      { status: 400 },
    );
  }
  if (
    typeof overwriteFileNameValue !== "string" &&
    overwriteFileNameValue !== null
  ) {
    return Response.json(
      { error: "overwriteFileName must be text." },
      { status: 400 },
    );
  }
  if (typeof tagsValue !== "string" && tagsValue !== null) {
    return Response.json({ error: "tags must be text." }, { status: 400 });
  }
  if (
    typeof authorityCategoryValue !== "string" &&
    authorityCategoryValue !== null
  ) {
    return Response.json(
      { error: "authorityCategory must be text." },
      { status: 400 },
    );
  }

  const tags = normalizeTags(tagsValue?.trim() ?? "");
  if (tags === null) {
    return Response.json(
      {
        error: `Use at most ${MAX_TAGS} tags with ${MAX_TAG_LENGTH} characters each.`,
      },
      { status: 400 },
    );
  }

  const authorityCategoryValueNormalized = authorityCategoryValue?.trim() ?? "";
  if (
    authorityCategoryValueNormalized &&
    !isAuthorityCategory(authorityCategoryValueNormalized)
  ) {
    return Response.json(
      { error: "authorityCategory is invalid." },
      { status: 400 },
    );
  }
  const authorityCategory = isAuthorityCategory(
    authorityCategoryValueNormalized,
  )
    ? authorityCategoryValueNormalized
    : null;
  const overwriteFileName = overwriteFileNameValue?.trim() ?? "";
  if (projectId && overwriteFileId) {
    return Response.json(
      { error: "Project uploads cannot replace an existing file." },
      { status: 400 },
    );
  }
  if (Boolean(overwriteFileId) !== Boolean(overwriteFileName)) {
    return Response.json(
      {
        error:
          "overwriteFileId and overwriteFileName must be provided together.",
      },
      { status: 400 },
    );
  }
  if (overwriteFileId && !FILE_ID_PATTERN.test(overwriteFileId)) {
    return Response.json({ error: "Invalid overwrite file ID." }, { status: 400 });
  }
  if (overwriteFileId) {
    const canReplace = await canMutateFile(user.id, overwriteFileId);
    if (!canReplace) {
      return Response.json(
        { error: "You are not allowed to replace this file." },
        { status: 403 },
      );
    }
  }
  if (overwriteFileName && !isStoredFileName(overwriteFileName)) {
    return Response.json(
      { error: "The existing file has an unsupported type." },
      { status: 400 },
    );
  }
  const sourceExtension = getSupportedExtension(file.name);
  const overwriteExtension = getSupportedExtension(overwriteFileName);
  const replacementTypeMatches =
    !overwriteFileName ||
    sourceExtension === overwriteExtension ||
    (isConvertibleDocument(file.name) && overwriteExtension === ".docx");
  if (!replacementTypeMatches) {
    return Response.json(
      {
        error:
          "The replacement must have the same stored file type as the existing file.",
      },
      { status: 400 },
    );
  }

  const meta: JsonRecord = {};
  if (tags.length > 0) meta.tags = tags;
  if (authorityCategory !== null) {
    meta.authority_category = authorityCategory;
    const authorityRank = authorityCategoryRank(authorityCategory);
    if (authorityRank !== null) meta.authority_rank = authorityRank;
  }
  const accessProjection = overwriteFileId
    ? await getFileAccessProjection(overwriteFileId)
    : {
        scope: projectId ? ("project" as const) : ("global" as const),
        projectIds: projectId ? [projectId] : [],
      };
  if (overwriteFileId && !accessProjection) {
    return Response.json(
      { error: "The existing file access metadata could not be resolved." },
      { status: 409 },
    );
  }
  Object.assign(
    meta,
    haystackAccessMetadata(
      accessProjection?.scope ?? "global",
      accessProjection?.projectIds ?? [],
    ),
  );

  let uploadFile = file;
  let uploadFileName = overwriteFileName || file.name;
  if (isConvertibleDocument(file.name)) {
    try {
      const converted = await convertDocumentToDocx(
        new Uint8Array(await file.arrayBuffer()),
        file.name,
        MAX_FILE_SIZE_BYTES,
      );
      uploadFileName = overwriteFileName || converted.fileName;
      uploadFile = new File([new Uint8Array(converted.bytes)], uploadFileName, {
        type: DOCX_CONTENT_TYPE,
      });
      meta.original_file_name = file.name;
      meta.original_file_type = sourceExtension?.slice(1) ?? "";
    } catch (conversionError) {
      if (conversionError instanceof DocumentConversionError) {
        if (conversionError.reason === "converter-unavailable") {
          console.error("LibreOffice is unavailable:", conversionError.message);
          return Response.json(
            { error: "Document conversion is unavailable." },
            { status: 500 },
          );
        }
        if (conversionError.reason === "output-too-large") {
          return Response.json(
            { error: "The converted DOCX must not exceed 50 MB." },
            { status: 413 },
          );
        }
        console.error("Document conversion failed:", conversionError.message);
        return Response.json(
          { error: "The document could not be converted to DOCX." },
          { status: 422 },
        );
      }
      console.error("Unexpected document conversion failure:", conversionError);
      return Response.json(
        { error: "The document could not be converted to DOCX." },
        { status: 500 },
      );
    }
  }

  const upstreamFormData = new FormData();
  upstreamFormData.append("file", uploadFile, uploadFileName);
  upstreamFormData.append("meta", JSON.stringify(meta));

  try {
    const response = await fetch(
      `https://api.cloud.deepset.ai/api/v1/workspaces/${encodeURIComponent(WORKSPACE)}/files?write_mode=OVERWRITE`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: upstreamFormData,
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return Response.json(
        { error: "Haystack file upload failed." },
        { status: response.status || 502 },
      );
    }

    const payload = getRecord(await response.json().catch(() => null));
    const fileId = getText(payload.file_id);
    if (!fileId) {
      return Response.json(
        { error: "Haystack returned an invalid upload response." },
        { status: 502 },
      );
    }

    await ensureFileOwner(fileId, user.id, projectId ? "project" : "global");
    if (projectId) {
      const assigned = await addProjectFiles(user.id, projectId, [fileId]);
      if (!assigned || assigned.length === 0) {
        await removeManagedFile(fileId);
        await fetch(
          `https://api.cloud.deepset.ai/api/v1/workspaces/${encodeURIComponent(WORKSPACE)}/files/${encodeURIComponent(fileId)}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${API_KEY}` },
            cache: "no-store",
          },
        ).catch(() => undefined);
        return Response.json(
          {
            error:
              "The project file could not be assigned. The upload was rolled back.",
          },
          { status: 500 },
        );
      }
    }

    return Response.json({ fileId }, { status: 201 });
  } catch {
    return Response.json(
      { error: "Could not reach Haystack file services." },
      { status: 502 },
    );
  }
}