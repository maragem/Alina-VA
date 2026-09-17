"use client";

import {
  CSSProperties,
  JSX,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronDown,
  ExternalLink,
  Eye,
  FileText,
  LoaderCircle,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  FilePreviewDialog,
  type PreviewFile,
  type PreviewHighlight,
} from "@/components/documents/FilePreviewDialog";
import { Button } from "@/components/ui/button";
import {
  citationQuotes,
  isWholeChunkQuote,
  splitQuoteIntoSegments,
} from "@/lib/citationSpans";
import {
  clearCitationHighlights,
  highlightCitationQuotes,
  scrollRangeIntoView,
} from "@/lib/domTextHighlight";
import {
  AUTHORITY_CATEGORIES,
  isAuthorityRank,
  type AuthorityRank,
} from "@/lib/documentMetadata";
import type { SourceItem } from "./sourceDocuments";

export type { SourceItem } from "./sourceDocuments";

export type SelectedCitation = Readonly<{
  number: number;
  quote?: string;
}>;

type SourceDocumentListProps = {
  sources: readonly SourceItem[];
  selectedCitation?: SelectedCitation;
  onSelectedCitationChange?: (citation: SelectedCitation | undefined) => void;
};

const DEFAULT_VISIBLE_FILES = 5;
const NO_QUOTES: readonly string[] = [];

function pageHintOf(source: SourceItem): number | undefined {
  const value = source.metadata?.find(
    (item) => item.key.toLowerCase() === "page_number",
  )?.value;
  const page = Number(value);
  return Number.isFinite(page) && page > 0 ? page : undefined;
}

function authorityRankOf(source: SourceItem): AuthorityRank | null {
  const value = source.metadata?.find(
    (item) => item.key.toLowerCase() === "authority_rank",
  )?.value;
  const rank = Number(value);
  return isAuthorityRank(rank) ? rank : null;
}

function authorityRankTitle(rank: AuthorityRank): string {
  const categories = AUTHORITY_CATEGORIES.filter(
    (category) => category.rank === rank,
  ).map((category) => category.label);
  return `Level ${rank}: ${categories.join(", ")}`;
}

type SectionSortMode = "document" | "score";

function sortSourcesByScore(sources: readonly SourceItem[]): SourceItem[] {
  return [...sources].sort(
    (left, right) =>
      (hasDefinedScore(right.score) ? right.score : -1) -
      (hasDefinedScore(left.score) ? left.score : -1),
  );
}

function previewHighlight(
  source: SourceItem,
  quotes: readonly string[],
): PreviewHighlight | undefined {
  const fallback = source.content?.trim();
  const resolved = quotes.length ? quotes : fallback ? [fallback] : NO_QUOTES;
  const segments = resolved.flatMap(splitQuoteIntoSegments);

  return segments.length
    ? { quotes: segments, pageHint: pageHintOf(source) }
    : undefined;
}

type SourceFileGroup = Readonly<{
  key: string;
  name: string;
  sources: SourceItem[];
}>;

function normalizeFileName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
}

function groupSourcesByFile(sources: readonly SourceItem[]): SourceFileGroup[] {
  const groups = new Map<string, SourceFileGroup>();

  for (const source of sources) {
    const sourceName = source.fileName?.trim() || source.title.trim();
    const name = sourceName || "Source file";
    const key = source.fileId
      ? `file:${source.fileId}`
      : sourceName
        ? `name:${normalizeFileName(sourceName)}`
        : `source:${source.key}`;
    const existing = groups.get(key);

    if (existing) {
      existing.sources.push(source);
    } else {
      groups.set(key, { key, name, sources: [source] });
    }
  }

  return [...groups.values()];
}

function formatIdentifier(id: string): string {
  return id.length > 24 ? `${id.slice(0, 8)}...${id.slice(-8)}` : id;
}

function formatScore(score: number): string {
  return (
    new Intl.NumberFormat("en-GB", {
      maximumFractionDigits: 1,
    }).format(score * 100) + "%"
  );
}

