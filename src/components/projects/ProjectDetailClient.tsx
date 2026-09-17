"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FilePlus2, FileText, LoaderCircle, MessageSquareText, Search, Trash2, Users, X } from "lucide-react";
import { FilePreviewDialog } from "@/components/documents/FilePreviewDialog";
import { UploadDocumentsPanel } from "@/components/documents/UploadDocumentsPanel";
import { UserAvatar } from "@/components/UserAvatar";
import type { FileItem } from "@/components/documents/hooks/useFiles";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useModalLifecycle } from "@/components/ui/hooks/useModalLifecycle";
import { cn } from "@/lib/utils";
import { projectApiError, type ProjectMember, type ProjectRole, type ProjectSummary } from "./projectTypes";

type DetailPayload = Readonly<{
  project: ProjectSummary;
  members: ProjectMember[];
  fileIds: string[];
}>;

type Candidate = Readonly<{ id: string; displayName: string; email: string | null }>;

export function ProjectDetailClient({ projectId }: { projectId: string }) {
  const [detail, setDetail] = useState<DetailPayload>();
  const [allFiles, setAllFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [memberQuery, setMemberQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [memberSearchLoading, setMemberSearchLoading] = useState(false);
  const [memberSearchError, setMemberSearchError] = useState<string>();
  const [deleteFile, setDeleteFile] = useState<FileItem>();

  useModalLifecycle({
    open: pickerOpen,
    onEscape: () => setPickerOpen(false),
    lockBodyScroll: true,
  });

  async function load(): Promise<void> {
    setLoading(true);
    try {
      const [detailResponse, filesResponse] = await Promise.all([
        fetch(`/api/projects/${projectId}`, { cache: "no-store" }),
        fetch("/api/haystack/files?limit=100&scope=project", {
          cache: "no-store",
        }),
      ]);
      if (!detailResponse.ok) throw await projectApiError(detailResponse, "Could not load the project.");
      if (!filesResponse.ok) throw await projectApiError(filesResponse, "Could not load the document corpus.");
      const [detailPayload, filesPayload] = await Promise.all([
        detailResponse.json() as Promise<DetailPayload>,
        filesResponse.json() as Promise<{ items: FileItem[] }>,
      ]);
      setDetail(detailPayload);
      setAllFiles(filesPayload.items);
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load the project.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch(`/api/projects/${projectId}`, { cache: "no-store" }),
      fetch("/api/haystack/files?limit=100&scope=project", {
        cache: "no-store",
      }),
    ])
      .then(async ([detailResponse, filesResponse]) => {
        if (!detailResponse.ok)
          throw await projectApiError(
            detailResponse,
            "Could not load the project.",
          );
        if (!filesResponse.ok)
          throw await projectApiError(
            filesResponse,
            "Could not load the document corpus.",
          );
        return Promise.all([
          detailResponse.json() as Promise<DetailPayload>,
          filesResponse.json() as Promise<{ items: FileItem[] }>,
        ]);
      })
      .then(([detailPayload, filesPayload]) => {
        if (!active) return;
        setDetail(detailPayload);
        setAllFiles(filesPayload.items);
        setError(undefined);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load the project.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [projectId]);

  useEffect(() => {
    const query = memberQuery.trim();
    if (!query) {
      // Defer state updates to avoid synchronous setState in effect
      Promise.resolve().then(() => {
        setCandidates([]);
        setMemberSearchLoading(false);
        setMemberSearchError(undefined);
      });
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      // Defer loading state to async callback
      Promise.resolve().then(() => {
        setMemberSearchLoading(true);
        setMemberSearchError(undefined);
      });
      void fetch(`/api/projects/${projectId}/members/candidates?query=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw await projectApiError(response, "Could not search users.");
          return (await response.json()) as { candidates: Candidate[] };
        })
        .then((payload) => setCandidates(payload.candidates))
        .catch((reason) => {
          if (controller.signal.aborted) return;
          setMemberSearchError(reason instanceof Error ? reason.message : "Could not search users.");
          setCandidates([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setMemberSearchLoading(false);
        });
    }, 300);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [memberQuery, projectId]);

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-8 sm:px-6" aria-live="polite">
        <div className="ec-card flex items-center gap-3 rounded-lg p-4 text-(--ec-blue)">
          <LoaderCircle className="size-5 animate-spin" aria-hidden />
          <p className="text-sm font-semibold">Loading project details...</p>
        </div>
      </div>
    );
  }
  if (!detail) return <div className="mx-auto w-full max-w-7xl p-8"><p className="border-l-4 border-rose-600 bg-white p-4 text-rose-800">{error ?? "Project not found."}</p></div>;

  const admin = detail.project.role === "admin";
  const projectFiles = allFiles.filter((file) => detail.fileIds.includes(file.id) && (!search || `${file.name} ${file.tags.join(" ")}`.toLowerCase().includes(search.toLowerCase())));
  const pickerFiles = allFiles.filter(
    (file) =>
      file.canMutate &&
      !detail.fileIds.includes(file.id) &&
      (!pickerSearch ||
        `${file.name} ${file.tags.join(" ")}`
          .toLowerCase()
          .includes(pickerSearch.toLowerCase())),
  );

  async function addFiles(): Promise<void> {
    const response = await fetch(`/api/projects/${projectId}/files`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileIds: selectedFiles }) });
    if (!response.ok) { setError((await projectApiError(response, "Could not add documents.")).message); return; }
    setPickerOpen(false); setSelectedFiles([]); await load();
  }

  async function removeFile(): Promise<void> {
    if (!deleteFile) return;
    const response = await fetch(`/api/projects/${projectId}/files/${deleteFile.id}`, { method: "DELETE" });
    if (!response.ok) { setError((await projectApiError(response, "Could not remove the document.")).message); return; }
    setDeleteFile(undefined); await load();
  }

  async function addMember(candidate: Candidate): Promise<void> {
    const response = await fetch(`/api/projects/${projectId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: candidate.id, role: "member" }) });
    if (!response.ok) { setError((await projectApiError(response, "Could not add the member.")).message); return; }
    setMemberQuery(""); setCandidates([]); await load();
  }

  async function changeRole(member: ProjectMember, role: ProjectRole): Promise<void> {

    const response = await fetch(`/api/projects/${projectId}/members/${member.userId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
    if (!response.ok) { setError((await projectApiError(response, "Could not change the member role.")).message); return; }
    await load();
  }

  async function removeMember(member: ProjectMember): Promise<void> {
    const response = await fetch(`/api/projects/${projectId}/members/${member.userId}`, { method: "DELETE" });
    if (!response.ok) { setError((await projectApiError(response, "Could not remove the member.")).message); return; }
    await load();
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href="/projects"
            className="inline-flex items-center gap-1 text-sm font-semibold text-(--ec-blue)"
          >
            <ArrowLeft className="size-4" />
            Projects
          </Link>
          <h2 className="mt-2 font-serif text-2xl font-bold text-(--ec-blue)">
            {detail.project.name}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Project workspace ·{" "}
            {detail.project.role === "admin" ? "Project admin" : "Member"}
          </p>
        </div>
        <Link
          href={`/global?project=${projectId}`}
          className={cn(buttonVariants(), "font-semibold")}
        >
          <MessageSquareText className="size-4" />
          Ask in this project
        </Link>
      </div>
      {error ? (
        <p
          className="border-l-4 border-rose-600 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-(--ec-line) bg-(--ec-line) sm:grid-cols-4">
        {[
          { label: "Documents", value: detail.fileIds.length },
          { label: "Members", value: detail.members.length },
          {
            label: "Access",
            value: detail.project.role === "admin" ? "Admin" : "Member",
          },
          {
            label: "Updated",
            value: new Intl.DateTimeFormat("en-GB", {
              day: "numeric",
              month: "short",
            }).format(new Date(detail.project.updatedAt)),
          },
        ].map((stat) => (
          <div key={stat.label} className="bg-white p-4">
            <dt className="text-xs uppercase tracking-[0.06em] text-slate-500">
              {stat.label}
            </dt>
            <dd className="mt-1 text-xl font-bold text-(--ec-blue)">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      <section className="ec-card overflow-hidden rounded-lg">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-(--ec-line) px-5 py-4">
          <div>
            <h3 className="font-bold text-(--ec-blue)">Project files</h3>
            <p className="text-sm text-slate-500">
              These project-specific files are used alongside all global files
              in project conversations.
            </p>
          </div>
          {admin ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setPickerOpen(true)}>
                <FilePlus2 className="size-4" />
                Add existing
              </Button>
              <Button onClick={() => setUploadOpen((open) => !open)}>
                <FilePlus2 className="size-4" />
                {uploadOpen ? "Close upload" : "Upload project files"}
              </Button>
            </div>
          ) : null}
        </header>
        {uploadOpen ? (
          <UploadDocumentsPanel
            projectId={projectId}
            onClose={() => setUploadOpen(false)}
            onComplete={({ uploadedFileIds, failed }) => {
              if (uploadedFileIds.length > 0) void load();
              if (failed === 0) setUploadOpen(false);
            }}
          />
        ) : null}
        <label className="relative block border-b border-slate-200 p-4">
          <span className="sr-only">Search project documents</span>
          <Search className="pointer-events-none absolute left-7 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            className="ec-input h-9 rounded-md"
            style={{ paddingLeft: "2.75rem" }}
            placeholder="Search by file name or tag"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {projectFiles.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">
            {detail.fileIds.length
              ? "No documents match this filter."
              : "No documents have been attached yet."}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {projectFiles.map((file) => (
              <li
                key={file.id}
                className="flex flex-wrap items-center gap-3 px-5 py-3"
              >
                <FileText className="size-5 text-(--ec-blue)" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{file.name}</p>
                  <p className="text-xs text-slate-500">
                    {file.status} · {file.tags.join(", ") || "No tags"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPreviewFile(file)}
                >
                  View
                </Button>
                {admin ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 text-rose-700"
                    title="Remove from project"
                    aria-label={`Remove ${file.name} from project`}
                    onClick={() => setDeleteFile(file)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ec-card rounded-lg p-5">
        <div className="flex items-center gap-2">
          <Users className="size-5 text-(--ec-blue)" />
          <h3 className="font-bold text-(--ec-blue)">Access</h3>
        </div>
        <ul className="mt-4 divide-y divide-slate-100 border-y border-slate-100">
          {detail.members.map((member) => (
            <li
              key={member.userId}
              className="flex flex-wrap items-center gap-3 py-3"
            >
              <UserAvatar
                name={member.displayName}
                email={member.email}
                className="size-9 text-xs"
                ariaLabel={`Avatar for ${member.displayName}`}
              />
              <div className="min-w-48 flex-1">
                <p className="text-sm font-semibold">{member.displayName}</p>
                <p className="text-xs text-slate-500">
                  {member.email ?? "No email"}
                </p>
              </div>
              {admin ? (
                <>
                  <select
                    className="h-8 rounded-md border border-(--ec-line) bg-white px-2 text-xs"
                    value={member.role}
                    onChange={(event) =>
                      void changeRole(member, event.target.value as ProjectRole)
                    }
                    aria-label={`Role for ${member.displayName}`}
                  >
                    <option value="admin">Project admin</option>
                    <option value="member">Member</option>
                  </select>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    title="Remove member"
                    aria-label={`Remove ${member.displayName}`}
                    onClick={() => void removeMember(member)}
                  >
                    <X className="size-4" />
                  </Button>
                </>
              ) : (
                <span className="text-xs font-semibold uppercase text-slate-500">
                  {member.role}
                </span>
              )}
            </li>
          ))}
        </ul>
        {admin ? (
          <div className="mt-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                className="ec-input h-9 rounded-md px-9!"
                value={memberQuery}
                onChange={(event) => setMemberQuery(event.target.value)}
                placeholder="Find an existing ALINA user"
                aria-label="Find an existing ALINA user"
              />
              {memberSearchLoading ? (
                <LoaderCircle className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-slate-400" />
              ) : memberQuery ? (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Clear search"
                  onClick={() => {
                    setMemberQuery("");
                    setCandidates([]);
                  }}
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>
            {memberSearchError ? (
              <p className="mt-2 text-xs text-red-600">{memberSearchError}</p>
            ) : memberQuery.trim() &&
              !memberSearchLoading &&
              !candidates.length ? (
              <p className="mt-2 text-xs text-slate-500">
                No ALINA users match &ldquo;{memberQuery.trim()}&rdquo;.
              </p>
            ) : null}
            {candidates.length ? (
              <ul className="mt-2 border border-(--ec-line) bg-white">
                {candidates.map((candidate) => (
                  <li
                    key={candidate.id}
                    className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <UserAvatar
                        name={candidate.displayName}
                        email={candidate.email}
                        className="size-8"
                        ariaLabel={`Avatar for ${candidate.displayName}`}
                      />
                      <div>
                        <p className="text-sm font-semibold">
                          {candidate.displayName}
                        </p>
                        <p className="text-xs text-slate-500">
                          {candidate.email}
                        </p>
                      </div>
                    </div>
                    <Button size="sm" onClick={() => void addMember(candidate)}>
                      Add
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      {pickerOpen ? (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/45 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="picker-title"
            className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
          >
            <header className="flex items-center justify-between border-b border-(--ec-line) p-4">
              <div>
                <h3 id="picker-title" className="font-bold text-(--ec-blue)">
                  Add existing project files
                </h3>
                <p className="text-sm text-slate-500">
                  Choose project files you manage. Global files are already
                  available automatically.
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setPickerOpen(false)}
                aria-label="Close document picker"
              >
                <X />
              </Button>
            </header>
            <div className="border-b border-slate-200 p-3">
              <input
                className="ec-input h-9 rounded-md"
                autoFocus
                value={pickerSearch}
                onChange={(event) => setPickerSearch(event.target.value)}
                placeholder="Search by file name or tag"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {pickerFiles.map((file) => (
                <label
                  key={file.id}
                  className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-4 py-3 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedFiles.includes(file.id)}
                    onChange={() =>
                      setSelectedFiles((current) =>
                        current.includes(file.id)
                          ? current.filter((id) => id !== file.id)
                          : [...current, file.id],
                      )
                    }
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {file.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {file.status} · {file.tags.join(", ") || "No tags"}
                    </p>
                  </div>
                </label>
              ))}
            </div>
            <footer className="flex items-center justify-between border-t border-(--ec-line) bg-slate-50 p-4">
              <p className="text-xs text-slate-500">
                {selectedFiles.length} selected
              </p>
              <Button
                disabled={!selectedFiles.length}
                onClick={() => void addFiles()}
              >
                Add files
              </Button>
            </footer>
          </section>
        </div>
      ) : null}
      <ConfirmDialog
        open={Boolean(deleteFile)}
        title="Remove document from project?"
        description={
          deleteFile
            ? `“${deleteFile.name}” stays in the shared corpus but will no longer be used in this project.`
            : ""
        }
        confirmLabel="Remove"
        onCancel={() => setDeleteFile(undefined)}
        onConfirm={() => void removeFile()}
      />
      <FilePreviewDialog
        file={previewFile}
        onClose={() => setPreviewFile(null)}
      />
    </div>
  );
}