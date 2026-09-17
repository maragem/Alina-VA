import { NextRequest } from "next/server";
import { getRecord, getText, readJsonRecord, type JsonRecord } from "@/lib/apiParsing";
import {
  getHaystackApiKey,
  getHaystackPipelineId,
  getHaystackWorkspaceId,
} from "@/lib/haystackConfig";
import { requireAppUser } from "@/lib/currentUser";

const FEEDBACK_SCORES = ["ACCURATE", "FAIRLY_ACCURATE", "INACCURATE"] as const;
type FeedbackScore = (typeof FEEDBACK_SCORES)[number];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const WORKSPACE_ID = getHaystackWorkspaceId();
const PIPELINE_ID = getHaystackPipelineId();
const API_KEY = getHaystackApiKey();

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function isFeedbackScore(value: unknown): value is FeedbackScore {
  return (
    typeof value === "string" &&
    FEEDBACK_SCORES.includes(value as FeedbackScore)
  );
}

function getConfigurationError(): Response | undefined {
  if (!API_KEY) {
    return Response.json(
      {
        error:
          "Server is missing Haystack API key. Set HAYSTACK_API_KEY or DEEPSET_API_KEY.",
      },
      { status: 500 },
    );
  }

  if (!isUuid(WORKSPACE_ID) || !isUuid(PIPELINE_ID)) {
    return Response.json(
      {
        error:
          "Server is missing valid feedback identifiers. Set HAYSTACK_WORKSPACE_ID and HAYSTACK_PIPELINE_ID.",
      },
      { status: 500 },
    );
  }
}

async function readBody(request: NextRequest): Promise<JsonRecord | Response> {
  return readJsonRecord(request);
}

function isResponse(value: JsonRecord | Response): value is Response {
  return value instanceof Response;
}

function feedbackUrl(feedbackId?: string): string {
  const base = `https://api.cloud.deepset.ai/api/v2/workspaces/${encodeURIComponent(WORKSPACE_ID)}/pipelines/${encodeURIComponent(PIPELINE_ID)}/feedback`;
  return feedbackId ? `${base}/${encodeURIComponent(feedbackId)}` : base;
}

async function proxyFeedback(
  method: "POST" | "PATCH",
  body: JsonRecord,
  feedbackId?: string,
): Promise<Response> {
  let upstream: Response;

  try {
    upstream = await fetch(feedbackUrl(feedbackId), {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return Response.json(
      { error: "Could not reach Haystack feedback service." },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    return Response.json(
      { error: "Haystack feedback request failed." },
      { status: upstream.status || 502 },
    );
  }

  const payload = getRecord(await upstream.json().catch(() => ({})));
  const returnedFeedbackId = getText(payload.feedback_id);
  const score = getText(payload.score);

  if (!isUuid(returnedFeedbackId) || !isFeedbackScore(score)) {
    return Response.json(
      { error: "Haystack returned an invalid feedback response." },
      { status: 502 },
    );
  }

  return Response.json({ feedbackId: returnedFeedbackId, score });
}

export async function POST(request: NextRequest): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;

  const configurationError = getConfigurationError();
  if (configurationError) return configurationError;

  const body = await readBody(request);
  if (isResponse(body)) return body;

  const queryId = getText(body.queryId);
  const resultId = getText(body.resultId);
  const comment = getText(body.comment);

  if (!isUuid(queryId) || !isUuid(resultId) || !isFeedbackScore(body.score)) {
    return Response.json(
      { error: "queryId, resultId, and a valid score are required." },
      { status: 400 },
    );
  }

  return proxyFeedback("POST", {
    query_id: queryId,
    result_id: resultId,
    score: body.score,
    ...(comment ? { comment } : {}),
  });
}

export async function PATCH(request: NextRequest): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;

  const configurationError = getConfigurationError();
  if (configurationError) return configurationError;

  const body = await readBody(request);
  if (isResponse(body)) return body;

  const feedbackId = getText(body.feedbackId);
  const comment = getText(body.comment);

  if (!isUuid(feedbackId) || !isFeedbackScore(body.score)) {
    return Response.json(
      { error: "feedbackId and a valid score are required." },
      { status: 400 },
    );
  }

  return proxyFeedback(
    "PATCH",
    {
      score: body.score,
      ...(comment ? { comment } : {}),
    },
    feedbackId,
  );
}
