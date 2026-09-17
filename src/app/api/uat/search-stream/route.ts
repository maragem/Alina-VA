import type { NextRequest } from "next/server";
import {
  getHaystackApiKey,
  getHaystackPipeline,
  getHaystackWorkspace,
} from "@/lib/haystackConfig";
import { requireUserId } from "@/lib/requireAuth";
import { createHaystackSearchSession } from "@/lib/haystackSearchSessions";

const API_KEY = getHaystackApiKey();
const WORKSPACE = getHaystackWorkspace();
const PIPELINE = getHaystackPipeline();

export async function POST(request: NextRequest): Promise<Response> {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as {
    query?: unknown;
  } | null;
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  if (!query) {
    return Response.json({ error: "A query is required." }, { status: 400 });
  }
  if (!API_KEY || !WORKSPACE || !PIPELINE) {
    return Response.json(
      { error: "Haystack configuration is incomplete." },
      { status: 500 },
    );
  }

  let searchSessionId: string;
  try {
    searchSessionId = await createHaystackSearchSession();
  } catch {
    return Response.json(
      { error: "Could not create a Haystack chat session." },
      { status: 502 },
    );
  }

  const upstream = await fetch(
    `https://api.cloud.deepset.ai/api/v1/workspaces/${encodeURIComponent(WORKSPACE)}/pipelines/${encodeURIComponent(PIPELINE)}/chat-stream`,
    {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        search_session_id: searchSessionId,
        include_result: true,
      }),
      signal: request.signal,
      cache: "no-store",
    },
  );
  if (!upstream.ok || !upstream.body) {
    return Response.json(
      { error: "Haystack request failed." },
      { status: upstream.status || 502 },
    );
  }
  return new Response(upstream.body, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Haystack-Search-Session-Id": searchSessionId,
    },
  });
}