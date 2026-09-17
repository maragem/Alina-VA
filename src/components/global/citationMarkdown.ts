import { renumberCitationTokens } from "@/lib/haystackStreamPayload";

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  title?: string;
  data?: {
    hProperties?: Record<string, string>;
  };
  children?: MarkdownNode[];
};

const CITATION_GROUP = /\[(\d+(?:\s*(?:,|[-–])\s*\d+)*)\]/g;
const CITATION_NUMBER = /\d+/g;
const EXCLUDED_PARENTS = new Set(["code", "inlineCode", "link", "html"]);

export { renumberCitationTokens };

export function citationHref(citationNumber: number): string {
  return `#citation-${citationNumber}`;
}

export function citationNumberFromHref(href: string | undefined): number | undefined {
  const match = href?.match(/^#citation-(\d+)$/);
  if (!match) return undefined;
  const citationNumber = Number(match[1]);
  return Number.isSafeInteger(citationNumber) && citationNumber > 0
    ? citationNumber
    : undefined;
}

function citationQuote(
  value: string,
  markerStart: number,
  markerEnd: number,
): string | undefined {
  const before = value.slice(0, markerStart);
  const after = value.slice(markerEnd);
  const quotedStart = Math.max(
    before.lastIndexOf("\u201c"),
    before.lastIndexOf('"'),
  );
  if (quotedStart >= 0) {
    const quoted = before
      .slice(quotedStart + 1)
      .replace(/[\u201d"]\s*$/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (quoted.length >= 24) return quoted;
  }
  const sentenceStart = Math.max(
    before.lastIndexOf("."),
    before.lastIndexOf("!"),
    before.lastIndexOf("?"),
    before.lastIndexOf("\n"),
  );
  const sentenceEndCandidates = [".", "!", "?", "\n"]
    .map((boundary) => after.indexOf(boundary))
    .filter((index) => index >= 0);
  const sentenceEnd =
    sentenceEndCandidates.length > 0
      ? Math.min(...sentenceEndCandidates)
      : after.length;
  const quote =
    `${before.slice(sentenceStart + 1)}${after.slice(0, sentenceEnd)}`
      .replace(/\s+/g, " ")
      .trim();
  return quote.length >= 24 ? quote : undefined;
}

function plainText(node: MarkdownNode): string {
  if (node.value) return node.value;
  return node.children?.map(plainText).join("") ?? "";
}

function citationNodes(
  value: string,
  validCitations: ReadonlySet<number>,
  context = value,
  contextOffset = 0,
): MarkdownNode[] | undefined {
  const nodes: MarkdownNode[] = [];
  let cursor = 0;

  for (const match of value.matchAll(CITATION_GROUP)) {
    const matchIndex = match.index;
    const citationText = match[1];
    const quote = citationQuote(
      context,
      contextOffset + matchIndex,
      contextOffset + matchIndex + match[0].length,
    );
    const citationNumbers = [...citationText.matchAll(CITATION_NUMBER)].map(
      (numberMatch) => Number(numberMatch[0]),
    );
    if (!citationNumbers.every((number) => validCitations.has(number)))
      continue;

    if (matchIndex > cursor) {
      nodes.push({ type: "text", value: value.slice(cursor, matchIndex) });
    }
    let citationCursor = 0;
    for (const numberMatch of citationText.matchAll(CITATION_NUMBER)) {
      const numberIndex = numberMatch.index;
      if (numberIndex > citationCursor) {
        nodes.push({
          type: "text",
          value: citationText.slice(citationCursor, numberIndex),
        });
      }
      const citationNumber = Number(numberMatch[0]);
      nodes.push({
        type: "link",
        url: citationHref(citationNumber),
        title: quote,
        data: quote
          ? { hProperties: { "data-citation-quote": quote } }
          : undefined,
        children: [{ type: "text", value: numberMatch[0] }],
      });
      citationCursor = numberIndex + numberMatch[0].length;
    }

    if (citationCursor < citationText.length) {
      nodes.push({ type: "text", value: citationText.slice(citationCursor) });
    }
    cursor = matchIndex + match[0].length;
  }

  if (cursor === 0) return undefined;
  if (cursor < value.length)
    nodes.push({ type: "text", value: value.slice(cursor) });
  return nodes;
}

export function createCitationPlugin(validCitations: ReadonlySet<number>) {
  return function citationPlugin() {
    return function transform(tree: MarkdownNode): void {
      function visit(node: MarkdownNode): void {
        if (!node.children || EXCLUDED_PARENTS.has(node.type)) return;

        const childOffsets = new Map<MarkdownNode, number>();
        let offset = 0;
        for (const child of node.children) {
          childOffsets.set(child, offset);
          offset += plainText(child).length;
        }
        const context = node.children.map(plainText).join("");

        node.children = node.children.flatMap((child) => {
          if (child.type !== "text" || !child.value) {
            visit(child);
            return [child];
          }
          return (
            citationNodes(
              child.value,
              validCitations,
              context,
              childOffsets.get(child) ?? 0,
            ) ?? [child]
          );
        });
      }

      visit(tree);
    };
  };
}