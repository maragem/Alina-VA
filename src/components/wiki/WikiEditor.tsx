"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, LoaderCircle, Plus, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiError } from "@/lib/apiError";
import {
  authorityLevelLabel,
  WIKI_STATUS_LABELS,
  WIKI_STATUSES,
  type WikiPageSummary,
  type WikiPageView,
  type WikiSourceInput,
  type WikiStatus,
} from "@/lib/wiki";

export type WikiEditorDraft = Readonly<{
  title: string;
  summary: string;
  content: string;
  status: WikiStatus;
  authorityRank: number | null;
  parentId: string | null;
  sources: readonly WikiSourceInput[];
  sourceMessageId?: string | null;
}>;

type WikiEditorProps = Readonly<{
  projectId: string | null;
  knowledgeBaseName: string;
  pages: readonly WikiPageSummary[];
  existing: WikiPageView | null;
  initialDraft: WikiEditorDraft;
  onSaved: (page: WikiPageView) => void;
  onDeleted: () => void;
  onCancel: () => void;
}>;

type CorpusFile = Readonly<{
  id: string;
  name: string;
  authorityRank: number | null;
}>;

const EMPTY_SOURCE: WikiSourceInput = {
  haystackFileId: null,
  documentId: null,
  fileName: "",
  locator: null,
  quote: null,
  pageNumber: null,
  authorityRank: null,
};

function descendantsOf(pages: readonly WikiPageSummary[], pageId: string): Set<string> {
  const result = new Set<string>([pageId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const page of pages) {
      if (page.parentId && result.has(page.parentId) && !result.has(page.id)) {
        result.add(page.id);
        changed = true;
      }
    }
  }
  return result;
}

