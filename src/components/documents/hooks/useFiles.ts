"use client";

import { authorityCategoryRank, type AuthorityCategory } from "@/lib/documentMetadata";
import { apiErrorMessage } from "@/lib/apiError";
import { useEffect, useRef, useState } from "react";

export type FileItem = {
  id: string;
  scope: "global" | "project";
  name: string;
  size: number | null;
  createdAt: string | null;
  tags: string[];
  authorityRank: number | null;
  authorityCategory: string | null;
  canMutate: boolean;
  status: "available" | "failed" | "no-documents" | "indexing" | "unknown";
  projects: Array<{
    id: string;
    name: string;
    role: "admin" | "member";
  }>;
};

type IndexStatus = {
  pendingFileCount: number;
  indexedFileCount: number | null;
  failedFileCount: number | null;
  noDocumentsFileCount: number | null;
  totalFileCount: number | null;
};

type Cursor = {
  afterValue: string;
  afterFileId: string;
};

type FilesState = {
  items: FileItem[];
  total: number;
  hasMore: boolean;
  canUploadGlobal: boolean;
  canManageFiles: boolean;
  loading: boolean;
  error: string | null;
  cursor: Cursor | null;
  cursorHistory: Array<Cursor | null>;
  nextCursor: Cursor | null;
  statusAvailable: boolean;
  indexStatus: IndexStatus | null;
};

const PAGE_SIZE = 20;
const INDEX_POLL_INTERVAL = 10_000;

const INITIAL_FILES: FilesState = {
  items: [],
  total: 0,
  hasMore: false,
  canUploadGlobal: false,
  canManageFiles: false,
  loading: true,
  error: null,
  cursor: null,
  cursorHistory: [],
  nextCursor: null,
  statusAvailable: true,
  indexStatus: null,
};

function useDebouncedValue(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timeout);
  }, [delay, value]);

  return debounced;
}

function mapsEqual(first: Map<string, number>, second: Map<string, number>): boolean {
  return first.size === second.size && [...first].every(
    ([key, value]) => second.get(key) === value,
  );
}

