export type SourceMetadataItem = Readonly<{
  key: string;
  value: string;
}>;

/** Character range of a cited passage inside the source chunk, as reported by Haystack. */
export type CitationSpan = Readonly<{
  number: number;
  docStart: number;
  docEnd: number;
  answerStart?: number;
  answerEnd?: number;
  label?: string;
  origin?: string;
}>;

export type SourceItem = Readonly<{
  key: string;
  id: string;
  citationNumbers?: readonly number[];
  citations?: readonly CitationSpan[];
  fileId?: string;
  fileName?: string;
  /** Haystack's `_file_created_at`/`_file_size` meta, used to disambiguate files that share a name. */
  fileCreatedAt?: string;
  fileSize?: number;
  title: string;
  tags?: readonly string[];
  metadata?: readonly SourceMetadataItem[];
  content?: string;
  snippet?: string;
  score?: number;
  url?: string;
  sourceType?: string;
  locationLabel?: string;
  contentLength?: number;
}>;

const FILE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeFileId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const fileId = value.trim();
  return FILE_ID_PATTERN.test(fileId) ? fileId : undefined;
}

export function normalizeSourceUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

const GENERIC_TITLES = new Set([
  "document",
  "source",
  "file",
  "untitled source",
]);

export function isEmptySource(source: SourceItem): boolean {
  const title = source.title?.trim().toLowerCase() ?? "";
  return (
    GENERIC_TITLES.has(title) &&
    !source.content &&
    !source.snippet &&
    !source.fileName &&
    !source.fileId &&
    !source.url &&
    !source.tags?.length
  );
}

export function createSourceKey(
  id: string,
  title: string,
  content?: string,
): string {
  return [id, title, content ?? ""]
    .map((value) => value.trim().replace(/\s+/g, " ").toLowerCase())
    .join("|");
}
