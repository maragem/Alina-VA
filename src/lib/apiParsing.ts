export type JsonRecord = Record<string, unknown>;

export function getRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export function getText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function getNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function readJsonRecord(
  request: Request,
): Promise<JsonRecord | Response> {
  try {
    return getRecord(await request.json());
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
}