function clampScore(score: number): number {
  if (score < 0) return 0;
  if (score > 1) return 1;
  return score;
}

function hasDefinedScore(score: number | undefined): score is number {
  return typeof score === "number" && Number.isFinite(score);
}

function interpolateColor(
  start: number,
  end: number,
  intensity: number,
): number {
  return Math.round(start + (end - start) * intensity);
}

function getScoreBadgeStyle(score: number): CSSProperties {
  const intensity = clampScore(score);
  const startBlue = 120;
  const endBlue = 226;
  const startGreen = 129;
  const endGreen = 97;
  const startRed = 100;
  const endRed = 37;
  const blue = interpolateColor(startBlue, endBlue, intensity);
  const green = interpolateColor(startGreen, endGreen, intensity);
  const red = interpolateColor(startRed, endRed, intensity);

  return {
    color: `rgb(${red}, ${green}, ${blue})`,
  };
}

function ScoreBadge({ score }: { score: number | undefined }) {
  if (!hasDefinedScore(score)) {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-(--ec-ink)">
        Match score unavailable
      </span>
    );
  }

  const normalizedScore = clampScore(score);

  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold"
      aria-label={`Match score ${formatScore(normalizedScore)}`}
    >
      <span style={getScoreBadgeStyle(normalizedScore)}>
        {formatScore(normalizedScore)} match
      </span>
    </span>
  );
}

function formatContentLength(contentLength: number): string {
  return `${contentLength.toLocaleString()} chars`;
}

function formatMetadataKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isSpreadsheetSource(source: SourceItem): boolean {
  return /\.(csv|xlsx?)$/i.test(source.fileName ?? source.title);
}

function toPlainText(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/(\*\*|__|~~|\*|_)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type SnippetBlock =
  | Readonly<{ kind: "text"; content: string }>
  | Readonly<{ kind: "table"; headers: string[]; rows: string[][] }>;

function isTableSeparator(line: string): boolean {
  return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(line);
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => toPlainText(cell.trim()));
}

function getSnippetBlocks(markdown: string): SnippetBlock[] {
  const lines = markdown.split("\n");
  const blocks: SnippetBlock[] = [];
  let textLines: string[] = [];

  function pushText(): void {
    const content = toPlainText(textLines.join("\n"));
    if (content) blocks.push({ kind: "text", content });
    textLines = [];
  }

  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index];
    const separator = lines[index + 1];
    if (!header.includes("|") || !separator || !isTableSeparator(separator)) {
      textLines.push(header);
      continue;
    }

    pushText();
    const headers = parseTableRow(header);
    const rows: string[][] = [];
    index += 2;
    while (index < lines.length && lines[index].includes("|")) {
      rows.push(parseTableRow(lines[index]));
      index += 1;
    }
    index -= 1;
    blocks.push({ kind: "table", headers, rows });
  }

  pushText();
  return blocks;
}