export function useFiles() {
  const [scope, setScopeValue] = useState<"global" | "project">("global");
  const [query, setQueryValue] = useState("");
  const debouncedQuery = useDebouncedValue(query, 300);
  const [authorityCategoryFilter, setAuthorityCategoryFilterValue] = useState<AuthorityCategory | null>(null);
  const [files, setFiles] = useState<FilesState>(INITIAL_FILES);
  const [retryCount, setRetryCount] = useState(0);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [updatingFileId, setUpdatingFileId] = useState<string | null>(null);
  const [replacingFileId, setReplacingFileId] = useState<string | null>(null);
  const [pendingFileIds, setPendingFileIds] = useState<Map<string, number>>(() => new Map());
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    params.set("scope", scope);
    if (debouncedQuery) params.set("name", debouncedQuery);
    if (authorityCategoryFilter)
      params.set("authorityCategory", authorityCategoryFilter);
    if (files.cursor) {
      params.set("afterValue", files.cursor.afterValue);
      params.set("afterFileId", files.cursor.afterFileId);
    }

    fetch(`/api/haystack/files?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            await apiErrorMessage(response, "The request could not be completed."),
          );
        return response.json() as Promise<{
          items: FileItem[];
          total: number;
          hasMore: boolean;
          canUploadGlobal: boolean;
          canManageFiles: boolean;
          nextCursor: Cursor | null;
          statusAvailable: boolean;
          indexStatus: IndexStatus | null;
        }>;
      })
      .then((payload) => {
        const nextPendingFileIds = new Map(pendingFileIds);
        for (const file of payload.items) {
          if (file.status === "failed" || file.status === "no-documents") {
            nextPendingFileIds.delete(file.id);
          }
        }
        if (payload.indexStatus?.pendingFileCount === 0) {
          const now = Date.now();
          for (const [fileId, queuedAt] of nextPendingFileIds) {
            if (now - queuedAt >= INDEX_POLL_INTERVAL)
              nextPendingFileIds.delete(fileId);
          }
        }
        if (!mapsEqual(pendingFileIds, nextPendingFileIds)) {
          setPendingFileIds(nextPendingFileIds);
        }
        setFiles((current) => ({
          ...current,
          ...payload,
          items: payload.items.map((file) =>
            nextPendingFileIds.has(file.id) && file.status === "available"
              ? { ...file, status: "indexing" as const }
              : file,
          ),
          loading: false,
          error: null,
        }));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setFiles((current) => ({
          ...current,
          loading: false,
          error:
            error instanceof Error ? error.message : "Could not load files.",
        }));
      });

    return () => controller.abort();
  }, [
    authorityCategoryFilter,
    debouncedQuery,
    files.cursor,
    pendingFileIds,
    retryCount,
    scope,
  ]);

  useEffect(() => {
    if ((files.indexStatus?.pendingFileCount ?? 0) === 0 && pendingFileIds.size === 0) return;
    const interval = window.setInterval(() => {
      setRetryCount((value) => value + 1);
    }, INDEX_POLL_INTERVAL);
    return () => window.clearInterval(interval);
  }, [files.indexStatus?.pendingFileCount, pendingFileIds.size]);

  function markFilesIndexing(fileIds: string[]) {
    const queuedAt = Date.now();
    setPendingFileIds((current) => {
      const next = new Map(current);
      for (const fileId of fileIds) next.set(fileId, queuedAt);
      return next;
    });
  }

  function setQuery(queryValue: string) {
    setQueryValue(queryValue);
    setFiles((current) => ({
      ...current,
      cursor: null,
      cursorHistory: [],
      loading: true,
      error: null,
    }));
  }

  function setAuthorityCategoryFilter(authorityCategory: AuthorityCategory | null) {
    setAuthorityCategoryFilterValue(authorityCategory);
    setFiles((current) => ({
      ...current,
      cursor: null,
      cursorHistory: [],
      loading: true,
      error: null,
    }));
  }

  function setScope(nextScope: "global" | "project") {
    if (nextScope === scope) return;
    setScopeValue(nextScope);
    setFiles((current) => ({
      ...current,
      items: [],
      cursor: null,
      cursorHistory: [],
      loading: true,
      error: null,
    }));
  }

  function next() {
    if (!files.nextCursor || files.loading) return;
    setFiles((current) => ({
      ...current,
      cursorHistory: [...current.cursorHistory, current.cursor],
      cursor: current.nextCursor,
      loading: true,
      error: null,
    }));
  }

  function previous() {
    if (files.cursorHistory.length === 0 || files.loading) return;
    setFiles((current) => ({
      ...current,
      cursor: current.cursorHistory[current.cursorHistory.length - 1] ?? null,
      cursorHistory: current.cursorHistory.slice(0, -1),
      loading: true,
      error: null,
    }));
  }

  function retry() {
    setFiles((current) => ({ ...current, loading: true, error: null }));
    setRetryCount((value) => value + 1);
  }

  function refresh() {
    setRetryCount((value) => value + 1);
  }

  async function deleteFile(fileId: string): Promise<void> {
    if (deletingFileId) return;

    setDeletingFileId(fileId);
    try {
      const response = await fetch(`/api/haystack/files/${encodeURIComponent(fileId)}`, {
        method: "DELETE",
      });
      if (!response.ok)
        throw new Error(
          await apiErrorMessage(response, "The request could not be completed."),
        );
      const payload = (await response.json()) as { fileId?: unknown };
      if (typeof payload.fileId === "string") markFilesIndexing([payload.fileId]);
      refresh();
    } finally {
      setDeletingFileId(null);
    }
  }

  async function updateFileAuthorityCategory(
    fileId: string,
    authorityCategory: AuthorityCategory | null,
  ): Promise<void> {
    if (updatingFileId || deletingFileId) return;

    setUpdatingFileId(fileId);
    setFiles((current) => ({
      ...current,
      items: current.items.map((file) => (
        file.id === fileId
          ? {
              ...file,
              authorityCategory,
              authorityRank: authorityCategory === null ? null : authorityCategoryRank(authorityCategory),
            }
          : file
      )),
    }));

    try {
      const response = await fetch(`/api/haystack/files/${encodeURIComponent(fileId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorityCategory }),
      });
      if (!response.ok)
        throw new Error(
          await apiErrorMessage(response, "The request could not be completed."),
        );
      refresh();
    } catch (error) {
      refresh();
      throw error;
    } finally {
      setUpdatingFileId(null);
    }
  }

  async function replaceFile(existingFile: FileItem, replacement: File): Promise<void> {
    if (replacingFileId || deletingFileId) return;

    setReplacingFileId(existingFile.id);
    try {
      const formData = new FormData();
      formData.append("file", replacement);
      formData.append("overwriteFileId", existingFile.id);
      formData.append("overwriteFileName", existingFile.name);
      if (existingFile.tags.length > 0) formData.append("tags", existingFile.tags.join(","));
      if (existingFile.authorityCategory) {
        formData.append("authorityCategory", existingFile.authorityCategory);
      }

      const response = await fetch("/api/haystack/files", {
        method: "POST",
        body: formData,
      });
      if (!response.ok)
        throw new Error(
          await apiErrorMessage(response, "The request could not be completed."),
        );
      refresh();
    } finally {
      setReplacingFileId(null);
    }
  }

  async function assignFileToProject(fileId: string, projectId: string): Promise<void> {
    const response = await fetch(`/api/projects/${projectId}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileIds: [fileId] }),
    });
    if (!response.ok)
      throw new Error(
        await apiErrorMessage(response, "The request could not be completed."),
      );
    refresh();
  }

  async function removeFileFromProject(fileId: string, projectId: string): Promise<void> {
    const response = await fetch(`/api/projects/${projectId}/files/${fileId}`, {
      method: "DELETE",
    });
    if (!response.ok)
      throw new Error(
        await apiErrorMessage(response, "The request could not be completed."),
      );
    refresh();
  }

  return {
    ...files,
    query,
    scope,
    authorityCategoryFilter,
    currentPage: files.cursorHistory.length + 1,
    totalPages: Math.max(1, Math.ceil(files.total / PAGE_SIZE)),
    rangeStart:
      files.items.length === 0 ? 0 : files.cursorHistory.length * PAGE_SIZE + 1,
    rangeEnd: files.cursorHistory.length * PAGE_SIZE + files.items.length,
    canGoPrevious: files.cursorHistory.length > 0 && !files.loading,
    canGoNext: files.hasMore && Boolean(files.nextCursor) && !files.loading,
    setQuery,
    setScope,
    setAuthorityCategoryFilter,
    next,
    previous,
    retry,
    refresh,
    markFilesIndexing,
    deleteFile,
    deletingFileId,
    updateFileAuthorityCategory,
    updatingFileId,
    replaceFile,
    replacingFileId,
    assignFileToProject,
    removeFileFromProject,
  };
}