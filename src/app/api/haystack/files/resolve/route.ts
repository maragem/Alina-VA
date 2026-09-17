import { NextRequest } from "next/server";
import { getNumber, getRecord, getText } from "@/lib/apiParsing";
import { getHaystackApiKey, getHaystackWorkspace } from "@/lib/haystackConfig";
import { requireUserId } from "@/lib/requireAuth";

const API_KEY = getHaystackApiKey();
const WORKSPACE = getHaystackWorkspace();
const FILE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest): Promise<Response> {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  if (!API_KEY) {
    return Response.json(
      { error: "Server is missing a Haystack API key." },
      { status: 500 },
    );
  }
  if (!WORKSPACE) {
    return Response.json(
      { error: "Server is missing Haystack workspace configuration." },
      { status: 500 },
    );
  }

  const name = request.nextUrl.searchParams.get("name")?.trim() ?? "";
  if (!name || name.length > 200) {
    return Response.json(
      { error: "name must be between 1 and 200 characters." },
      { status: 400 },
    );
  }
  // Disambiguates duplicate uploads that share a name (Haystack has no unique name constraint).
  const createdAt = request.nextUrl.searchParams.get("createdAt")?.trim() ?? "";
  const createdAtMs = createdAt ? new Date(createdAt).getTime() : undefined;
  const sizeParam = request.nextUrl.searchParams.get("size")?.trim() ?? "";
  const size = sizeParam ? Number(sizeParam) : undefined;

  const params = new URLSearchParams({ name, limit: "100" });
  try {
    const response = await fetch(
      `https://api.cloud.deepset.ai/api/v1/workspaces/${encodeURIComponent(WORKSPACE)}/files?${params}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return Response.json(
        { error: "Haystack file lookup failed." },
        { status: response.status || 502 },
      );
    }

    const payload = getRecord(await response.json().catch(() => null));
    const files = Array.isArray(payload.data)
      ? payload.data.map(getRecord).filter((file) => getText(file.name) === name)
      : [];

    const disambiguated =
      files.length > 1 && (createdAtMs !== undefined || size !== undefined)
        ? files.filter((file) => {
            const matchesCreatedAt =
              createdAtMs === undefined ||
              new Date(getText(file.created_at)).getTime() === createdAtMs;
            const matchesSize =
              size === undefined || getNumber(file.size) === size;
            return matchesCreatedAt && matchesSize;
          })
        : files;

    const matches = disambiguated
      .map((file) => getText(file.file_id))
      .filter((fileId) => FILE_ID_PATTERN.test(fileId));

    return Response.json({ fileId: matches.length === 1 ? matches[0] : null });
  } catch {
    return Response.json(
      { error: "Could not reach Haystack file services." },
      { status: 502 },
    );
  }
}
