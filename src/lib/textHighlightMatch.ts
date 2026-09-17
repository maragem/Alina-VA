// Haystack character offsets index the extracted chunk text, not the rendered document, so
// locating a quote inside a PDF/DOCX requires matching normalized text and mapping back.

type NormalizedText = Readonly<{
  text: string;
  /** Original index for each character of `text`. */
  offsets: readonly number[];
}>;

export type MatchRange = Readonly<{ start: number; end: number }>;

const CHARACTER_REPLACEMENTS = new Map<string, string>([
  ["\u2018", "'"],
  ["\u2019", "'"],
  ["\u201a", "'"],
  ["\u201c", '"'],
  ["\u201d", '"'],
  ["\u201e", '"'],
  ["\u2013", "-"],
  ["\u2014", "-"],
  ["\u2212", "-"],
  ["\u00a0", " "],
]);

const DROPPED_CHARACTERS = new Set([
  "#",
  "*",
  "|",
  "_",
  "`",
  ">",
  "~",
  "\u00ad",
  "\u200b",
  "\ufeff",
]);

const SHINGLE_WORDS = 8;
const MAX_ANCHOR_ATTEMPTS = 24;
const MAX_OCCURRENCES = 3;
const MIN_SIMILARITY = 0.55;

export function normalizeForMatch(input: string): NormalizedText {
  const text: string[] = [];
  const offsets: number[] = [];
  let swallowWhitespace = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (DROPPED_CHARACTERS.has(character)) continue;

    // Words hyphenated across a line break are a single word in the source chunk.
    if (character === "-" && /^[^\S\n]*\n/.test(input.slice(index + 1))) {
      swallowWhitespace = true;
      continue;
    }

    if (/\s/.test(character)) {
      if (swallowWhitespace) continue;
      if (text.length === 0 || text[text.length - 1] === " ") continue;
      text.push(" ");
      offsets.push(index);
      continue;
    }

    swallowWhitespace = false;
    const replaced = CHARACTER_REPLACEMENTS.get(character) ?? character;
    const folded = replaced
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("en-GB");

    for (const foldedCharacter of folded) {
      text.push(foldedCharacter);
      offsets.push(index);
    }
  }

  while (text.length && text[text.length - 1] === " ") {
    text.pop();
    offsets.pop();
  }

  return { text: text.join(""), offsets };
}

type Word = Readonly<{ start: number; end: number }>;

function words(text: string): Word[] {
  return [...text.matchAll(/\S+/g)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

/** Share of the needle's distinctive words present in `window`. */
function similarity(window: string, needle: string): number {
  const needleWords = needle.split(" ").filter((word) => word.length > 3);
  if (!needleWords.length) return 0;

  const windowWords = new Set(window.split(" "));
  const hits = needleWords.filter((word) => windowWords.has(word)).length;
  return hits / needleWords.length;
}

function snapBackToWord(text: string, index: number): number {
  let cursor = Math.max(0, Math.min(index, text.length));
  while (cursor > 0 && text[cursor - 1] !== " ") cursor -= 1;
  return cursor;
}

function snapForwardToWord(text: string, index: number): number {
  let cursor = Math.max(0, Math.min(index, text.length));
  while (cursor < text.length && text[cursor] !== " ") cursor += 1;
  return cursor;
}

/** Locates `needle` inside `haystack`; both must already be normalized. */
export function findBestMatch(
  haystack: string,
  needle: string,
): MatchRange | null {
  if (!haystack || !needle) return null;

  const exact = haystack.indexOf(needle);
  if (exact >= 0) return { start: exact, end: exact + needle.length };

  const needleWords = words(needle);
  if (needleWords.length < SHINGLE_WORDS) return null;

  const step = Math.max(
    1,
    Math.floor(needleWords.length / MAX_ANCHOR_ATTEMPTS),
  );
  let best: { range: MatchRange; score: number } | null = null;

  for (
    let index = 0;
    index + SHINGLE_WORDS <= needleWords.length;
    index += step
  ) {
    const shingle = needle.slice(
      needleWords[index].start,
      needleWords[index + SHINGLE_WORDS - 1].end,
    );

    let from = 0;
    for (let occurrence = 0; occurrence < MAX_OCCURRENCES; occurrence += 1) {
      const at = haystack.indexOf(shingle, from);
      if (at < 0) break;
      from = at + 1;

      const start = snapBackToWord(haystack, at - needleWords[index].start);
      const end = snapForwardToWord(haystack, start + needle.length);
      const score = similarity(haystack.slice(start, end), needle);
      if (!best || score > best.score) best = { range: { start, end }, score };
    }
  }

  return best &&
    best.score >= MIN_SIMILARITY &&
    best.range.end > best.range.start
    ? best.range
    : null;
}

/** Maps a match in normalized coordinates back to indices in the original string. */
export function toOriginalRange(
  normalized: NormalizedText,
  match: MatchRange,
): MatchRange | null {
  const start = normalized.offsets[match.start];
  const lastCharacter = normalized.offsets[match.end - 1];
  if (start === undefined || lastCharacter === undefined) return null;
  return { start, end: lastCharacter + 1 };
}

export function findInOriginal(
  original: string,
  quote: string,
): MatchRange | null {
  const normalized = normalizeForMatch(original);
  const match = findBestMatch(normalized.text, normalizeForMatch(quote).text);
  return match ? toOriginalRange(normalized, match) : null;
}