function parseCsv(content: string): string[][] | undefined {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const nextCharacter = content[index + 1];

    if (character === '"') {
      if (quoted && nextCharacter === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (!quoted && character === ",") {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && nextCharacter === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += character;
  }

  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const columnCount = Math.max(0, ...rows.map((parsedRow) => parsedRow.length));
  return rows.length >= 2 && columnCount >= 2 ? rows : undefined;
}

function SpreadsheetSnippet({ rows }: { rows: string[][] }) {
  const columnCount = Math.max(0, ...rows.map((row) => row.length));
  const [header, ...body] = rows;

  return (
    <div className="mt-1 overflow-x-auto border border-slate-200 bg-white">
      <table className="w-full min-w-max border-collapse text-left text-[11px] leading-4">
        <thead className="bg-slate-100 text-slate-700">
          <tr>
            {Array.from({ length: columnCount }, (_, columnIndex) => (
              <th
                key={columnIndex}
                className="border-b border-r border-slate-200 px-2 py-1.5 font-semibold last:border-r-0"
              >
                {header[columnIndex] || " "}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-slate-100 last:border-b-0">
              {Array.from({ length: columnCount }, (_, columnIndex) => (
                <td
                  key={columnIndex}
                  className="max-w-56 border-r border-slate-100 px-2 py-1.5 align-top wrap-break-word last:border-r-0"
                >
                  {row[columnIndex] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SourceSnippet({ source }: { source: SourceItem }) {
  const content = source.snippet;
  if (!content) return null;

  const spreadsheetRows = isSpreadsheetSource(source)
    ? parseCsv(content)
    : undefined;
  if (spreadsheetRows) return <SpreadsheetSnippet rows={spreadsheetRows} />;

  return (
    <div className="mt-1.5 space-y-2 text-xs leading-5 text-(--ec-mute)">
      {getSnippetBlocks(content).map((block, index) =>
        block.kind === "text" ? (
          <p key={`${block.content}-${index}`} className="whitespace-pre-wrap">
            {block.content}
          </p>
        ) : (
          <div
            key={`${block.headers.join("|")}-${index}`}
            className="overflow-x-auto border border-slate-200 bg-white"
          >
            <table className="w-full min-w-max border-collapse text-left text-[11px] leading-4">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  {block.headers.map((header, headerIndex) => (
                    <th
                      key={`${header}-${headerIndex}`}
                      className="border-b border-slate-200 px-2 py-1.5 font-semibold"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr
                    key={`${row.join("|")}-${rowIndex}`}
                    className="border-b border-slate-100 last:border-b-0"
                  >
                    {block.headers.map((_, cellIndex) => (
                      <td key={cellIndex} className="px-2 py-1.5 align-top">
                        {row[cellIndex] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
      )}
    </div>
  );
}

function SourceMetadata({ source }: { source: SourceItem }) {
  const details = [
    ["Document ID", source.id],
    ["File ID", source.fileId],
    ["File name", source.fileName],
    ["Type", source.sourceType],
    ["Origin", source.locationLabel],
    [
      "Content",
      source.contentLength
        ? formatContentLength(source.contentLength)
        : undefined,
    ],
    [
      "Match score",
      hasDefinedScore(source.score)
        ? formatScore(clampScore(source.score))
        : undefined,
    ],
  ].filter((item): item is [string, string] => Boolean(item[1]));

  if (
    details.length === 0 &&
    source.tags?.length === 0 &&
    source.metadata?.length === 0
  ) {
    return null;
  }

  return (
    <section
      className="mt-8 border-t border-slate-200 pt-5"
      aria-labelledby="source-metadata-title"
    >
      <h3
        id="source-metadata-title"
        className="text-sm font-semibold text-(--ec-ink)"
      >
        Source metadata
      </h3>
      {source.tags?.length ? (
        <div className="mt-3">
          <p className="text-xs font-semibold text-(--ec-mute)">Tags</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {source.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-(--ec-ink)"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {details.length > 0 ? (
        <dl className="mt-4 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          {details.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="font-semibold text-(--ec-mute)">{label}</dt>
              <dd className="min-w-0 wrap-break-word text-(--ec-ink)">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {source.metadata?.length ? (
        <details className="group mt-4 text-sm">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 font-semibold text-(--ec-ink) hover:text-(--ec-blue)">
            <ChevronDown
              className="size-4 transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
            Additional metadata ({source.metadata.length})
          </summary>
          <dl className="mt-3 grid gap-x-4 gap-y-2 border-l-2 border-slate-200 pl-3 text-sm sm:grid-cols-[max-content_1fr]">
            {source.metadata.map((item) => (
              <div key={item.key} className="contents">
                <dt className="font-semibold text-(--ec-mute)">
                  {formatMetadataKey(item.key)}
                </dt>
                <dd className="min-w-0 wrap-break-word text-(--ec-ink)">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </section>
  );
}

function SourcePreviewSidebar({
  source,
  citationNumber,
  selectedQuote,
  resolvingFile,
  onClose,
  onPreviewFile,
}: {
  source: SourceItem | null;
  citationNumber?: number;
  selectedQuote?: string;
  resolvingFile: boolean;
  onClose: () => void;
  onPreviewFile: (source: SourceItem, quotes: readonly string[]) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const quotes = useMemo(
    () =>
      source && citationNumber
        ? citationQuotes(source, citationNumber)
        : NO_QUOTES,
    [citationNumber, source],
  );
  const inChunkQuotes = useMemo(
    () =>
      selectedQuote
        ? [selectedQuote]
        : quotes.filter((quote) => !isWholeChunkQuote(source?.content, quote)),
    [quotes, selectedQuote, source],
  );

  useEffect(() => {
    if (!source) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, source]);

  useEffect(() => {
    const container = contentRef.current;
    if (!container || !inChunkQuotes.length) return;

    const [range] = highlightCitationQuotes(container, inChunkQuotes);
    if (range) scrollRangeIntoView(range);

    return () => clearCitationHighlights(container);
  }, [inChunkQuotes, source]);

  if (!source) return null;

  const content = source.content ?? source.snippet;
  const spreadsheetSource = isSpreadsheetSource(source);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/35"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="ml-auto flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-preview-title"
      >
        <header className="flex min-h-16 items-center gap-3 border-b border-(--ec-line) px-4 sm:px-5">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-(--ec-mute)">
              Source document
            </p>
            <h2
              id="source-preview-title"
              className="truncate text-base font-semibold text-slate-950"
            >
              {source.title}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close source preview"
            autoFocus
          >
            <X className="size-5" aria-hidden="true" />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">
          {spreadsheetSource ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-(--ec-mute)">
              {resolvingFile
                ? "Finding the original spreadsheet…"
                : "The original spreadsheet is unavailable for preview."}
            </div>
          ) : (
            <>
              {content ? (
                <div
                  ref={contentRef}
                  className="prose prose-sm max-w-none text-slate-800 prose-headings:text-slate-950 prose-p:leading-6 prose-a:text-(--ec-blue) prose-a:underline prose-strong:text-slate-950 prose-li:my-1"
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {content}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm text-(--ec-mute)">
                  No text was returned for this source.
                </p>
              )}
              <SourceMetadata source={source} />
            </>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-(--ec-line) bg-slate-50 px-4 py-3 sm:px-5">
          <p className="text-xs text-(--ec-mute)">
            {source.contentLength
              ? formatContentLength(source.contentLength)
              : "Retrieved source text"}
          </p>
          <div className="flex items-center gap-2">
            {source.url && (
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center gap-1 px-2 text-xs font-semibold text-(--ec-blue) underline underline-offset-2"
                aria-label={`Open ${source.title} in a new tab`}
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                Open source
              </a>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void onPreviewFile(source, quotes)}
              disabled={resolvingFile}
            >
              {resolvingFile ? (
                <LoaderCircle
                  className="size-4 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Eye className="size-4" aria-hidden="true" />
              )}
              Preview full file
            </Button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

/** Looks up the Haystack file UUID by name, disambiguating duplicate-named uploads via meta size/created date. */
async function resolveFileId(source: SourceItem): Promise<string | undefined> {
  const params = new URLSearchParams({ name: source.fileName ?? source.title });
  if (source.fileCreatedAt) params.set("createdAt", source.fileCreatedAt);
  if (source.fileSize !== undefined) params.set("size", String(source.fileSize));

  const response = await fetch(`/api/haystack/files/resolve?${params}`);
  const payload = (await response.json().catch(() => null)) as {
    fileId?: unknown;
  } | null;
  return typeof payload?.fileId === "string" ? payload.fileId : undefined;
}

export function SourceDocumentList({
  sources,
  selectedCitation,
  onSelectedCitationChange,
}: SourceDocumentListProps): JSX.Element {
  const headingId = useId();
  const [showAll, setShowAll] = useState(false);
  const [levelFilter, setLevelFilter] = useState<AuthorityRank | null>(null);
  const [sortMode, setSortMode] = useState<SectionSortMode>("document");
  const [selectedSource, setSelectedSource] = useState<SourceItem | null>(null);
  const [resolvingFile, setResolvingFile] = useState(false);
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const closePreview = useCallback(() => setPreviewFile(null), []);
  const closeSourcePreview = useCallback(() => {
    setSelectedSource(null);
    setResolvingFile(false);
    onSelectedCitationChange?.(undefined);
  }, [onSelectedCitationChange]);

  async function openSourcePreview(source: SourceItem): Promise<void> {
    if (isSpreadsheetSource(source)) {
      if (source.fileId) {
        setPreviewFile({ id: source.fileId, name: source.title });
        return;
      }

      setResolvingFile(true);
      try {
        const fileId = await resolveFileId(source);

        if (fileId) {
          setPreviewFile({ id: fileId, name: source.title });
        } else {
          setSelectedSource(source);
        }
      } finally {
        setResolvingFile(false);
      }
      return;
    }

    setSelectedSource(source);
    if (source.fileId) return;

    setResolvingFile(true);
    try {
      const fileId = await resolveFileId(source);

      if (fileId) {
        setSelectedSource((current) =>
          current?.key === source.key ? { ...current, fileId } : current,
        );
      }
    } finally {
      setResolvingFile(false);
    }
  }

  async function openFilePreview(
    source: SourceItem,
    quotes: readonly string[] = NO_QUOTES,
  ): Promise<void> {
    const highlight = previewHighlight(source, quotes);

    if (source.fileId) {
      setPreviewFile({
        id: source.fileId,
        name: source.fileName ?? source.title,
        highlight,
      });
      return;
    }

    setResolvingFile(true);
    try {
      const fileId = await resolveFileId(source);

      if (fileId) {
        setPreviewFile({
          id: fileId,
          name: source.fileName ?? source.title,
          highlight,
        });
      }
    } finally {
      setResolvingFile(false);
    }
  }

  if (sources.length === 0) return <></>;

  const availableLevels = [
    ...new Set(
      sources
        .map((source) => authorityRankOf(source))
        .filter((rank): rank is AuthorityRank => rank !== null),
    ),
  ].sort((left, right) => left - right);
  const filteredSources =
    levelFilter === null
      ? sources
      : sources.filter((source) => authorityRankOf(source) === levelFilter);

  const fileGroups = groupSourcesByFile(filteredSources);
  const visibleFileGroups = showAll
    ? fileGroups
    : fileGroups.slice(0, DEFAULT_VISIBLE_FILES);
  const hasHiddenFiles = fileGroups.length > DEFAULT_VISIBLE_FILES;
  const citedSource = selectedCitation
    ? (sources.find((source) =>
        source.citationNumbers?.includes(selectedCitation.number),
      ) ?? null)
    : null;

  return (
    <section className="mt-4" aria-labelledby={headingId}>
      <details className="group border-y border-slate-200 bg-slate-50/70">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-semibold text-(--ec-blue) hover:bg-slate-100">
          <span className="flex min-w-0 items-center gap-2">
            <ChevronDown
              className="size-4 shrink-0 -rotate-90 transition-transform group-open:rotate-0"
              aria-hidden="true"
            />
            <span id={headingId}>Supporting documents</span>
          </span>
          <span className="shrink-0 text-xs font-normal text-slate-500">
            {fileGroups.length} {fileGroups.length === 1 ? "file" : "files"}
            <span aria-hidden="true"> · </span>
            {filteredSources.length} matching{" "}
            {filteredSources.length === 1 ? "section" : "sections"}
          </span>
        </summary>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-3 py-2">
          {availableLevels.length > 1 ? (
            <fieldset className="flex flex-wrap items-center gap-2">
              <legend className="sr-only">Filter sources by authority level</legend>
              <span
                className="text-xs font-semibold uppercase tracking-wide text-(--ec-mute)"
                aria-hidden="true"
              >
                Level
              </span>
              <div
                className="inline-flex overflow-hidden rounded-sm border border-(--ec-line) bg-white"
                aria-label="Authority level"
              >
                <button
                  type="button"
                  aria-pressed={levelFilter === null}
                  title="Show all levels"
                  onClick={() => setLevelFilter(null)}
                  className={`h-7 px-2.5 border-r border-(--ec-line) text-xs font-semibold transition-colors ${
                    levelFilter === null
                      ? "bg-(--ec-blue) text-white"
                      : "bg-white text-(--ec-ink) hover:bg-slate-100"
                  }`}
                >
                  All
                </button>
                {availableLevels.map((rank) => (
                  <button
                    key={rank}
                    type="button"
                    aria-label={`Authority level ${rank}`}
                    aria-pressed={levelFilter === rank}
                    title={authorityRankTitle(rank)}
                    onClick={() => setLevelFilter(rank)}
                    className={`h-7 w-8 border-r border-(--ec-line) text-xs font-semibold transition-colors last:border-r-0 ${
                      levelFilter === rank
                        ? "bg-(--ec-blue) text-white"
                        : "bg-white text-(--ec-ink) hover:bg-slate-100"
                    }`}
                  >
                    {rank}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : (
            <span aria-hidden="true" />
          )}

          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="sr-only">Sort matching sections</legend>
            <span
              className="text-xs font-semibold uppercase tracking-wide text-(--ec-mute)"
              aria-hidden="true"
            >
              Sort
            </span>
            <div
              className="inline-flex overflow-hidden rounded-sm border border-(--ec-line) bg-white"
              aria-label="Section sort order"
            >
              <button
                type="button"
                aria-pressed={sortMode === "document"}
                title="Sort sections by their place in the document"
                onClick={() => setSortMode("document")}
                className={`h-7 border-r border-(--ec-line) px-2.5 text-xs font-semibold transition-colors ${
                  sortMode === "document"
                    ? "bg-(--ec-blue) text-white"
                    : "bg-white text-(--ec-ink) hover:bg-slate-100"
                }`}
              >
                Document order
              </button>
              <button
                type="button"
                aria-pressed={sortMode === "score"}
                title="Sort sections by match score"
                onClick={() => setSortMode("score")}
                className={`h-7 px-2.5 text-xs font-semibold transition-colors ${
                  sortMode === "score"
                    ? "bg-(--ec-blue) text-white"
                    : "bg-white text-(--ec-ink) hover:bg-slate-100"
                }`}
              >
                Best match
              </button>
            </div>
          </fieldset>
        </div>

        {filteredSources.length === 0 ? (
          <p className="border-t border-slate-200 bg-white px-3 py-4 text-xs text-(--ec-mute)">
            No sources match level {levelFilter}.
          </p>
        ) : (
        <ol className="divide-y divide-slate-200 border-t border-slate-200 bg-white">
          {visibleFileGroups.map((group, fileIndex) => {
            const fileSource =
              group.sources.find((source) => source.fileId) ?? group.sources[0];
            const externalSource = group.sources.find((source) => source.url);
            // Stable per-file position, independent of the current sort/filter order.
            const documentPositionByKey = new Map(
              group.sources.map((source, index) => [source.key, index + 1]),
            );

            return (
              <li key={group.key} className="flex gap-3 px-3 py-4">
                <span
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-(--ec-blue)"
                  aria-hidden="true"
                >
                  {fileIndex + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p
                        className="truncate text-sm font-semibold text-slate-950"
                        title={group.name}
                      >
                        {group.name}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {group.sources.length} matching{" "}
                        {group.sources.length === 1 ? "section" : "sections"}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs text-(--ec-blue)"
                        onClick={() => void openFilePreview(fileSource)}
                        disabled={resolvingFile}
                        aria-label={`Preview ${group.name}`}
                        title={`Preview ${group.name}`}
                      >
                        {resolvingFile ? (
                          <LoaderCircle
                            className="size-4 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <Eye className="size-4" aria-hidden="true" />
                        )}
                        Preview file
                      </Button>
                      {externalSource?.url && (
                        <a
                          href={externalSource.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-8 items-center gap-1 px-2 text-xs font-semibold text-(--ec-blue) underline underline-offset-2"
                          aria-label={`Open ${group.name} in a new tab`}
                          title={`Open ${group.name} in a new tab`}
                        >
                          <ExternalLink className="size-4" aria-hidden="true" />
                          Open
                        </a>
                      )}
                    </div>
                  </div>

                  <ol className="mt-3 divide-y divide-slate-100 border-y border-slate-200">
                    {(sortMode === "score"
                      ? sortSourcesByScore(group.sources)
                      : group.sources
                    ).map((source) => {
                      const sectionLabel = source.citationNumbers?.length
                        ? `Reference ${source.citationNumbers.map((number) => `[${number}]`).join(", ")}`
                        : `Section ${documentPositionByKey.get(source.key)}`;
                      return (
                        <li key={source.key}>
                          <details className="group/section">
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-2 py-2 text-xs hover:bg-slate-50">
                              <span className="flex min-w-0 items-center gap-2 font-semibold text-slate-700">
                                <ChevronDown
                                  className="size-3.5 shrink-0 -rotate-90 transition-transform group-open/section:rotate-0"
                                  aria-hidden="true"
                                />
                                {sectionLabel}
                              </span>
                              <ScoreBadge score={source.score} />
                            </summary>
                            <div className="border-t border-slate-100 px-2 py-3">
                              {(source.content || source.snippet) && (
                                <div className="mb-2 flex justify-end">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 px-2 text-xs text-(--ec-blue)"
                                    onClick={() =>
                                      void openSourcePreview(source)
                                    }
                                    aria-label={`Read ${sectionLabel.toLowerCase()} from ${group.name}`}
                                  >
                                    <FileText
                                      className="size-4"
                                      aria-hidden="true"
                                    />
                                    Read section
                                  </Button>
                                </div>
                              )}
                              {source.snippet && (
                                <SourceSnippet source={source} />
                              )}
                              <dl className="mt-3 grid gap-x-4 gap-y-1 border-l-2 border-slate-200 pl-3 text-xs text-slate-600 sm:grid-cols-[max-content_1fr]">
                                {source.id && (
                                  <>
                                    <dt className="font-semibold text-slate-500">
                                      Document ID
                                    </dt>
                                    <dd
                                      className="min-w-0 break-all"
                                      title={source.id}
                                    >
                                      {formatIdentifier(source.id)}
                                    </dd>
                                  </>
                                )}
                                {source.sourceType && (
                                  <>
                                    <dt className="font-semibold text-slate-500">
                                      Type
                                    </dt>
                                    <dd>{source.sourceType}</dd>
                                  </>
                                )}
                                {source.locationLabel && (
                                  <>
                                    <dt className="font-semibold text-slate-500">
                                      Origin
                                    </dt>
                                    <dd className="min-w-0 wrap-break-word">
                                      {source.locationLabel}
                                    </dd>
                                  </>
                                )}
                                {typeof source.contentLength === "number" &&
                                  source.contentLength > 0 && (
                                    <>
                                      <dt className="font-semibold text-slate-500">
                                        Content
                                      </dt>
                                      <dd>
                                        {formatContentLength(
                                          source.contentLength,
                                        )}
                                      </dd>
                                    </>
                                  )}
                              </dl>
                            </div>
                          </details>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </li>
            );
          })}
        </ol>
        )}

        {hasHiddenFiles && (
          <div className="border-t border-slate-200 bg-white px-3 py-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs text-(--ec-blue)"
              onClick={() => setShowAll((current) => !current)}
              aria-expanded={showAll}
            >
              {showAll ? "Show fewer" : `Show all ${fileGroups.length} files`}
            </Button>
          </div>
        )}
      </details>

      <SourcePreviewSidebar
        source={citedSource ?? selectedSource}
        citationNumber={citedSource ? selectedCitation?.number : undefined}
        selectedQuote={citedSource ? selectedCitation?.quote : undefined}
        resolvingFile={resolvingFile}
        onClose={closeSourcePreview}
        onPreviewFile={openFilePreview}
      />
      <FilePreviewDialog file={previewFile} onClose={closePreview} />
    </section>
  );
}
