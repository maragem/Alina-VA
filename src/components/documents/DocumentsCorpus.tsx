"use client";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AUTHORITY_CATEGORIES, type AuthorityCategory } from "@/lib/documentMetadata";
import { ChevronLeft, ChevronRight, FileText, ListFilter, LoaderCircle, Search, Upload } from "lucide-react";
import { useCallback, useRef, useState, type ChangeEvent } from "react";
import { FilePreviewDialog } from "./FilePreviewDialog";
import { UploadDocumentsPanel } from "./UploadDocumentsPanel";
import type { FileItem } from "./hooks/useFiles";
import { useFiles } from "./hooks/useFiles";

function formatSize(bytes: number | null): string {
  if (bytes === null) return "Size unavailable";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function StatusBadge({ status }: { status: FileItem["status"] }) {
  const styles = {
    available: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    failed: "bg-rose-50 text-rose-700 ring-rose-600/20",
    "no-documents": "bg-amber-50 text-amber-700 ring-amber-600/20",
    indexing: "bg-sky-50 text-sky-700 ring-sky-600/20",
    unknown: "bg-slate-100 text-slate-600 ring-slate-500/20",
  };
  const dotStyles = {
    available: "bg-emerald-500",
    failed: "bg-rose-500",
    "no-documents": "bg-amber-500",
    indexing: "bg-sky-500",
    unknown: "bg-slate-400",
  };
  const labels = {
    available: "Available",
    failed: "Failed",
    "no-documents": "No documents",
    indexing: "Indexing",
    unknown: "Unknown",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${styles[status]}`}
    >
      {status === "indexing" ? (
        <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
      ) : (
        <span
          className={`size-1.5 rounded-full ${dotStyles[status]}`}
          aria-hidden="true"
        />
      )}
      {labels[status]}
    </span>
  );
}

function AuthorityRank({
  file,
  updating,
  canMutate,
  onChange,
}: {
  file: FileItem;
  updating: boolean;
  canMutate: boolean;
  onChange: (authorityCategory: AuthorityCategory | null) => void;
}) {
  return (
    <div className="relative">
      <select
        aria-label={`Data hierarchy for ${file.name}`}
        className="h-8 w-full rounded-md border border-(--ec-line) bg-white px-2 pr-7 text-xs text-(--ec-ink) disabled:cursor-not-allowed disabled:opacity-60"
        value={file.authorityCategory ?? ""}
        onChange={(event) => onChange(event.target.value as AuthorityCategory || null)}
        disabled={updating || !canMutate}
      >
        <option value="">No classification</option>
        {[1, 2, 3, 4].map((rank) => (
          <optgroup key={rank} label={`Level ${rank}`}>
            {AUTHORITY_CATEGORIES.filter((category) => category.rank === rank).map((category) => (
              <option key={category.value} value={category.value}>{category.label}</option>
            ))}
          </optgroup>
        ))}
        <optgroup label="Unranked">
          {AUTHORITY_CATEGORIES.filter((category) => category.rank === null).map((category) => (
            <option key={category.value} value={category.value}>{category.label}</option>
          ))}
        </optgroup>
      </select>
      {updating ? (
        <LoaderCircle className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 animate-spin text-(--ec-blue)" aria-label="Saving hierarchy" />
      ) : null}
    </div>
  );
}

function Tags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return <span className="text-sm text-slate-400">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

function ProjectAssignments({
  file,
  canManageFiles,
  onRemove,
}: {
  file: FileItem;
  canManageFiles: boolean;
  onRemove: (projectId: string) => void;
}) {
  if (file.projects.length === 0) return <span className="text-sm text-slate-400">Unassigned</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {file.projects.map((project) => (
        <span key={project.id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 text-[11px] font-semibold text-(--ec-blue)">
          {project.name}
          {canManageFiles && project.role === "admin" ? (
            <button type="button" className="font-bold text-slate-500 hover:text-rose-700" title={`Remove from ${project.name}`} aria-label={`Remove ${file.name} from ${project.name}`} onClick={() => onRemove(project.id)}>×</button>
          ) : null}
        </span>
      ))}
    </div>
  );
}

function Actions({
  file,
  canManageFiles,
  canMutate,
  onView,
  onUpdate,
  onDelete,
  deleting,
  replacing,
}: {
  file: FileItem;
  canManageFiles: boolean;
  canMutate: boolean;
  onView: (file: FileItem) => void;
  onUpdate: (file: FileItem) => void;
  onDelete: (file: FileItem) => void;
  deleting: boolean;
  replacing: boolean;
}) {
  return (
    <div className="flex justify-end gap-1.5">
      <Button variant="outline" size="sm" onClick={() => onView(file)} disabled={deleting || replacing}>View</Button>
      {canManageFiles ? (
        <>
          <Button className="min-w-16" variant="outline" size="sm" onClick={() => onUpdate(file)} disabled={deleting || replacing || !canMutate}>
            {replacing ? <LoaderCircle className="size-3 animate-spin" aria-label="Updating" /> : "Update"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-rose-200 text-rose-700 hover:bg-rose-50"
            onClick={() => onDelete(file)}
            disabled={deleting || replacing || !canMutate}
          >
            {deleting ? <LoaderCircle className="size-3 animate-spin" aria-label="Deleting" /> : "Delete"}
          </Button>
        </>
      ) : null}
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-2 p-5" aria-label="Loading results">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="h-14 animate-pulse bg-slate-100" />
      ))}
    </div>
  );
}

function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="px-5 py-12 text-center" role="alert">
      <p className="font-semibold text-slate-900">Could not load this corpus view</p>
      <p className="mt-1 text-sm text-(--ec-mute)">{message}</p>
      <Button className="mt-4" onClick={retry}>Retry</Button>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="px-5 py-14 text-center">
      <FileText className="mx-auto size-8 text-slate-400" aria-hidden />
      <p className="mt-3 font-semibold text-slate-900">No {label} found</p>
      <p className="mt-1 text-sm text-(--ec-mute)">
        Try a different search or clear the current query.
      </p>
    </div>
  );
}

export function DocumentsCorpus() {
  const files = useFiles();
  const replacementInputRef = useRef<HTMLInputElement>(null);
  const replacementTargetRef = useRef<FileItem | null>(null);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [hierarchyError, setHierarchyError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Array<{ id: string; name: string; role: "admin" | "member" }>>([]);
  const [assignmentFileId, setAssignmentFileId] = useState<string | null>(null);
  const closePreview = useCallback(() => setPreviewFile(null), []);

  async function loadProjects(): Promise<void> {
    if (projects.length > 0) return;
    const response = await fetch("/api/projects", { cache: "no-store" });
    if (!response.ok) return;
    const payload = (await response.json()) as { projects: Array<{ id: string; name: string; role: "admin" | "member" }> };
    setProjects(payload.projects);
  }

  async function handleDelete(file: FileItem) {
    if (!window.confirm(`Delete “${file.name}”? This cannot be undone.`)) return;

    setDeleteError(null);
    try {
      await files.deleteFile(file.id);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "The file could not be deleted.");
    }
  }

  function handleUpdate(file: FileItem) {
    replacementTargetRef.current = file;
    setReplaceError(null);
    replacementInputRef.current?.click();
  }

  async function handleReplacementChange(event: ChangeEvent<HTMLInputElement>) {
    const replacement = event.target.files?.[0];
    const existingFile = replacementTargetRef.current;
    event.target.value = "";
    replacementTargetRef.current = null;
    if (!replacement || !existingFile) return;

    try {
      await files.replaceFile(existingFile, replacement);
    } catch (error) {
      setReplaceError(error instanceof Error ? error.message : "The file could not be updated.");
    }
  }

  async function handleAuthorityCategoryChange(
    file: FileItem,
    authorityCategory: AuthorityCategory | null,
  ) {
    if (authorityCategory === file.authorityCategory) return;

    setHierarchyError(null);
    try {
      await files.updateFileAuthorityCategory(file.id, authorityCategory);
    } catch (error) {
      setHierarchyError(error instanceof Error ? error.message : "The hierarchy could not be updated.");
    }
  }

  async function handleAssign(fileId: string, projectId: string): Promise<void> {
    if (!projectId) return;
    setAssignmentFileId(fileId);
    try {
      await files.assignFileToProject(fileId, projectId);
    } catch (error) {
      setHierarchyError(error instanceof Error ? error.message : "The project assignment could not be updated.");
    } finally {
      setAssignmentFileId(null);
    }
  }

  async function handleUnassign(fileId: string, projectId: string): Promise<void> {
    try {
      await files.removeFileFromProject(fileId, projectId);
    } catch (error) {
      setHierarchyError(error instanceof Error ? error.message : "The project assignment could not be updated.");
    }
  }

  return (
    <>
      <input
        ref={replacementInputRef}
        className="sr-only"
        type="file"
        accept=".pdf,.doc,.docx,.odt,.xlsx,.txt,.md"
        aria-label="Select replacement file"
        onChange={handleReplacementChange}
      />
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
        <section
          className="ec-card overflow-hidden rounded-lg"
          aria-labelledby="corpus-title"
        >
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-(--ec-line) px-5 py-4">
            <div>
              <h2
                id="corpus-title"
                className="text-lg font-semibold text-(--ec-blue)"
              >
                Documents
              </h2>
              <p className="mt-1 text-sm text-(--ec-mute)">
                Manage shared files and files restricted to specific projects.
              </p>
            </div>
            {files.scope === "global" ? (
              files.canUploadGlobal ? (
                <Button
                  className="font-semibold"
                  onClick={() => setUploadOpen((open) => !open)}
                >
                  <Upload className="size-4" aria-hidden />
                  {uploadOpen ? "Close upload" : "Upload global file"}
                </Button>
              ) : (
                <Tooltip>
                  <TooltipTrigger
                    render={<span className="inline-flex" tabIndex={0} />}
                  >
                    <Button className="font-semibold" disabled>
                      <Upload className="size-4" aria-hidden />
                      Upload global file
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Global file uploads are restricted to administrators.
                  </TooltipContent>
                </Tooltip>
              )
            ) : null}
          </div>

          <div className="border-b border-(--ec-line) px-5 pt-3">
            <div className="flex gap-6" role="tablist" aria-label="File scope">
              {(["global", "project"] as const).map((scope) => (
                <button
                  key={scope}
                  type="button"
                  role="tab"
                  aria-selected={files.scope === scope}
                  className={`border-b-2 px-1 pb-3 text-sm font-semibold ${files.scope === scope ? "border-(--ec-blue) text-(--ec-blue)" : "border-transparent text-slate-500 hover:text-slate-800"}`}
                  onClick={() => {
                    setUploadOpen(false);
                    files.setScope(scope);
                  }}
                >
                  {scope === "global" ? "Global files" : "Project files"}
                </button>
              ))}
            </div>
            <p className="py-3 text-sm text-(--ec-mute)">
              {files.scope === "global"
                ? "Available in global chat and every project chat."
                : "Available only in the projects shown below. Unassigned files are not used by any chat."}
            </p>
          </div>

          {uploadOpen ? (
            <UploadDocumentsPanel
              onClose={() => setUploadOpen(false)}
              onComplete={({ uploadedFileIds, failed }) => {
                if (uploadedFileIds.length > 0) {
                  files.markFilesIndexing(uploadedFileIds);
                  files.refresh();
                }
                if (failed === 0) setUploadOpen(false);
              }}
            />
          ) : null}

          <div aria-busy={files.loading}>
            <div className="grid gap-3 border-b border-slate-200 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_18rem]">
              <label className="relative block">
                <span className="sr-only">Search files</span>
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                  aria-hidden
                />
                <input
                  className="ec-input h-9 rounded-md"
                  style={{ paddingLeft: "2.25rem" }}
                  value={files.query}
                  onChange={(event) => files.setQuery(event.target.value)}
                  placeholder="Search files by name…"
                />
              </label>
              <label className="relative block">
                <span className="sr-only">Filter by authority</span>
                <ListFilter
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                  aria-hidden
                />
                <select
                  className="h-9 w-full rounded-md border border-(--ec-line) bg-white pl-9 pr-3 text-sm text-(--ec-ink)"
                  aria-label="Filter by authority"
                  value={files.authorityCategoryFilter ?? ""}
                  onChange={(event) =>
                    files.setAuthorityCategoryFilter(
                      event.target.value
                        ? (event.target.value as AuthorityCategory)
                        : null,
                    )
                  }
                >
                  <option value="">All authorities</option>
                  {[1, 2, 3, 4].map((rank) => (
                    <optgroup key={rank} label={`Level ${rank}`}>
                      {AUTHORITY_CATEGORIES.filter(
                        (category) => category.rank === rank,
                      ).map((category) => (
                        <option key={category.value} value={category.value}>
                          {category.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                  <optgroup label="Unranked">
                    {AUTHORITY_CATEGORIES.filter(
                      (category) => category.rank === null,
                    ).map((category) => (
                      <option key={category.value} value={category.value}>
                        {category.label}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>
            </div>

            {(files.indexStatus?.pendingFileCount ?? 0) > 0 ? (
              <p
                className="border-b border-sky-200 bg-sky-50 px-5 py-2 text-sm text-sky-900"
                role="status"
              >
                Indexing changes · {files.indexStatus?.pendingFileCount}{" "}
                {files.indexStatus?.pendingFileCount === 1 ? "task" : "tasks"}{" "}
                pending
              </p>
            ) : null}

            {files.loading && files.items.length === 0 ? <LoadingRows /> : null}
            {files.error ? (
              <ErrorState message={files.error} retry={files.retry} />
            ) : null}
            {deleteError ? (
              <p
                className="border-b border-rose-200 bg-rose-50 px-5 py-2 text-sm text-rose-800"
                role="alert"
              >
                {deleteError}
              </p>
            ) : null}
            {replaceError ? (
              <p
                className="border-b border-rose-200 bg-rose-50 px-5 py-2 text-sm text-rose-800"
                role="alert"
              >
                {replaceError}
              </p>
            ) : null}
            {hierarchyError ? (
              <p
                className="border-b border-rose-200 bg-rose-50 px-5 py-2 text-sm text-rose-800"
                role="alert"
              >
                {hierarchyError}
              </p>
            ) : null}
            {!files.loading && !files.error && files.items.length === 0 ? (
              <EmptyState label="files" />
            ) : null}

            {!files.error && files.items.length > 0 ? (
              <div className="overflow-x-auto">
                {!files.statusAvailable ? (
                  <p className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-900">
                    Index status is unavailable with the current Haystack
                    permissions.
                  </p>
                ) : null}
                <table className="w-full min-w-260 table-fixed border-collapse text-left">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-[0.06em] text-(--ec-mute)">
                    <tr>
                      <th className="w-[28%] px-5 py-3 font-semibold">File</th>
                      <th className="w-40 px-3 py-3 font-semibold">
                        Authority
                      </th>
                      {files.scope === "project" ? (
                        <th className="w-52 px-3 py-3 font-semibold">
                          Projects
                        </th>
                      ) : null}
                      <th className="w-48 px-3 py-3 font-semibold">Tags</th>
                      <th className="w-32 px-3 py-3 font-semibold">Created</th>
                      <th className="w-28 px-3 py-3 font-semibold">Status</th>
                      <th className="w-60 px-5 py-3 text-right font-semibold">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.items.map((file) => (
                      <tr
                        key={file.id}
                        className="border-t border-slate-100 align-middle"
                      >
                        <td className="px-5 py-3">
                          <p
                            className="max-w-sm truncate text-sm font-semibold text-slate-900"
                            title={file.name}
                          >
                            {file.name}
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            {formatSize(file.size)} · ID {file.id.slice(0, 12)}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          <AuthorityRank
                            file={file}
                            updating={files.updatingFileId === file.id}
                            canMutate={files.canManageFiles && file.canMutate}
                            onChange={(authorityCategory) =>
                              handleAuthorityCategoryChange(
                                file,
                                authorityCategory,
                              )
                            }
                          />
                        </td>
                        {files.scope === "project" ? (
                          <td className="px-3 py-3">
                            <ProjectAssignments
                              file={file}
                              canManageFiles={files.canManageFiles}
                              onRemove={(projectId) =>
                                void handleUnassign(file.id, projectId)
                              }
                            />
                            <select
                              className="mt-1 h-7 max-w-44 rounded border border-(--ec-line) bg-white px-2 text-[11px]"
                              defaultValue=""
                              disabled={
                                assignmentFileId === file.id || !files.canManageFiles || !file.canMutate
                              }
                              aria-label={`Assign ${file.name} to a project`}
                              onFocus={() => void loadProjects()}
                              onChange={(event) => {
                                void handleAssign(file.id, event.target.value);
                                event.currentTarget.value = "";
                              }}
                            >
                              <option value="">+ Add to project</option>
                              {projects
                                .filter(
                                  (project) =>
                                    project.role === "admin" &&
                                    !file.projects.some(
                                      (assigned) => assigned.id === project.id,
                                    ),
                                )
                                .map((project) => (
                                  <option key={project.id} value={project.id}>
                                    {project.name}
                                  </option>
                                ))}
                            </select>
                          </td>
                        ) : null}
                        <td className="px-3 py-3">
                          <Tags tags={file.tags} />
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-700">
                          {formatDate(file.createdAt)}
                        </td>
                        <td className="px-3 py-3">
                          <StatusBadge status={file.status} />
                        </td>
                        <td className="px-5 py-3">
                          <Actions
                            file={file}
                            canManageFiles={files.canManageFiles}
                            canMutate={files.canManageFiles && file.canMutate}
                            onView={setPreviewFile}
                            onUpdate={handleUpdate}
                            onDelete={handleDelete}
                            deleting={files.deletingFileId === file.id}
                            replacing={files.replacingFileId === file.id}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {!files.error ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
                <p className="text-xs text-slate-500" aria-live="polite">
                  {files.loading
                    ? "Loading files…"
                    : `Page ${files.currentPage} of ${files.totalPages} · ${files.rangeStart}–${files.rangeEnd} of ${files.total} files`}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!files.canGoPrevious}
                    onClick={files.previous}
                  >
                    <ChevronLeft className="size-4" aria-hidden />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!files.canGoNext}
                    onClick={files.next}
                  >
                    Next
                    <ChevronRight className="size-4" aria-hidden />
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
      <FilePreviewDialog file={previewFile} onClose={closePreview} />
    </>
  );
}