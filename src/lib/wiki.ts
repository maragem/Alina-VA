import type { SourceItem } from "@/components/global/sourceDocuments";
import { isUuid } from "@/lib/conversations";

export const WIKI_STATUSES = ["draft", "published", "needs_review"] as const;
export type WikiStatus = (typeof WIKI_STATUSES)[number];

export const WIKI_STATUS_LABELS: Record<WikiStatus, string> = {
  draft: "Draft",
  published: "Published",
  needs_review: "Needs review",
};

export const WIKI_TITLE_MAX_LENGTH = 160;
export const WIKI_SUMMARY_MAX_LENGTH = 600;
export const WIKI_CONTENT_MAX_LENGTH = 60_000;
export const WIKI_MAX_SOURCES = 50;
export const WIKI_SOURCE_QUOTE_MAX_LENGTH = 4_000;
export const WIKI_SEARCH_QUERY_MAX_LENGTH = 200;

/** One consolidated source of a page; `[n]` in the content points at position n. */
export type WikiSourceInput = Readonly<{
  haystackFileId: string | null;
  documentId: string | null;
  fileName: string;
  locator: string | null;
  quote: string | null;
  pageNumber: number | null;
  authorityRank: number | null;
}>;

export type WikiSourceView = WikiSourceInput & Readonly<{ id: string; position: number }>;

export type WikiPageSummary = Readonly<{
  id: string;
  projectId: string | null;
  parentId: string | null;
  slug: string;
  title: string;
  summary: string | null;
  status: WikiStatus;
  authorityRank: number | null;
  sortOrder: number;
  sourceCount: number;
  updatedAt: string;
}>;

export type WikiBreadcrumb = Readonly<{ id: string; slug: string; title: string }>;

export type WikiPageView = WikiPageSummary &
  Readonly<{
    content: string;
    createdAt: string;
    lastReviewedAt: string | null;
    createdBy: string;
    updatedBy: string;
    sourceMessageId: string | null;
    sources: readonly WikiSourceView[];
    breadcrumb: readonly WikiBreadcrumb[];
    canEdit: boolean;
  }>;

export type WikiSearchHit = WikiPageSummary & Readonly<{ snippet: string; rank: number }>;

/** Short description of an authority level for badges and pickers. */
export const AUTHORITY_LEVEL_DESCRIPTIONS: Record<number, string> = {
  1: "Treaties and Charter",
  2: "EU legislation and case law",
  3: "Guidance and contractual documents",
  4: "Internal guidance and Q&A",
  5: "Other material",
};

export function authorityLevelLabel(rank: number): string {
  const description = AUTHORITY_LEVEL_DESCRIPTIONS[rank];
  return description ? `Level ${rank} · ${description}` : `Level ${rank}`;
}

export function isWikiStatus(value: unknown): value is WikiStatus {
  return typeof value === "string" && (WIKI_STATUSES as readonly string[]).includes(value);
}

export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || "page";
}

export function normalizeWikiTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.trim().replace(/\s+/g, " ");
  return title && title.length <= WIKI_TITLE_MAX_LENGTH ? title : null;
}

export function normalizeWikiSummary(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const summary = value.trim().replace(/\s+/g, " ");
  if (!summary) return null;
  return summary.length <= WIKI_SUMMARY_MAX_LENGTH ? summary : undefined;
}

export function normalizeWikiContent(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const content = value.replace(/\r\n/g, "\n").trimEnd();
  return content.length <= WIKI_CONTENT_MAX_LENGTH ? content : null;
}

export function normalizeAuthorityRankInput(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const rank = typeof value === "number" ? value : Number(value);
  return Number.isInteger(rank) && rank >= 1 && rank <= 5 ? rank : undefined;
}

function optionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length <= maxLength ? text || null : undefined;
}

/** Returns null when the payload is malformed; otherwise a clean list (may be empty). */
export function normalizeWikiSources(value: unknown): WikiSourceInput[] | null {
  if (!Array.isArray(value) || value.length > WIKI_MAX_SOURCES) return null;
  const sources: WikiSourceInput[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") return null;
    const record = candidate as Record<string, unknown>;
    const fileName = optionalText(record.fileName, 300);
    if (!fileName) return null;
    const fileId = record.haystackFileId;
    if (fileId !== undefined && fileId !== null && fileId !== "" && !isUuid(fileId)) return null;
    const locator = optionalText(record.locator, 300);
    const quote = optionalText(record.quote, WIKI_SOURCE_QUOTE_MAX_LENGTH);
    const documentId = optionalText(record.documentId, 200);
    if (locator === undefined || quote === undefined || documentId === undefined) return null;
    const pageNumberRaw = record.pageNumber;
    const pageNumber =
      pageNumberRaw === undefined || pageNumberRaw === null || pageNumberRaw === ""
        ? null
        : Number(pageNumberRaw);
    if (pageNumber !== null && (!Number.isInteger(pageNumber) || pageNumber < 1)) return null;
    const authorityRank = normalizeAuthorityRankInput(record.authorityRank);
    if (authorityRank === undefined) return null;
    sources.push({
      haystackFileId: isUuid(fileId) ? fileId : null,
      documentId,
      fileName,
      locator,
      quote,
      pageNumber,
      authorityRank,
    });
  }
  return sources;
}

/** Adapts wiki sources to the chat's SourceItem shape so the supporting-documents panel is reused. */
export function wikiSourcesToSourceItems(sources: readonly WikiSourceView[]): SourceItem[] {
  return sources.map((source) => {
    const metadata = [
      source.locator ? { key: "locator", value: source.locator } : null,
      source.pageNumber ? { key: "page_number", value: String(source.pageNumber) } : null,
      source.authorityRank ? { key: "authority_rank", value: String(source.authorityRank) } : null,
    ].filter((item): item is { key: string; value: string } => item !== null);
    const content = source.quote ?? undefined;
    return {
      key: `wiki-source:${source.id}`,
      id: source.documentId ?? source.id,
      citationNumbers: [source.position],
      fileId: source.haystackFileId ?? undefined,
      fileName: source.fileName,
      title: source.locator ?? source.fileName,
      locationLabel: source.locator ?? undefined,
      content,
      snippet:
        content === undefined
          ? undefined
          : content.length <= 280
            ? content
            : `${content.slice(0, 280)}...`,
      metadata: metadata.length ? metadata : undefined,
      contentLength: content?.length,
    };
  });
}

/** Rewrites `[n]` markers so they stay valid after sources are reordered or removed. */
export function citationNumbersInContent(content: string): Set<number> {
  const numbers = new Set<number>();
  for (const match of content.matchAll(/\[(\d{1,3})\]/g)) numbers.add(Number(match[1]));
  return numbers;
}
