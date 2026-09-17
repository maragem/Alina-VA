import {
  createSourceKey,
  normalizeFileId,
  normalizeSourceUrl,
  type CitationSpan,
  type SourceItem,
  type SourceMetadataItem,
} from "@/components/global/sourceDocuments";

type JsonRecord = Record<string, unknown>;

export type HaystackResultEvent = Readonly<{
  type: "result";
  queryId: string | null;
  result: unknown;
}>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numeric(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function matchScore(value: unknown): number | undefined {
  const parsed = numeric(value);
  // Haystack currently emits zero for reference scores as a placeholder.
  if (parsed === undefined || Object.is(parsed, 0)) return undefined;
  return parsed;
}

function hasDefinedScore(score: number | undefined): score is number {
  return typeof score === "number" && Number.isFinite(score);
}

function citationNumber(source: JsonRecord, meta: JsonRecord): number | undefined {
  const candidates = [...Object.entries(source), ...Object.entries(meta)];
  for (const [key, value] of candidates) {
    if (!/(?:citation|reference)(?:_|\s)*(?:number|index|id)?$/i.test(key)) {
      continue;
    }
    const match = String(value).trim().match(/^\[?(\d+)\]?$/);
    if (!match) continue;
    const parsed = Number(match[1]);
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

// Haystack reports the cited document's 1-based position in the result documents array,
// which is exactly the inline `[n]` marker used in the answer.
function documentPosition(source: JsonRecord): number | undefined {
  const parsed = numeric(source.document_position);
  return parsed !== undefined && Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : undefined;
}

function citationSpan(
  source: JsonRecord,
  number: number,
): CitationSpan | undefined {
  const docStart = numeric(source.doc_start_idx);
  const docEnd = numeric(source.doc_end_idx);
  if (
    docStart === undefined ||
    docEnd === undefined ||
    !Number.isSafeInteger(docStart) ||
    !Number.isSafeInteger(docEnd) ||
    docStart < 0 ||
    docEnd <= docStart
  ) {
    return undefined;
  }
  return {
    number,
    docStart,
    docEnd,
    answerStart: numeric(source.answer_start_idx),
    answerEnd: numeric(source.answer_end_idx),
    label: text(source.label) || undefined,
    origin: text(source.origin) || undefined,
  };
}

export function citationSpanKey(span: CitationSpan): string {
  return `${span.number}|${span.docStart}|${span.docEnd}`;
}

function mergeCitationSpans(
  current: readonly CitationSpan[] | undefined,
  next: readonly CitationSpan[] | undefined,
): readonly CitationSpan[] | undefined {
  if (!current?.length) return next;
  if (!next?.length) return current;

  const merged = new Map<string, CitationSpan>();
  for (const span of [...current, ...next]) {
    merged.set(citationSpanKey(span), span);
  }
  return [...merged.values()].sort(
    (left, right) => left.docStart - right.docStart,
  );
}

function metadata(meta: JsonRecord): SourceMetadataItem[] {
  const excluded = new Set(["text", "content", "embedding", "tags", "tag"]);
  return Object.entries(meta).flatMap(([key, value]) => {
    if (excluded.has(key.toLowerCase())) return [];
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return [{ key, value: String(value) }];
    }
    try {
      return value === undefined ? [] : [{ key, value: JSON.stringify(value) }];
    } catch {
      return [];
    }
  });
}

function tags(meta: JsonRecord): string[] | undefined {
  const value = meta.tags ?? meta.tag;
  const result = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? value.split(",")
      : [];
  const normalized = result.map((item) => item.trim()).filter(Boolean);
  return normalized.length ? normalized : undefined;
}

type StoredSource = Readonly<{
  documentId: string | null;
  chunkId: string | null;
  item: SourceItem;
}>;

function sourceFromRecord(
  candidate: unknown,
  isReference = false,
  fallbackCitationNumber?: number,
): StoredSource | null {
  const source = record(candidate);
  const meta = record(source.meta);
  const resolvedCitationNumber =
    documentPosition(source) ??
    citationNumber(source, meta) ??
    fallbackCitationNumber;
  const span =
    isReference && resolvedCitationNumber !== undefined
      ? citationSpan(source, resolvedCitationNumber)
      : undefined;
  const content = text(source.content) || text(source.text) || text(meta.text);
  const documentId =
    text(source.document_id) || text(source.id) || text(meta.document_id);
  const chunkId = text(source.chunk_id) || text(meta.chunk_id) || null;
  const fileId = normalizeFileId(text(source.file_id) || text(meta.file_id));
  const fileName = text(meta.file_name) || text(meta.name) || undefined;
  const fileCreatedAt = text(meta._file_created_at) || undefined;
  const fileSize = numeric(meta._file_size);
  const title =
    text(source.document_name) ||
    text(source.title) ||
    text(meta.title) ||
    fileName ||
    text(source.content_type) ||
    "Document";
  const url = normalizeSourceUrl(
    text(source.url) || text(meta.url) || text(meta.source_url),
  );
  const sourceMetadata = metadata(meta);
  if (!content && !documentId && !fileId && !fileName && !url) return null;

  const item: SourceItem = {
    key: createSourceKey(documentId, title, content),
    id: documentId,
    citationNumbers:
      resolvedCitationNumber === undefined
        ? undefined
        : [resolvedCitationNumber],
    citations: span ? [span] : undefined,
    fileId,
    fileName,
    fileCreatedAt,
    fileSize,
    title,
    tags: tags(meta),
    metadata: sourceMetadata.length ? sourceMetadata : undefined,
    content: content || undefined,
    snippet:
      !content || content.length <= 280
        ? content || undefined
        : `${content.slice(0, 280)}...`,
    score: matchScore(source.score),
    url,
    sourceType:
      text(meta.content_type) ||
      text(meta.mime_type) ||
      text(meta.file_type) ||
      text(source.content_type) ||
      undefined,
    contentLength:
      numeric(meta.content_length) ?? (content ? content.length : undefined),
  };
  return { documentId: documentId || null, chunkId, item };
}

function sourceIdentity(source: StoredSource): string {
  return source.chunkId || source.documentId || source.item.key;
}

function mergeSource(
  current: StoredSource,
  candidate: StoredSource,
): StoredSource {
  const item = current.item;
  const next = candidate.item;
  return {
    documentId: current.documentId ?? candidate.documentId,
    chunkId: current.chunkId ?? candidate.chunkId,
    item: {
      ...next,
      key: item.key,
      id: item.id || next.id,
      citationNumbers: Array.from(
        new Set([
          ...(item.citationNumbers ?? []),
          ...(next.citationNumbers ?? []),
        ]),
      ),
      citations: mergeCitationSpans(item.citations, next.citations),
      fileId: item.fileId ?? next.fileId,
      fileName: item.fileName ?? next.fileName,
      fileCreatedAt: item.fileCreatedAt ?? next.fileCreatedAt,
      fileSize: item.fileSize ?? next.fileSize,
      title: item.title !== "Document" ? item.title : next.title,
      tags: item.tags?.length ? item.tags : next.tags,
      metadata: item.metadata?.length ? item.metadata : next.metadata,
      content: item.content ?? next.content,
      snippet: item.snippet ?? next.snippet,
      score:
        hasDefinedScore(item.score) && hasDefinedScore(next.score)
          ? Math.max(item.score, next.score)
          : (item.score ?? next.score),
      url: item.url ?? next.url,
      sourceType: item.sourceType ?? next.sourceType,
      locationLabel: item.locationLabel ?? next.locationLabel,
      contentLength: item.contentLength ?? next.contentLength,
    },
  };
}

function normalizeSourceLabel(value: string | undefined): string | null {
  const label = value?.trim().replace(/\s+/g, " ").toLowerCase();
  return label ? label : null;
}

function sourceDocumentKey(source: StoredSource): string | null {
  if (source.item.fileId) return `file:${source.item.fileId.toLowerCase()}`;

  const fileName = normalizeSourceLabel(source.item.fileName);
  if (fileName) return `name:${fileName}`;

  const title = normalizeSourceLabel(source.item.title);
  return title ? `title:${title}` : null;
}

function withCitationScoreFallback(sources: StoredSource[]): StoredSource[] {
  const bestScoreByDocument = new Map<string, number>();

  for (const source of sources) {
    const score = source.item.score;
    const key = sourceDocumentKey(source);
    if (!key || !hasDefinedScore(score)) continue;

    const current = bestScoreByDocument.get(key);
    if (current === undefined || score > current) {
      bestScoreByDocument.set(key, score);
    }
  }

  return sources.map((source) => {
    if (hasDefinedScore(source.item.score)) return source;
    if (!source.item.citationNumbers?.length) return source;

    const key = sourceDocumentKey(source);
    if (!key) return source;

    const fallbackScore = bestScoreByDocument.get(key);
    if (!hasDefinedScore(fallbackScore)) return source;

    return {
      ...source,
      item: {
        ...source.item,
        score: fallbackScore,
      },
    };
  });
}

export function parseHaystackResultEvent(
  block: string,
): HaystackResultEvent | null {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (!data) return null;
  try {
    const event = record(JSON.parse(data));
    return event.type === "result" && "result" in event
      ? {
          type: "result",
          queryId: text(event.query_id) || null,
          result: event.result,
        }
      : null;
  } catch {
    return null;
  }
}

export function parseHaystackDeltaText(block: string): string {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (!data) return "";
  try {
    const event = record(JSON.parse(data));
    const deltaText = record(event.delta).text;
    return event.type === "delta" && typeof deltaText === "string"
      ? deltaText
      : "";
  } catch {
    return "";
  }
}

const HEX_CITATION_GROUP = /\[([0-9a-f]{6}(?:\s*,\s*[0-9a-f]{6})*)\]/gi;

/**
 * Renumbers hex citation tokens (e.g. `[41bbd0]` or `[41bbd0, 8c3a12]`) emitted by the
 * agent into 1-based sequential citations `[1]`, `[1][2]`, matching the contract expected
 * by the UI and database.
 */
export function renumberCitationTokens(text: string): string {
  if (!text || !/[0-9a-f]{6}/i.test(text)) return text;
  const tokenToNumber = new Map<string, number>();
  let nextNumber = 1;

  return text.replace(HEX_CITATION_GROUP, (match, group: string) => {
    const tokens = group.split(",").map((t) => t.trim().toLowerCase());
    const rendered: string[] = [];
    for (const token of tokens) {
      if (!/^[0-9a-f]{6}$/.test(token)) continue;
      let num = tokenToNumber.get(token);
      if (num === undefined) {
        num = nextNumber++;
        tokenToNumber.set(token, num);
      }
      rendered.push(`[${num}]`);
    }
    return rendered.length > 0 ? rendered.join("") : match;
  });
}

function extractChatMessageText(messageValue: unknown): string {
  if (typeof messageValue === "string") return messageValue.trim();
  const message = record(messageValue);
  if (typeof message.text === "string" && message.text.trim()) {
    return message.text.trim();
  }
  if (typeof message.content === "string" && message.content.trim()) {
    return message.content.trim();
  }
  if (Array.isArray(message.content)) {
    const combined = message.content
      .map((item) => {
        if (typeof item === "string") return item;
        const rec = record(item);
        return typeof rec.text === "string" ? rec.text : "";
      })
      .join("")
      .trim();
    if (combined) return combined;
  }
  if (Array.isArray(message._content)) {
    const combined = message._content
      .map((item) => {
        if (typeof item === "string") return item;
        const rec = record(item);
        return typeof rec.text === "string" ? rec.text : "";
      })
      .join("")
      .trim();
    if (combined) return combined;
  }
  return "";
}

function isAssistantChatMessage(messageValue: unknown): boolean {
  if (typeof messageValue === "string") return true;
  const message = record(messageValue);
  const roleValue = message.role ?? message._role;
  const role =
    typeof roleValue === "string"
      ? roleValue
      : typeof record(roleValue).value === "string"
        ? (record(roleValue).value as string)
        : "";
  return !role || role.toLowerCase() === "assistant";
}

export function extractHaystackResult(payload: unknown): {
  text: string;
  resultId: string | null;
  sources: StoredSource[];
} {
  const root = record(payload);
  let answerText = "";
  let resultId: string | null = null;
  const collected = new Map<string, StoredSource>();

  function collectSource(source: StoredSource): void {
    const identity = sourceIdentity(source);
    const current = collected.get(identity);
    collected.set(identity, current ? mergeSource(current, source) : source);
  }

  function collectNode(value: unknown): void {
    if (!value || typeof value !== "object") return;
    const node = record(value);
    const nodeResultId = text(node.result_id);
    const nodeDocuments = array(node.documents);

    // 1. Process answers (legacy Haystack Search pipelines)
    for (const answerValue of array(node.answers)) {
      const answer = record(answerValue);
      const answerDocuments = array(answer.documents);
      const citationDocuments = answerDocuments.length
        ? answerDocuments
        : nodeDocuments;
      const documentPositions = new Map<string, number>();
      for (const [index, document] of citationDocuments.entries()) {
        const source = sourceFromRecord(document, false, index + 1);
        if (source) documentPositions.set(sourceIdentity(source), index + 1);
      }
      const candidate =
        text(answer.answer) || text(answer.content) || text(answer.text);
      if (candidate.length > answerText.length) {
        answerText = candidate;
        resultId = text(answer.result_id) || nodeResultId || null;
      }
      for (const reference of array(record(answer.meta)._references)) {
        const referenceSource = sourceFromRecord(reference, true);
        const source = referenceSource
          ? sourceFromRecord(
              reference,
              true,
              documentPositions.get(sourceIdentity(referenceSource)),
            )
          : null;
        if (source) collectSource(source);
      }
      for (const [index, document] of answerDocuments.entries()) {
        const source = sourceFromRecord(document, false, index + 1);
        if (source) collectSource(source);
      }
    }

    // 2. Process messages (Haystack 2.x Chat / Agent pipelines)
    const messages = array(node.messages);
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (isAssistantChatMessage(msg)) {
        const msgText = extractChatMessageText(msg);
        if (msgText) {
          if (!answerText || msgText.length >= answerText.length) {
            answerText = msgText;
            resultId = text(record(msg).result_id) || nodeResultId || resultId;
          }
          break;
        }
      }
    }

    // 3. Process replies (Haystack 2.x generator outputs)
    const replies = array(node.replies);
    for (let i = replies.length - 1; i >= 0; i--) {
      const reply = replies[i];
      const replyText = extractChatMessageText(reply);
      if (replyText) {
        if (!answerText || replyText.length >= answerText.length) {
          answerText = replyText;
          resultId = text(record(reply).result_id) || nodeResultId || resultId;
        }
        break;
      }
    }

    // 4. Process documents (numbered 1-based in citation order)
    for (const [index, document] of nodeDocuments.entries()) {
      const source = sourceFromRecord(document, false, index + 1);
      if (source) collectSource(source);
    }

    // 5. Process direct content fields on node
    const directCandidate =
      text(node.answer) || text(node.content) || text(node.text);
    if (
      directCandidate &&
      (!answerText || directCandidate.length > answerText.length)
    ) {
      answerText = directCandidate;
      resultId = nodeResultId || resultId;
    }

    // 6. Inspect nested component dicts (e.g. citation_renumberer, agent)
    for (const [key, child] of Object.entries(node)) {
      if (
        key !== "answers" &&
        key !== "messages" &&
        key !== "replies" &&
        key !== "documents" &&
        key !== "results" &&
        child &&
        typeof child === "object" &&
        !Array.isArray(child)
      ) {
        collectNode(child);
      }
    }
  }

  collectNode(root);
  for (const result of array(root.results)) collectNode(result);
  return {
    text: renumberCitationTokens(answerText),
    resultId,
    sources: withCitationScoreFallback([...collected.values()]),
  };
}