export function WikiEditor({
  projectId,
  knowledgeBaseName,
  pages,
  existing,
  initialDraft,
  onSaved,
  onDeleted,
  onCancel,
}: WikiEditorProps) {
  const [draft, setDraft] = useState<WikiEditorDraft>(initialDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [fileQuery, setFileQuery] = useState("");
  const [fileHits, setFileHits] = useState<readonly CorpusFile[]>([]);
  const [fileSearching, setFileSearching] = useState(false);
  const excluded = existing ? descendantsOf(pages, existing.id) : new Set<string>();

  useEffect(() => {
    const query = fileQuery.trim();
    if (!query) {
      const reset = setTimeout(() => setFileHits([]), 0);
      return () => clearTimeout(reset);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setFileSearching(true);
      const params = new URLSearchParams({ name: query, limit: "8" });
      void fetch(`/api/haystack/files?${params}`, { signal: controller.signal })
        .then(async (response) =>
          response.ok
            ? ((await response.json()) as { items: CorpusFile[] })
            : { items: [] as CorpusFile[] },
        )
        .then((payload) => setFileHits(payload.items))
        .catch(() => undefined)
        .finally(() => {
          if (!controller.signal.aborted) setFileSearching(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [fileQuery]);

  function update<K extends keyof WikiEditorDraft>(key: K, value: WikiEditorDraft[K]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateSource(index: number, patch: Partial<WikiSourceInput>): void {
    setDraft((current) => ({
      ...current,
      sources: current.sources.map((source, position) =>
        position === index ? { ...source, ...patch } : source,
      ),
    }));
  }

  function moveSource(index: number, delta: number): void {
    setDraft((current) => {
      const next = [...current.sources];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, sources: next };
    });
  }

  function removeSource(index: number): void {
    setDraft((current) => ({
      ...current,
      sources: current.sources.filter((_, position) => position !== index),
    }));
  }

  function addSourceFromCorpus(file: CorpusFile): void {
    setDraft((current) => ({
      ...current,
      sources: [
        ...current.sources,
        { ...EMPTY_SOURCE, haystackFileId: file.id, fileName: file.name, authorityRank: file.authorityRank },
      ],
    }));
    setFileQuery("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving) return;
    if (!draft.title.trim()) {
      setError("A title is required.");
      return;
    }
    if (draft.sources.some((source) => !source.fileName.trim())) {
      setError("Every source needs a file name.");
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const payload = {
        projectId,
        parentId: draft.parentId,
        title: draft.title,
        summary: draft.summary.trim() || null,
        content: draft.content,
        status: draft.status,
        authorityRank: draft.authorityRank,
        sources: draft.sources.map((source) => ({
          ...source,
          fileName: source.fileName.trim(),
        })),
        ...(existing ? {} : { sourceMessageId: draft.sourceMessageId ?? null }),
      };
      const response = await fetch(existing ? `/api/wiki/pages/${existing.id}` : "/api/wiki/pages", {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw await apiError(response, "The page could not be saved.");
      const saved = (await response.json()) as { page: WikiPageView };
      onSaved(saved.page);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The page could not be saved.");
      setSaving(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!existing) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/wiki/pages/${existing.id}`, { method: "DELETE" });
      if (!response.ok) throw await apiError(response, "The page could not be deleted.");
      onDeleted();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The page could not be deleted.");
      setSaving(false);
      setConfirmDelete(false);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-8 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ec-mute)">{knowledgeBaseName}</p>
          <h2 className="mt-1 font-serif text-2xl font-bold text-(--ec-blue)">
            {existing ? "Edit page" : "New page"}
          </h2>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : null}
            {existing ? "Save changes" : "Create page"}
          </Button>
        </div>
      </div>

      {error ? (
        <p className="mt-4 border-l-4 border-rose-600 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <label className="block text-xs font-semibold text-(--ec-mute)">
          Title
          <Input className="mt-1" value={draft.title} onChange={(event) => update("title", event.target.value)} required maxLength={160} disabled={saving} />
        </label>
        <label className="block text-xs font-semibold text-(--ec-mute)">
          Status
          <select
            className="mt-1 h-10 w-full rounded-md border border-(--ec-line) bg-white px-2 text-sm text-(--ec-ink)"
            value={draft.status}
            onChange={(event) => update("status", event.target.value as WikiStatus)}
            disabled={saving}
          >
            {WIKI_STATUSES.map((status) => (
              <option key={status} value={status}>{WIKI_STATUS_LABELS[status]}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold text-(--ec-mute)">
          Parent page
          <select
            className="mt-1 h-10 w-full rounded-md border border-(--ec-line) bg-white px-2 text-sm text-(--ec-ink)"
            value={draft.parentId ?? ""}
            onChange={(event) => update("parentId", event.target.value || null)}
            disabled={saving}
          >
            <option value="">Top level</option>
            {pages
              .filter((page) => !excluded.has(page.id))
              .map((page) => (
                <option key={page.id} value={page.id}>{page.title}</option>
              ))}
          </select>
        </label>
        <label className="block text-xs font-semibold text-(--ec-mute)">
          Governing authority level
          <select
            className="mt-1 h-10 w-full rounded-md border border-(--ec-line) bg-white px-2 text-sm text-(--ec-ink)"
            value={draft.authorityRank ?? ""}
            onChange={(event) => update("authorityRank", event.target.value ? Number(event.target.value) : null)}
            disabled={saving}
          >
            <option value="">Not set</option>
            {[1, 2, 3, 4].map((rank) => (
              <option key={rank} value={rank}>
                {authorityLevelLabel(rank)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-4 block text-xs font-semibold text-(--ec-mute)">
        Summary <span className="font-normal">(one paragraph the agent sees in search results)</span>
        <Textarea className="mt-1" rows={2} maxLength={600} value={draft.summary} onChange={(event) => update("summary", event.target.value)} disabled={saving} />
      </label>

      <label className="mt-4 block text-xs font-semibold text-(--ec-mute)">
        Content <span className="font-normal">(Markdown; write [1], [2] to cite the sources below in order)</span>
        <Textarea
          className="mt-1 min-h-80 font-mono text-[13px] leading-5"
          value={draft.content}
          onChange={(event) => update("content", event.target.value)}
          disabled={saving}
        />
      </label>

      <section className="mt-6" aria-labelledby="sources-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 id="sources-title" className="text-sm font-semibold text-(--ec-ink)">Sources</h3>
            <p className="text-xs text-(--ec-mute)">Every statement should trace to a corpus document. Order defines the [n] numbers.</p>
          </div>
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-(--ec-mute)" aria-hidden />
            <Input
              className="h-9 pl-7 text-xs"
              placeholder="Add a corpus document by name…"
              value={fileQuery}
              onChange={(event) => setFileQuery(event.target.value)}
              disabled={saving}
              aria-label="Search corpus documents"
            />
            {fileQuery.trim() ? (
              <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-(--ec-line) bg-white shadow-lg">
                {fileSearching && fileHits.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-(--ec-mute)">Searching…</li>
                ) : fileHits.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-(--ec-mute)">
                    No corpus file matches.{" "}
                    <button type="button" className="font-semibold text-(--ec-blue) hover:underline" onClick={() => { setDraft((current) => ({ ...current, sources: [...current.sources, { ...EMPTY_SOURCE, fileName: fileQuery.trim() }] })); setFileQuery(""); }}>
                      Add “{fileQuery.trim()}” anyway
                    </button>
                  </li>
                ) : (
                  fileHits.map((file) => (
                    <li key={file.id}>
                      <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-slate-50" onClick={() => addSourceFromCorpus(file)}>
                        <span className="truncate">{file.name}</span>
                        {file.authorityRank ? <span className="shrink-0 text-(--ec-mute)">L{file.authorityRank}</span> : null}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </div>
        </div>

        {draft.sources.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-slate-300 px-4 py-6 text-center text-xs text-(--ec-mute)">
            No sources yet. Search the corpus above, or{" "}
            <button type="button" className="font-semibold text-(--ec-blue) hover:underline" onClick={() => update("sources", [...draft.sources, EMPTY_SOURCE])}>
              add one manually
            </button>.
          </p>
        ) : (
          <ol className="mt-3 space-y-3">
            {draft.sources.map((source, index) => (
              <li key={index} className="rounded-md border border-(--ec-line) bg-white p-3">
                <div className="flex items-start gap-3">
                  <span className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-(--ec-blue)" aria-hidden>
                    {index + 1}
                  </span>
                  <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_5rem_8rem]">
                    <label className="text-[11px] font-semibold text-(--ec-mute)">
                      File name
                      <Input className="mt-0.5 h-8 text-xs" value={source.fileName} onChange={(event) => updateSource(index, { fileName: event.target.value })} required disabled={saving} />
                    </label>
                    <label className="text-[11px] font-semibold text-(--ec-mute)">
                      Locator <span className="font-normal">(article, section)</span>
                      <Input className="mt-0.5 h-8 text-xs" value={source.locator ?? ""} onChange={(event) => updateSource(index, { locator: event.target.value || null })} disabled={saving} placeholder="Article 2(47)" />
                    </label>
                    <label className="text-[11px] font-semibold text-(--ec-mute)">
                      Page
                      <Input className="mt-0.5 h-8 text-xs" type="number" min={1} value={source.pageNumber ?? ""} onChange={(event) => updateSource(index, { pageNumber: event.target.value ? Number(event.target.value) : null })} disabled={saving} />
                    </label>
                    <label className="text-[11px] font-semibold text-(--ec-mute)">
                      Authority
                      <select className="mt-0.5 h-8 w-full rounded-md border border-(--ec-line) bg-white px-1 text-xs" value={source.authorityRank ?? ""} onChange={(event) => updateSource(index, { authorityRank: event.target.value ? Number(event.target.value) : null })} disabled={saving}>
                        <option value="">—</option>
                        {[1, 2, 3, 4].map((rank) => <option key={rank} value={rank}>Level {rank}</option>)}
                      </select>
                    </label>
                    <label className="text-[11px] font-semibold text-(--ec-mute) sm:col-span-4">
                      Verbatim quote
                      <Textarea className="mt-0.5 min-h-16 text-xs" value={source.quote ?? ""} onChange={(event) => updateSource(index, { quote: event.target.value || null })} disabled={saving} />
                    </label>
                    {source.haystackFileId ? (
                      <p className="text-[10px] text-(--ec-mute) sm:col-span-4">Linked to corpus file {source.haystackFileId}</p>
                    ) : (
                      <p className="text-[10px] text-amber-800 sm:col-span-4">Not linked to a corpus file: preview and highlighting will be unavailable.</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <Button type="button" size="icon" variant="ghost" className="size-7" aria-label="Move source up" disabled={saving || index === 0} onClick={() => moveSource(index, -1)}><ArrowUp className="size-3.5" /></Button>
                    <Button type="button" size="icon" variant="ghost" className="size-7" aria-label="Move source down" disabled={saving || index === draft.sources.length - 1} onClick={() => moveSource(index, 1)}><ArrowDown className="size-3.5" /></Button>
                    <Button type="button" size="icon" variant="ghost" className="size-7 text-rose-700" aria-label="Remove source" disabled={saving} onClick={() => removeSource(index)}><X className="size-3.5" /></Button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
        {draft.sources.length > 0 ? (
          <Button type="button" size="sm" variant="ghost" className="mt-2 text-xs" onClick={() => update("sources", [...draft.sources, EMPTY_SOURCE])} disabled={saving}>
            <Plus className="size-3.5" aria-hidden />
            Add a source manually
          </Button>
        ) : null}
      </section>

      {existing ? (
        <div className="mt-8 border-t border-slate-200 pt-4">
          <Button type="button" variant="outline" size="sm" className="border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => setConfirmDelete(true)} disabled={saving}>
            <Trash2 className="size-3.5" aria-hidden />
            Delete page
          </Button>
          <ConfirmDialog
            open={confirmDelete}
            title="Delete this page?"
            description={`“${existing.title}” and its ${existing.sources.length} source links will be removed. Child pages must be moved first.`}
            busy={saving}
            onCancel={() => setConfirmDelete(false)}
            onConfirm={() => void handleDelete()}
          />
        </div>
      ) : null}
    </form>
  );
}
