import { NextRequest } from "next/server";
import {
  finalizeAssistantMessage,
  getMessageStreamContext,
} from "@/db/repositories/conversations";
import { getProjectAccess } from "@/db/repositories/projects";
import { isUuid } from "@/lib/conversations";
import { requireAppUser } from "@/lib/currentUser";
import { isAuthorityRank } from "@/lib/documentMetadata";
import {
  getHaystackApiKey,
  getHaystackPipeline,
  getHaystackWorkspace,
} from "@/lib/haystackConfig";
import { buildHaystackDocumentFilter } from "@/lib/haystackAccessMetadata";
import { configuredHaystackPipelineId } from "@/lib/haystackSearchSessions";
import {
  extractHaystackResult,
  parseHaystackDeltaText,
  parseHaystackResultEvent,
  renumberCitationTokens,
} from "@/lib/haystackStreamPayload";

type SearchStreamRequest = {
  conversationId?: unknown;
  userMessageId?: unknown;
  authorityRank?: unknown;
};

const WORKSPACE = getHaystackWorkspace();
const PIPELINE = getHaystackPipeline();
const API_KEY = getHaystackApiKey();
const HAYSTACK_ATTEMPTS = 2;
// Haystack occasionally stops emitting bytes mid-stream with no error/close; without a watchdog
// the client's "Connecting..." state would spin forever.
const STREAM_IDLE_TIMEOUT_MS = 90_000;

