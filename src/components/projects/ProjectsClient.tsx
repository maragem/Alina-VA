"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileText, FolderOpen, MessageSquareText, Pencil, Plus, Trash2, Users } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { UndoToast } from "@/components/ui/undo-toast";
import { cn } from "@/lib/utils";
import { projectApiError, type ProjectSummary } from "./projectTypes";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

export function ProjectsClient() {
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [renameId, setRenameId] = useState<string>();
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary>();
  const [deleting, setDeleting] = useState(false);
  const [undoProject, setUndoProject] = useState<ProjectSummary>();
  const undoTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/projects", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw await projectApiError(response, "Could not load projects.");
        return response.json() as Promise<{ projects: ProjectSummary[] }>;
      })
      .then((payload) => {
        if (!active) return;
        setProjects(payload.projects);
        setError(undefined);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load projects.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    };
  }, []);

  async function create(): Promise<void> {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (!response.ok) throw await projectApiError(response, "Could not create the project.");
      const payload = (await response.json()) as { project: ProjectSummary };
      setProjects((current) => [payload.project, ...current]);
      setNewName("");
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create the project.");
    } finally {
      setCreating(false);
    }
  }

  async function rename(project: ProjectSummary): Promise<void> {
    if (!renameValue.trim()) return;
    const response = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renameValue }),
    });
    if (!response.ok) {
      setError((await projectApiError(response, "Could not rename the project.")).message);
      return;
    }
    setProjects((current) => current.map((item) => item.id === project.id ? { ...item, name: renameValue.trim() } : item));
    setRenameId(undefined);
  }

  async function remove(): Promise<void> {
    if (!deleteTarget) return;
    setDeleting(true);
    const response = await fetch(`/api/projects/${deleteTarget.id}`, { method: "DELETE" });
    setDeleting(false);
    if (!response.ok) {
      setError((await projectApiError(response, "Could not delete the project.")).message);
      return;
    }
    const removed = deleteTarget;
    setProjects((current) => current.filter((project) => project.id !== removed.id));
    setDeleteTarget(undefined);
    setUndoProject(removed);
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(() => setUndoProject(undefined), 8_000);
  }

  async function undo(): Promise<void> {
    if (!undoProject) return;
    const response = await fetch(`/api/projects/${undoProject.id}/restore`, { method: "POST" });
    if (!response.ok) {
      setError((await projectApiError(response, "Could not restore the project.")).message);
      return;
    }
    setProjects((current) => [undoProject, ...current]);
    setUndoProject(undefined);
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <section className="mb-5 flex flex-wrap items-end gap-3 border border-(--ec-line) bg-white p-4 shadow-sm">
        <label className="min-w-60 flex-1">
          <span className="mb-1 block text-xs font-bold uppercase tracking-[0.06em] text-slate-500">New project</span>
          <input className="ec-input h-10 rounded-md" value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void create(); }} placeholder="Project name" maxLength={100} />
        </label>
        <Button onClick={() => void create()} disabled={!newName.trim() || creating}>
          <Plus className="size-4" aria-hidden />{creating ? "Creating…" : "Create project"}
        </Button>
      </section>

      {error ? <p className="mb-4 border-l-4 border-rose-600 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">{error}</p> : null}
      {loading ? <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((item) => <div key={item} className="h-64 animate-pulse bg-white" />)}</div> : null}
      {!loading && projects.length === 0 ? (
        <div className="border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <FolderOpen className="mx-auto size-9 text-slate-400" aria-hidden />
          <h2 className="mt-3 text-lg font-bold text-slate-900">No projects yet</h2>
          <p className="mt-1 text-sm text-slate-600">Create one to group documents and ask questions within a controlled scope.</p>
        </div>
      ) : null}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {projects.map((project) => (
          <article key={project.id} className="ec-card flex min-h-64 flex-col rounded-lg p-5">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-blue-50 text-(--ec-blue)"><FolderOpen className="size-5" aria-hidden /></span>
              <div className="min-w-0 flex-1">
                {renameId === project.id ? (
                  <div className="flex gap-2">
                    <input className="ec-input h-8 rounded-md" autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} aria-label="Project name" onKeyDown={(event) => { if (event.key === "Enter") void rename(project); if (event.key === "Escape") setRenameId(undefined); }} />
                    <Button size="sm" onClick={() => void rename(project)}>Save</Button>
                  </div>
                ) : <h2 className="truncate text-lg font-bold text-(--ec-blue)" title={project.name}>{project.name}</h2>}
                <p className="mt-1 text-xs text-slate-500">Updated {formatDate(project.updatedAt)}</p>
              </div>
              {project.role === "admin" ? (
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" className="size-8" title="Rename project" aria-label="Rename project" onClick={() => { setRenameId(project.id); setRenameValue(project.name); }}><Pencil className="size-4" /></Button>
                  <Button size="icon" variant="ghost" className="size-8 text-rose-700" title="Delete project" aria-label="Delete project" onClick={() => setDeleteTarget(project)}><Trash2 className="size-4" /></Button>
                </div>
              ) : null}
            </div>
            <dl className="mt-6 grid grid-cols-2 border-y border-slate-100 py-4">
              <div className="flex items-center gap-2"><FileText className="size-4 text-slate-400" /><div><dt className="text-xs text-slate-500">Documents</dt><dd className="font-bold">{project.fileCount}</dd></div></div>
              <div className="flex items-center gap-2"><Users className="size-4 text-slate-400" /><div><dt className="text-xs text-slate-500">Members</dt><dd className="font-bold">{project.memberCount}</dd></div></div>
            </dl>
            <div className="mt-auto flex gap-2 pt-5">
              <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }), "flex-1")} href={`/projects/${project.id}`}>Open project</Link>
              <Link className={cn(buttonVariants({ size: "sm" }), "flex-1")} href={`/global?project=${project.id}`}><MessageSquareText className="size-4" />Ask</Link>
            </div>
          </article>
        ))}
      </div>
      <ConfirmDialog open={Boolean(deleteTarget)} title="Delete project?" description={deleteTarget ? `“${deleteTarget.name}” will disappear for every member. Its documents remain in the corpus.` : ""} busy={deleting} onCancel={() => setDeleteTarget(undefined)} onConfirm={() => void remove()} />
      <UndoToast message={undoProject ? `Deleted “${undoProject.name}”.` : null} onUndo={() => void undo()} />
    </div>
  );
}