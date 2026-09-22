"use client";

import { useMemo, useState } from "react";
import { Bot, ChevronDown, ChevronRight, FileText, Pencil, ShieldCheck } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { citationNumberFromHref, createCitationPlugin } from "@/components/global/citationMarkdown";
import { SourceDocumentList, type SelectedCitation } from "@/components/global/SourceDocumentList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  authorityLevelLabel,
  WIKI_STATUS_LABELS,
  wikiSourcesToSourceItems,
  type WikiPageView,
} from "@/lib/wiki";

type WikiArticleProps = Readonly<{
  page: WikiPageView;
  knowledgeBaseName: string;
  onEdit: () => void;
  onNavigate: (pageId: string) => void;
}>;

const STATUS_VARIANT = {
  published: "success",
  draft: "secondary",
  needs_review: "warning",
} as const;

function formatDate(value: string | null): string {
  if (!value) return "never";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(value),
  );
}

export function WikiArticle({ page, knowledgeBaseName, onEdit, onNavigate }: WikiArticleProps) {
  const [selectedCitation, setSelectedCitation] = useState<SelectedCitation>();
  const [showAgentView, setShowAgentView] = useState(false);
  const sourceItems = useMemo(() => wikiSourcesToSourceItems(page.sources), [page.sources]);
  const validCitations = useMemo(
    () => new Set(page.sources.map((source) => source.position)),
    [page.sources],
  );
  const sourceByPosition = useMemo(
    () => new Map(page.sources.map((source) => [source.position, source])),
    [page.sources],
  );

  return (
    <article className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-8 sm:py-8">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-xs text-(--ec-mute)">
        <span className="font-semibold uppercase tracking-wide">{knowledgeBaseName}</span>
        {page.breadcrumb.map((crumb, index) => (
          <span key={crumb.id} className="flex items-center gap-1">
            <ChevronRight className="size-3" aria-hidden />
            {index === page.breadcrumb.length - 1 ? (
              <span className="text-(--ec-ink)">{crumb.title}</span>
            ) : (
              <button
                type="button"
                className="hover:text-(--ec-blue) hover:underline"
                onClick={() => onNavigate(crumb.id)}
              >
                {crumb.title}
              </button>
            )}
          </span>
        ))}
      </nav>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-serif text-3xl font-bold leading-tight text-(--ec-blue)">{page.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_VARIANT[page.status]}>{WIKI_STATUS_LABELS[page.status]}</Badge>
            {page.authorityRank ? (
              <Badge variant="info" title="Legal standing of the governing source">
                <ShieldCheck className="mr-1 size-3" aria-hidden />
                {authorityLevelLabel(page.authorityRank)}
              </Badge>
            ) : null}
            <Badge variant="outline">
              <FileText className="mr-1 size-3" aria-hidden />
              {page.sources.length} {page.sources.length === 1 ? "source" : "sources"}
            </Badge>
          </div>
        </div>
        {page.canEdit ? (
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="size-3.5" aria-hidden />
            Edit page
          </Button>
        ) : null}
      </header>

      {page.summary ? (
        <p className="mt-4 border-l-4 border-(--ec-yellow) bg-amber-50/60 px-4 py-3 text-[15px] leading-7 text-(--ec-ink)">
          {page.summary}
        </p>
      ) : null}

      {page.content.trim() ? (
        <div className="prose prose-slate mt-6 max-w-none text-base leading-relaxed prose-headings:font-sans prose-headings:text-(--ec-blue) prose-h2:text-xl prose-h3:text-lg prose-p:text-[15px] prose-p:leading-7 prose-a:text-(--ec-blue) prose-table:block prose-table:max-w-full prose-table:overflow-x-auto">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, createCitationPlugin(validCitations)]}
            components={{
              a: ({ children, href, ...props }) => {
                const citationNumber = citationNumberFromHref(href);
                const source = citationNumber ? sourceByPosition.get(citationNumber) : undefined;
                if (citationNumber && source) {
                  const label = source.locator ?? source.fileName;
                  return (
                    <button
                      type="button"
                      className="not-prose mx-0.5 inline-flex max-w-full items-center gap-1 rounded-sm border border-blue-300 bg-blue-100 px-1.5 py-0.5 align-baseline text-[11px] font-semibold leading-4 text-(--ec-blue) shadow-xs hover:border-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ec-yellow)"
                      title={`${label} — source ${citationNumber}`}
                      aria-label={`Open source ${citationNumber}, ${label}`}
                      onClick={() => setSelectedCitation({ number: citationNumber })}
                    >
                      <FileText className="size-3 shrink-0" aria-hidden />
                      <span className="max-w-48 truncate">{label}</span>
                      <span className="shrink-0 text-slate-500">[{citationNumber}]</span>
                    </button>
                  );
                }
                return (
                  <a {...props} href={href} target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                );
              },
            }}
          >
            {page.content}
          </ReactMarkdown>
        </div>
      ) : (
        <p className="mt-6 text-sm text-(--ec-mute)">This page has no content yet.</p>
      )}

      {sourceItems.length ? (
        <SourceDocumentList
          sources={sourceItems}
          selectedCitation={selectedCitation}
          onSelectedCitationChange={setSelectedCitation}
        />
      ) : null}

      <footer className="mt-8 border-t border-slate-200 pt-4 text-xs text-(--ec-mute)">
        <p>
          Last updated {formatDate(page.updatedAt)} by {page.updatedBy} · created by {page.createdBy}
          {" · "}last reviewed {formatDate(page.lastReviewedAt)}
          {page.sourceMessageId ? " · compiled from an ALINA answer" : ""}
        </p>
        <button
          type="button"
          className="mt-3 inline-flex items-center gap-1 font-semibold text-(--ec-blue) hover:underline"
          onClick={() => setShowAgentView((current) => !current)}
          aria-expanded={showAgentView}
        >
          <Bot className="size-3.5" aria-hidden />
          How ALINA reads this page
          <ChevronDown className={`size-3.5 transition-transform ${showAgentView ? "rotate-180" : ""}`} aria-hidden />
        </button>
        {showAgentView ? (
          <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-[11px] leading-5 text-(--ec-ink)">
            <p>
              The retrieval agent consults this knowledge base through the Model Context Protocol
              endpoint <code className="rounded bg-white px-1">/api/mcp</code> before searching raw
              document chunks. A published page is returned as plain text with its numbered sources,
              so the agent cites the underlying instrument rather than the page.
            </p>
            <pre className="mt-2 overflow-x-auto rounded bg-white p-2 font-mono text-[11px] leading-4">
{JSON.stringify(
  {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "wiki_get_page",
      arguments: page.projectId
        ? { page_id: page.id, project_id: page.projectId }
        : { page_id: page.id },
    },
  },
  null,
  2,
)}
            </pre>
            {page.status !== "published" ? (
              <p className="mt-2 text-amber-800">
                This page is {WIKI_STATUS_LABELS[page.status].toLowerCase()}, so the agent cannot read it yet.
              </p>
            ) : null}
          </div>
        ) : null}
      </footer>
    </article>
  );
}
