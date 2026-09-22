"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BookMarked, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useModalLifecycle } from "@/components/ui/hooks/useModalLifecycle";
import { Input } from "@/components/ui/input";
import { apiError } from "@/lib/apiError";
import { isUuid } from "@/lib/conversations";
import type { WikiPageSummary, WikiPageView, WikiSourceInput } from "@/lib/wiki";
import type { SourceItem } from "./sourceDocuments";

type SaveToWikiDialogProps = Readonly<{
  open: boolean;
  answerText: string;
  sources: readonly SourceItem[];
  question?: string;
  messageId: string;
  projectId: string | null;
  projectName?: string;
  onClose: () => void;
}>;

function metadataValue(source: SourceItem, key: string): string | undefined {
  return source.metadata?.find((item) => item.key.toLowerCase() === key)?.value;
}

function toSourceInput(source: SourceItem): WikiSourceInput {
  const page = Number(metadataValue(source, "page_number"));
  const rank = Number(metadataValue(source, "authority_rank"));
  const locator =
    metadataValue(source, "section_title") ??
    metadataValue(source, "provision_ref") ??
    metadataValue(source, "header") ??
    (source.title !== source.fileName ? source.title : undefined);
  return {
    haystackFileId: source.fileId ?? null,
    documentId: source.id || null,
    fileName: source.fileName ?? source.title,
    locator: locator?.slice(0, 300) ?? null,
    quote: source.content?.slice(0, 4000) ?? null,
    pageNumber: Number.isInteger(page) && page > 0 ? page : null,
    authorityRank: Number.isInteger(rank) && rank >= 1 && rank <= 5 ? rank : null,
  };
}

/**
 * Turns an answer's `[n]` citations into a compact, sequential source list:
 * cited sources first in order of first appearance, uncited ones appended.
 */
export function compileAnswerForWiki(
  answerText: string,
  sources: readonly SourceItem[],
): { content: string; sources: WikiSourceInput[] } {
  const byNumber = new Map<number, SourceItem>();
  for (const source of sources) {
    for (const number of source.citationNumbers ?? []) {
      if (!byNumber.has(number)) byNumber.set(number, source);
    }
  }
  const order: number[] = [];
  for (const match of answerText.matchAll(/\[(\d{1,3})\]/g)) {
    const number = Number(match[1]);
    if (byNumber.has(number) && !order.includes(number)) order.push(number);
  }
  const renumber = new Map(order.map((number, index) => [number, index + 1]));
  const content = answerText.replace(/\[(\d{1,3})\]/g, (match, digits: string) => {
    const next = renumber.get(Number(digits));
    return next === undefined ? match : `[${next}]`;
  });
  const cited = order.map((number) => toSourceInput(byNumber.get(number)!));
  const citedKeys = new Set(order.map((number) => byNumber.get(number)!.key));
  const uncited = sources.filter((source) => !citedKeys.has(source.key)).map(toSourceInput);
  return { content, sources: [...cited, ...uncited].slice(0, 50) };
}

function suggestTitle(question: string | undefined, answer: string): string {
  const heading = answer.match(/^#+\s+(.+)$/m)?.[1]?.trim();
  const base = heading || question?.trim() || answer.split(/[.\n]/)[0]?.trim() || "New page";
  return base.replace(/\s+/g, " ").slice(0, 120);
}

export function SaveToWikiDialog({
  open,
  answerText,
  sources,
  question,
  messageId,
  projectId,
  projectName,
  onClose,
}: SaveToWikiDialogProps) {
  const router = useRouter();
  const [scope, setScope] = useState<string>(projectId ?? "");
  const [title, setTitle] = useState(() => suggestTitle(question, answerText));
  const [parentId, setParentId] = useState("");
  const [pages, setPages] = useState<readonly WikiPageSummary[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const compiled = useMemo(() => compileAnswerForWiki(answerText, sources), [answerText, sources]);

  useModalLifecycle({ open, onEscape: onClose, lockBodyScroll: true });

  useEffect(() => {
    if (!open) return;
    let active = true;
    const params = scope ? `?projectId=${encodeURIComponent(scope)}` : "";
    void fetch(`/api/wiki/pages${params}`, { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<{ pages: WikiPageSummary[] }>) : { pages: [] }))
      .then((payload) => {
        if (active) setPages(payload.pages);
      });
    return () => {
      active = false;
    };
  }, [open, scope]);

  if (!open) return null;

  async function save(): Promise<void> {
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const response = await fetch("/api/wiki/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: scope || null,
          parentId: parentId || null,
          title,
          summary: question ? `Compiled from the question: ${question.slice(0, 500)}` : null,
          content: compiled.content,
          status: "draft",
          sources: compiled.sources,
          sourceMessageId: isUuid(messageId) ? messageId : null,
        }),
      });
      if (!response.ok) throw await apiError(response, "The page could not be created.");
      const payload = (await response.json()) as { page: WikiPageView };
      onClose();
      router.push(`/wiki?${scope ? `project=${scope}&` : ""}page=${payload.page.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The page could not be created.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-70 flex animate-fade-in items-center justify-center bg-slate-950/45 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="save-wiki-title" className="w-full max-w-lg animate-scale-in rounded-lg bg-white p-6 shadow-2xl">
        <div className="flex items-center gap-2">
          <BookMarked className="size-5 text-(--ec-blue)" aria-hidden />
          <h2 id="save-wiki-title" className="text-lg font-bold text-slate-950">Save this answer to the knowledge base</h2>
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          The answer becomes a draft page with its {compiled.sources.length} cited{" "}
          {compiled.sources.length === 1 ? "source" : "sources"} attached. Review and publish it from
          the Wiki tab; only published pages are read by ALINA.
        </p>
        <div className="mt-4 space-y-3">
          <label className="block text-xs font-semibold text-(--ec-mute)">
            Title
            <Input className="mt-1" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} disabled={saving} />
          </label>
          <label className="block text-xs font-semibold text-(--ec-mute)">
            Knowledge base
            <select className="mt-1 h-10 w-full rounded-md border border-(--ec-line) bg-white px-2 text-sm text-(--ec-ink)" value={scope} onChange={(event) => { setScope(event.target.value); setParentId(""); }} disabled={saving}>
              <option value="">Global knowledge base</option>
              {projectId ? <option value={projectId}>{projectName ?? "This project"}</option> : null}
            </select>
          </label>
          <label className="block text-xs font-semibold text-(--ec-mute)">
            Place under
            <select className="mt-1 h-10 w-full rounded-md border border-(--ec-line) bg-white px-2 text-sm text-(--ec-ink)" value={parentId} onChange={(event) => setParentId(event.target.value)} disabled={saving}>
              <option value="">Top level</option>
              {pages.map((page) => <option key={page.id} value={page.id}>{page.title}</option>)}
            </select>
          </label>
        </div>
        {error ? <p className="mt-3 border-l-4 border-rose-600 bg-rose-50 px-4 py-2 text-sm text-rose-800" role="alert">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void save()} disabled={saving || !title.trim()}>
            {saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
            Create draft page
          </Button>
        </div>
      </section>
    </div>
  );
}