/** Re-chunks a stream, erroring it out if no bytes arrive for `timeoutMs`. */
function withIdleTimeout(
  stream: ReadableStream<Uint8Array>,
  timeoutMs: number,
  onTimeout: () => void,
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout();
          reject(new Error("Haystack stopped responding. Please retry."));
        }, timeoutMs);
      });
      try {
        const { done, value } = await Promise.race([reader.read(), timeout]);
        clearTimeout(timer);
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        clearTimeout(timer);
        controller.error(error);
        void reader.cancel().catch(() => {});
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;
  const body = (await request
    .json()
    .catch(() => null)) as SearchStreamRequest | null;
  if (
    !body ||
    !isUuid(body.conversationId) ||
    !isUuid(body.userMessageId) ||
    (body.authorityRank !== undefined && !isAuthorityRank(body.authorityRank))
  ) {
    return Response.json({ error: "Invalid stream request." }, { status: 400 });
  }
  if (!API_KEY || !WORKSPACE || !PIPELINE) {
    return Response.json(
      { error: "Haystack configuration is incomplete." },
      { status: 500 },
    );
  }
  const conversationId = body.conversationId;
  const userMessageId = body.userMessageId;

  const context = await getMessageStreamContext(
    user.id,
    conversationId,
    userMessageId,
  );
  if (!context) {
    return Response.json(
      { error: "Conversation message not found." },
      { status: 404 },
    );
  }
  if (context.alreadyAnswered) {
    return Response.json(
      { error: "This message already has a response." },
      { status: 409 },
    );
  }
  if (context.pipelineId !== configuredHaystackPipelineId()) {
    return Response.json(
      { error: "This conversation belongs to a different Haystack pipeline." },
      { status: 409 },
    );
  }
  const streamContext = context;
  if (streamContext.projectId) {
    const access = await getProjectAccess(user.id, streamContext.projectId);
    if (!access) {
      return Response.json({ error: "Project not found." }, { status: 404 });
    }
  }

  // `files` carries the conversation's active drag-and-drop attachments (deepset temporary file
  // IDs); consumed by the v0.9 pipeline attachment_input/attachment_converter branch.
  const upstreamUrl =
    `https://api.cloud.deepset.ai/api/v1/workspaces/${encodeURIComponent(WORKSPACE)}` +
    `/pipelines/${encodeURIComponent(PIPELINE)}/chat-stream`;
  const upstreamBody = JSON.stringify({
    query: streamContext.question,
    search_session_id: streamContext.searchSessionId,
    chat_history_limit: 20,
    include_result: true,
    include_tool_calls: true,
    include_tool_call_results: true,
    include_reasoning: true,
    filters: buildHaystackDocumentFilter({
      projectId: streamContext.projectId ?? undefined,
      authorityRank: body.authorityRank,
    }),
    files: streamContext.attachmentFileIds,
  });
  let upstream: Response | null = null;
  let upstreamStream: ReadableStream<Uint8Array> | null = null;
  // Independent from `request.signal` so a stall can be aborted without the client disconnecting.
  const upstreamController = new AbortController();
  request.signal.addEventListener("abort", () => upstreamController.abort());

  for (let attempt = 0; attempt < HAYSTACK_ATTEMPTS; attempt += 1) {
    try {
      const candidate = await fetch(upstreamUrl, {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: upstreamBody,
        signal: upstreamController.signal,
        cache: "no-store",
      });
      upstream = candidate;
      if (!candidate.ok || !candidate.body) {
        if (candidate.status >= 500 && attempt + 1 < HAYSTACK_ATTEMPTS)
          continue;
        break;
      }

      upstreamStream = withIdleTimeout(candidate.body, STREAM_IDLE_TIMEOUT_MS, () =>
        upstreamController.abort(),
      );
      break;
    } catch {
      if (request.signal.aborted || attempt + 1 === HAYSTACK_ATTEMPTS) break;
    }
  }

  if (!upstream?.ok || !upstreamStream) {
    return Response.json(
      {
        error: "Haystack did not return a response. Please retry.",
        status: upstream?.status,
      },
      { status: upstream?.ok ? 502 : upstream?.status || 502 },
    );
  }

  const assistantMessageId = crypto.randomUUID();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  function encodeErrorEvent(message: string): Uint8Array {
    return encoder.encode(
      `data: ${JSON.stringify({ type: "error", error: message })}\n\n`,
    );
  }
  let buffer = "";
  let finalized = false;
  let streamedText = "";

  async function finalizeBlock(block: string): Promise<void> {
    const event = parseHaystackResultEvent(block);
    if (!event || finalized) return;
    const result = extractHaystackResult(event.result);
    const streamedAnswer = streamedText.trim();
    const renumberedStreamed = renumberCitationTokens(streamedAnswer);
    const renumberedResult = renumberCitationTokens(result.text.trim());
    const answerText =
      renumberedResult &&
      (/\[\d+\]/.test(renumberedResult) || !/\[\d+\]/.test(renumberedStreamed))
        ? renumberedResult
        : renumberedStreamed || renumberedResult;
    if (!answerText) {
      throw new Error("Haystack result did not contain an answer.");
    }
    const inserted = await finalizeAssistantMessage({
      id: assistantMessageId,
      conversationId: streamContext.conversationId,
      userMessageId,
      content: answerText,
      queryId: event.queryId,
      resultId: result.resultId,
      sources: result.sources,
    });
    if (!inserted) throw new Error("The response was already persisted.");
    finalized = true;
  }

  async function finalizeStreamedAnswer(): Promise<void> {
    if (finalized) return;
    const answerText = renumberCitationTokens(streamedText.trim());
    if (!answerText) {
      throw new Error("Haystack stream did not contain an answer.");
    }
    const inserted = await finalizeAssistantMessage({
      id: assistantMessageId,
      conversationId: streamContext.conversationId,
      userMessageId,
      content: answerText,
      queryId: null,
      resultId: null,
      sources: [],
    });
    if (!inserted) throw new Error("The response was already persisted.");
    finalized = true;
  }

  const transformer = new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      buffer = buffer.replaceAll("\r\n", "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        streamedText += parseHaystackDeltaText(block);
        try {
          await finalizeBlock(block);
        } catch (error) {
          controller.enqueue(
            encodeErrorEvent(
              error instanceof Error
                ? error.message
                : "Could not persist the assistant response.",
            ),
          );
        }
        controller.enqueue(encoder.encode(`${block}\n\n`));
        boundary = buffer.indexOf("\n\n");
      }
    },
    async flush(controller) {
      buffer = `${buffer}${decoder.decode()}`.replaceAll("\r\n", "\n");
      if (buffer) {
        streamedText += parseHaystackDeltaText(buffer);
        try {
          await finalizeBlock(buffer);
        } catch (error) {
          controller.enqueue(
            encodeErrorEvent(
              error instanceof Error
                ? error.message
                : "Could not persist the assistant response.",
            ),
          );
        }
        controller.enqueue(encoder.encode(buffer));
      }
      try {
        await finalizeStreamedAnswer();
      } catch (error) {
        controller.enqueue(
          encodeErrorEvent(
            error instanceof Error
              ? error.message
              : "Haystack returned an invalid response.",
          ),
        );
      }
    },
  });

  return new Response(upstreamStream.pipeThrough(transformer), {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-ALINA-Assistant-Message-Id": assistantMessageId,
    },
  });
}
