"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, LoaderCircle } from "lucide-react";
import type { ProjectSummary } from "@/components/projects/projectTypes";
import type { WikiPageView } from "@/lib/wiki";
import { useWikiPage, useWikiSearch, useWikiTree } from "./hooks/useWiki";
import { WikiArticle } from "./WikiArticle";
import { WikiEditor, type WikiEditorDraft } from "./WikiEditor";
import { WikiTree } from "./WikiTree";

type WikiClientProps = Readonly<{
  initialProjectId?: string;
  initialPageId?: string;
}>;

type Mode =
  | Readonly<{ kind: "view" }>
  | Readonly<{ kind: "create"; parentId: string | null }>
  | Readonly<{ kind: "edit" }>;

const EMPTY_DRAFT: WikiEditorDraft = {
  title: "",
  summary: "",
  content: "",
  status: "draft",
  authorityRank: null,
  parentId: null,
  sources: [],
};

export function WikiClient({ initialProjectId, initialPageId }: WikiClientProps) {
  const router = useRouter();
  const [projectId, setProjectId] = useState<string | null>(initialProjectId ?? null);
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [chosenPageId, setChosenPageId] = useState<string | undefined>(initialPageId);
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  const tree = useWikiTree(projectId);
  // Without an explicit choice, the first root page of the knowledge base is shown.
  const selectedPageId =
    chosenPageId ??
    (mode.kind === "view" && !tree.loading
      ? (tree.pages.find((page) => !page.parentId) ?? tree.pages[0])?.id
      : undefined);
  const setSelectedPageId = setChosenPageId;
  const detail = useWikiPage(selectedPageId);
  const search = useWikiSearch(projectId);

  useEffect(() => {
    let active = true;
    void fetch("/api/projects", { cache: "no-store" })
      .then((response) =>
        response.ok ? (response.json() as Promise<{ projects: ProjectSummary[] }>) : { projects: [] },
      )
      .then((payload) => {
        if (active) setProjects(payload.projects);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (projectId) params.set("project", projectId);
    if (selectedPageId) params.set("page", selectedPageId);
    const query = params.toString();
    router.replace(query ? `/wiki?${query}` : "/wiki", { scroll: false });
  }, [projectId, router, selectedPageId]);

  const knowledgeBaseName = tree.knowledgeBase?.name ?? "Knowledge base";
  const canEdit = tree.knowledgeBase?.canEdit ?? false;

  const editorDraft = useMemo<WikiEditorDraft>(() => {
    if (mode.kind === "edit" && detail.page) {
      return {
        title: detail.page.title,
        summary: detail.page.summary ?? "",
        content: detail.page.content,
        status: detail.page.status,
        authorityRank: detail.page.authorityRank,
        parentId: detail.page.parentId,
        sources: detail.page.sources.map((source) => ({
          haystackFileId: source.haystackFileId,
          documentId: source.documentId,
          fileName: source.fileName,
          locator: source.locator,
          quote: source.quote,
          pageNumber: source.pageNumber,
          authorityRank: source.authorityRank,
        })),
      };
    }
    if (mode.kind === "create") return { ...EMPTY_DRAFT, parentId: mode.parentId };
    return EMPTY_DRAFT;
  }, [detail.page, mode]);

  function changeKnowledgeBase(value: string): void {
    setProjectId(value || null);
    setSelectedPageId(undefined);
    setMode({ kind: "view" });
    search.setQuery("");
  }

  function selectPage(pageId: string): void {
    setSelectedPageId(pageId);
    setMode({ kind: "view" });
  }

  function handleSaved(page: WikiPageView): void {
    tree.refresh();
    detail.setPage(page);
    setSelectedPageId(page.id);
    setMode({ kind: "view" });
  }

  function handleDeleted(): void {
    tree.refresh();
    setSelectedPageId(undefined);
    setMode({ kind: "view" });
  }

  return (
    <section className="flex h-full min-h-0 flex-1 overflow-hidden bg-white" aria-label="Knowledge base">
      <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-slate-50">
        <div className="border-b border-slate-200 px-3 py-3">
          <div className="flex items-center gap-2">
            <BookOpen className="size-4 text-(--ec-blue)" aria-hidden />
            <h2 className="text-sm font-semibold text-(--ec-blue)">Knowledge base</h2>
          </div>
          <label className="mt-2 block">
            <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-(--ec-mute)">Scope</span>
            <select
              aria-label="Knowledge base scope"
              className="mt-1 h-8 w-full rounded-md border border-(--ec-line) bg-white px-2 text-xs font-semibold text-(--ec-blue)"
              value={projectId ?? ""}
              onChange={(event) => changeKnowledgeBase(event.target.value)}
            >
              <option value="">Global knowledge base</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </label>
          {tree.knowledgeBase ? (
            <p className="mt-2 text-[11px] text-(--ec-mute)">
              {tree.pages.length} {tree.pages.length === 1 ? "page" : "pages"}
              {canEdit ? " · you can edit" : " · read only"}
            </p>
          ) : null}
        </div>
        {tree.error ? (
          <p className="p-3 text-xs text-rose-700" role="alert">{tree.error}</p>
        ) : tree.loading && tree.pages.length === 0 ? (
          <div className="flex items-center gap-2 p-4 text-xs text-(--ec-mute)">
            <LoaderCircle className="size-4 animate-spin" aria-hidden /> Loading…
          </div>
        ) : (
          <WikiTree
            pages={tree.pages}
            selectedPageId={selectedPageId}
            canEdit={canEdit}
            searchQuery={search.query}
            searchHits={search.hits}
            searching={search.searching}
            onSearchChange={search.setQuery}
            onSelect={selectPage}
            onCreate={(parentId) => setMode({ kind: "create", parentId })}
          />
        )}
      </aside>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        {mode.kind === "create" || (mode.kind === "edit" && detail.page) ? (
          <WikiEditor
            key={mode.kind === "edit" ? `edit-${detail.page?.id}` : `create-${mode.parentId ?? "root"}`}
            projectId={projectId}
            knowledgeBaseName={knowledgeBaseName}
            pages={tree.pages}
            existing={mode.kind === "edit" ? detail.page : null}
            initialDraft={editorDraft}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
            onCancel={() => setMode({ kind: "view" })}
          />
        ) : detail.loading ? (
          <div className="flex min-h-full items-center justify-center text-sm text-(--ec-mute)">
            <LoaderCircle className="mr-2 size-4 animate-spin" aria-hidden /> Loading page…
          </div>
        ) : detail.error ? (
          <p className="m-8 border-l-4 border-rose-600 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
            {detail.error}
          </p>
        ) : detail.page ? (
          <WikiArticle
            page={detail.page}
            knowledgeBaseName={knowledgeBaseName}
            onEdit={() => setMode({ kind: "edit" })}
            onNavigate={selectPage}
          />
        ) : (
          <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center px-6 py-12">
            <span className="flex size-11 items-center justify-center rounded-sm bg-(--ec-yellow) font-serif text-xl font-bold text-(--ec-blue)">
              A
            </span>
            <h3 className="mt-4 font-serif text-2xl font-bold text-(--ec-blue)">
              A knowledge base built to be read by machines
            </h3>
            <p className="mt-3 text-base leading-7 text-slate-600">
              Instead of chopping documents into chunks and letting the model reconcile fragments at
              question time, the knowledge base consolidates the corpus upfront: one curated page per
              topic, duplicates removed, contradictions resolved, and every statement traced to the
              instrument that governs it. ALINA reads these pages first and falls back to raw
              retrieval only when no page answers.
            </p>
            <p className="mt-3 text-sm text-(--ec-mute)">
              {tree.pages.length === 0
                ? canEdit
                  ? "This knowledge base is empty. Create a first page from the sidebar, or save an ALINA answer to the wiki from the Global tab."
                  : "This knowledge base has no published pages yet."
                : "Pick a page in the sidebar to start reading."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
