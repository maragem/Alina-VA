"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WikiPageSummary, WikiSearchHit, WikiStatus } from "@/lib/wiki";

type WikiTreeProps = Readonly<{
  pages: readonly WikiPageSummary[];
  selectedPageId?: string;
  canEdit: boolean;
  searchQuery: string;
  searchHits: readonly WikiSearchHit[];
  searching: boolean;
  onSearchChange: (query: string) => void;
  onSelect: (pageId: string) => void;
  onCreate: (parentId: string | null) => void;
}>;

const STATUS_DOT: Record<WikiStatus, string> = {
  published: "bg-emerald-500",
  draft: "bg-slate-300",
  needs_review: "bg-amber-500",
};

function buildChildren(pages: readonly WikiPageSummary[]): Map<string | null, WikiPageSummary[]> {
  const ids = new Set(pages.map((page) => page.id));
  const byParent = new Map<string | null, WikiPageSummary[]>();
  for (const page of pages) {
    // A hidden parent (e.g. a draft the reader cannot see) promotes the child to a root.
    const parent = page.parentId && ids.has(page.parentId) ? page.parentId : null;
    const siblings = byParent.get(parent) ?? [];
    siblings.push(page);
    byParent.set(parent, siblings);
  }
  return byParent;
}

function ancestorsOf(pages: readonly WikiPageSummary[], pageId: string | undefined): Set<string> {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const ancestors = new Set<string>();
  let current = pageId ? byId.get(pageId)?.parentId ?? null : null;
  while (current && !ancestors.has(current)) {
    ancestors.add(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return ancestors;
}

export function WikiTree({
  pages,
  selectedPageId,
  canEdit,
  searchQuery,
  searchHits,
  searching,
  onSearchChange,
  onSelect,
  onCreate,
}: WikiTreeProps) {
  const byParent = useMemo(() => buildChildren(pages), [pages]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const forcedOpen = useMemo(() => ancestorsOf(pages, selectedPageId), [pages, selectedPageId]);

  function toggle(pageId: string): void {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  }

  function renderNode(page: WikiPageSummary, depth: number) {
    const children = byParent.get(page.id) ?? [];
    const isOpen = forcedOpen.has(page.id) ? true : !collapsed.has(page.id);
    const selected = page.id === selectedPageId;
    return (
      <li key={page.id}>
        <div
          className={`group flex items-center gap-1 rounded-sm pr-1 ${
            selected ? "bg-blue-50 text-(--ec-blue)" : "hover:bg-slate-100"
          }`}
          style={{ paddingLeft: `${depth * 0.75}rem` }}
        >
          {children.length > 0 ? (
            <button
              type="button"
              onClick={() => toggle(page.id)}
              aria-label={isOpen ? `Collapse ${page.title}` : `Expand ${page.title}`}
              className="flex size-6 shrink-0 items-center justify-center text-slate-500 hover:text-(--ec-ink)"
            >
              {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </button>
          ) : (
            <span className="size-6 shrink-0" aria-hidden />
          )}
          <button
            type="button"
            onClick={() => onSelect(page.id)}
            aria-current={selected ? "page" : undefined}
            className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-sm"
            title={page.summary ?? page.title}
          >
            <span
              className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[page.status]}`}
              aria-hidden
              title={page.status.replace("_", " ")}
            />
            <span className={`truncate ${selected ? "font-semibold" : "text-(--ec-ink)"}`}>
              {page.title}
            </span>
          </button>
          {canEdit ? (
            <button
              type="button"
              onClick={() => onCreate(page.id)}
              aria-label={`Add a page under ${page.title}`}
              title="Add child page"
              className="flex size-6 shrink-0 items-center justify-center rounded-sm text-slate-400 opacity-0 hover:bg-slate-200 hover:text-(--ec-ink) group-hover:opacity-100 focus:opacity-100"
            >
              <Plus className="size-3.5" />
            </button>
          ) : null}
        </div>
        {children.length > 0 && isOpen ? (
          <ul>{children.map((child) => renderNode(child, depth + 1))}</ul>
        ) : null}
      </li>
    );
  }

  const roots = byParent.get(null) ?? [];
  const showingSearch = searchQuery.trim().length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-slate-200 px-2 py-2">
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-2 size-3.5 text-(--ec-mute)" aria-hidden />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search the knowledge base…"
            aria-label="Search the knowledge base"
            className="conversation-search h-8 w-full appearance-none rounded-md border border-slate-200 bg-white py-1 pl-7 pr-7 text-xs text-(--ec-ink) placeholder:text-(--ec-mute) focus:outline-none focus:ring-2 focus:ring-(--ec-yellow)"
          />
          {searchQuery ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onSearchChange("")}
              className="absolute right-2 text-(--ec-mute) hover:text-(--ec-ink)"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {showingSearch ? (
          searching && searchHits.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-(--ec-mute)">Searching…</p>
          ) : searchHits.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs leading-5 text-(--ec-mute)">
              No page matches. ALINA would fall back to corpus search here.
            </p>
          ) : (
            <ul className="space-y-1">
              {searchHits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(hit.id)}
                    className={`block w-full rounded-sm px-2 py-2 text-left hover:bg-slate-100 ${
                      hit.id === selectedPageId ? "bg-blue-50" : ""
                    }`}
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold text-(--ec-ink)">
                      <FileText className="size-3.5 shrink-0 text-(--ec-blue)" aria-hidden />
                      <span className="truncate">{hit.title}</span>
                    </span>
                    <span
                      className="mt-1 block text-[11px] leading-4 text-(--ec-mute) [&_b]:font-semibold [&_b]:text-(--ec-ink)"
                      dangerouslySetInnerHTML={{ __html: sanitizeHeadline(hit.snippet) }}
                    />
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : roots.length === 0 ? (
          <div className="px-2 py-8 text-center text-xs leading-5 text-(--ec-mute)">
            <p>This knowledge base is empty.</p>
            {canEdit ? (
              <Button size="sm" variant="outline" className="mt-3" onClick={() => onCreate(null)}>
                <Plus className="size-3.5" aria-hidden />
                First page
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="space-y-0.5">{roots.map((page) => renderNode(page, 0))}</ul>
        )}
      </div>

      {canEdit && !showingSearch && roots.length > 0 ? (
        <div className="border-t border-slate-200 p-2">
          <Button size="sm" variant="ghost" className="w-full justify-start text-xs" onClick={() => onCreate(null)}>
            <Plus className="size-3.5" aria-hidden />
            New top-level page
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** ts_headline output only ever contains <b> tags; strip anything else defensively. */
function sanitizeHeadline(html: string): string {
  return html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/&lt;(\/?)b&gt;/g, "<$1b>");
}
