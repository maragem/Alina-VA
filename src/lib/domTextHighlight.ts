import { findInOriginal } from "@/lib/textHighlightMatch";

const HIGHLIGHT_NAME = "alina-citation";
const MARK_ATTRIBUTE = "data-alina-citation";
const HIGHLIGHT_STYLE = `::highlight(${HIGHLIGHT_NAME}) { background-color: rgb(255 224 102 / 0.38); }`;

let highlightStyleInstalled = false;

type HighlightRegistry = Readonly<{
  set: (name: string, highlight: object) => void;
  delete: (name: string) => void;
}>;

type HighlightConstructor = new (...ranges: Range[]) => object;

function highlightApi(): {
  registry: HighlightRegistry;
  Highlight: HighlightConstructor;
} | null {
  if (typeof CSS === "undefined") return null;
  const registry = (CSS as unknown as { highlights?: HighlightRegistry })
    .highlights;
  const constructor = (
    globalThis as unknown as { Highlight?: HighlightConstructor }
  ).Highlight;
  return registry && constructor ? { registry, Highlight: constructor } : null;
}

function installHighlightStyle(): void {
  if (highlightStyleInstalled || typeof document === "undefined") return;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(HIGHLIGHT_STYLE);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    highlightStyleInstalled = true;
  } catch {
    // Browsers without constructable stylesheets use the mark fallback.
  }
}

type TextIndex = Readonly<{
  text: string;
  nodes: readonly Text[];
  starts: readonly number[];
}>;

function buildTextIndex(container: HTMLElement): TextIndex {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  const starts: number[] = [];
  const blockCache = new Map<Element, boolean>();
  let previousParent: Element | null = null;
  let text = "";

  // Adjacent block elements (paragraphs, PDF text-layer spans) hold separate words even
  // though their text nodes concatenate without whitespace.
  function isBlock(element: Element | null): boolean {
    if (!element) return true;
    const cached = blockCache.get(element);
    if (cached !== undefined) return cached;
    const display = getComputedStyle(element).display;
    const block = !display.startsWith("inline") && display !== "contents";
    blockCache.set(element, block);
    return block;
  }

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue;
    if (!value) continue;

    const parent = node.parentElement;
    if (
      text &&
      parent !== previousParent &&
      (isBlock(parent) || isBlock(previousParent))
    ) {
      text += " ";
    }
    previousParent = parent;

    nodes.push(node as Text);
    starts.push(text.length);
    text += value;
  }

  return { text, nodes, starts };
}

function locate(
  index: TextIndex,
  offset: number,
): { node: Text; offset: number } | null {
  let low = 0;
  let high = index.nodes.length - 1;
  let found = -1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    if (index.starts[middle] <= offset) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (found < 0) return null;

  const node = index.nodes[found];
  const local = offset - index.starts[found];
  return local <= (node.nodeValue?.length ?? 0)
    ? { node, offset: local }
    : null;
}

function wrapRange(range: Range): void {
  try {
    const mark = document.createElement("mark");
    mark.setAttribute(MARK_ATTRIBUTE, "");
    mark.appendChild(range.extractContents());
    range.insertNode(mark);
  } catch {
    // Ranges crossing element boundaries cannot always be wrapped; skip them.
  }
}

export function clearCitationHighlights(container?: HTMLElement | null): void {
  highlightApi()?.registry.delete(HIGHLIGHT_NAME);

  const root: ParentNode = container ?? document;
  for (const mark of root.querySelectorAll(`mark[${MARK_ATTRIBUTE}]`)) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
}

/** Highlights every quote found in `container`; returns the ranges that matched. */
export function highlightCitationQuotes(
  container: HTMLElement,
  quotes: readonly string[],
): Range[] {
  clearCitationHighlights(container);
  if (!quotes.length) return [];

  const index = buildTextIndex(container);
  if (!index.text) return [];

  const ranges: Range[] = [];
  for (const quote of quotes) {
    const match = findInOriginal(index.text, quote);
    if (!match) continue;

    const start = locate(index, match.start);
    const end = locate(index, match.end);
    if (!start || !end) continue;

    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    ranges.push(range);
  }
  if (!ranges.length) return [];

  const api = highlightApi();
  if (api) {
    installHighlightStyle();
    api.registry.set(HIGHLIGHT_NAME, new api.Highlight(...ranges));
  } else {
    for (const range of [...ranges].reverse()) wrapRange(range);
  }
  return ranges;
}

export function scrollRangeIntoView(range: Range): void {
  const target =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as HTMLElement)
      : range.startContainer.parentElement;
  target?.scrollIntoView({ block: "center", behavior: "smooth" });
}
