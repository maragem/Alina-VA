export const MAX_QUESTION_LENGTH = 20_000;
export const MAX_TITLE_LENGTH = 80;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function normalizeQuestion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const question = value.trim();
  return question && question.length <= MAX_QUESTION_LENGTH ? question : null;
}

export function normalizeTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.trim().replace(/\s+/g, " ");
  return title && title.length <= MAX_TITLE_LENGTH ? title : null;
}

export function titleFromQuestion(question: string): string {
  const normalized = question.trim().replace(/\s+/g, " ");
  if (normalized.length <= MAX_TITLE_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

type ConversationCursor = Readonly<{ updatedAt: string; id: string }>;

export function encodeConversationCursor(cursor: ConversationCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeConversationCursor(
  value: string | null,
): ConversationCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<ConversationCursor>;
    if (
      !isUuid(parsed.id) ||
      typeof parsed.updatedAt !== "string" ||
      Number.isNaN(Date.parse(parsed.updatedAt))
    ) {
      return null;
    }
    return { id: parsed.id, updatedAt: parsed.updatedAt };
  } catch {
    return null;
  }
}