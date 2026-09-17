import { getRecord, getText } from "@/lib/apiParsing";

export async function apiError(response: Response, fallback: string): Promise<Error> {
  const payload = getRecord(await response.json().catch(() => null));
  const message = getText(payload.error);
  return new Error(message || fallback);
}

export async function apiErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  const payload = getRecord(await response.json().catch(() => null));
  const message = getText(payload.error);
  return message || fallback;
}