import type {
  CitationSpan,
  SourceItem,
} from "@/components/global/sourceDocuments";

// In practice Haystack reports the whole chunk as the cited range; highlighting that inside
// the chunk itself would be noise, so callers can filter those out.
const WHOLE_CHUNK_RATIO = 0.95;
const MIN_SEGMENT_CHARS = 80;

// Offsets are computed against the content Haystack sent to the model, which is slightly
// longer than what we store (we trim it), so the end is clamped rather than rejected.
export function resolveCitationQuote(
  content: string | undefined,
  span: CitationSpan,
): string | null {
  if (!content) return null;
  if (span.docStart < 0 || span.docStart >= content.length) return null;

  const quote = content
    .slice(span.docStart, Math.min(span.docEnd, content.length))
    .trim();
  return quote ? quote : null;
}

export function isWholeChunkQuote(
  content: string | undefined,
  quote: string,
): boolean {
  const length = content?.trim().length ?? 0;
  return length > 0 && quote.length >= length * WHOLE_CHUNK_RATIO;
}

export function citationSpansFor(
  source: SourceItem,
  citationNumber: number,
): readonly CitationSpan[] {
  return (source.citations ?? []).filter(
    (span) => span.number === citationNumber,
  );
}

export function citationQuotes(
  source: SourceItem,
  citationNumber: number,
): readonly string[] {
  const quotes = citationSpansFor(source, citationNumber)
    .map((span) => resolveCitationQuote(source.content, span))
    .filter((quote): quote is string => quote !== null);

  return [...new Set(quotes)];
}

/**
 * A cited passage can straddle several pages of the original file, so it is matched as
 * independent sentence-sized segments rather than one long block.
 */
export function splitQuoteIntoSegments(quote: string): string[] {
  const segments: string[] = [];
  let current = "";

  for (const part of quote.split(/(?<=[.;:!?])\s+|\n+/)) {
    current = current ? `${current} ${part.trim()}` : part.trim();
    if (current.length >= MIN_SEGMENT_CHARS) {
      segments.push(current);
      current = "";
    }
  }
  if (current.length >= MIN_SEGMENT_CHARS) segments.push(current);

  return segments.length ? segments : [quote];
}
