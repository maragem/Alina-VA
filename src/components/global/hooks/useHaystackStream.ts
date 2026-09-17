"use client";

import { useRef, useState } from "react";
import type { AuthorityRank } from "@/lib/documentMetadata";
import {
  extractHaystackResult,
  renumberCitationTokens,
} from "@/lib/haystackStreamPayload";
import type { SourceItem } from "../sourceDocuments";

export const CHAT_STATUS = {
  idle: "Idle",
  connecting: "Connecting to Haystack...",
  tool_calling: "Calling tool...",
  tool_called: "Processing results...",
  reasoning: "Analysing...",
  streaming: "Streaming response...",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
} as const;

export type ChatStatus = (typeof CHAT_STATUS)[keyof typeof CHAT_STATUS];

export type StreamResult = Readonly<{
  text: string;
  sources: readonly SourceItem[];
  queryId?: string;
  resultId?: string;
}>;

export type CollectedStreamResult = StreamResult &
  Readonly<{
    searchSessionId?: string;
  }>;

type StreamHandlers = Readonly<{
  onDelta: (text: string) => void;
  onResult: (result: StreamResult) => void;
  onToolCall?: (toolName: string | null) => void;
}>;

type JsonRecord = Record<string, unknown>;

type DeltaEvent = Readonly<{
  type: "delta";
  delta: Readonly<{ text: string }>;
  finishReason?: string;
}>;

type ResultEvent = Readonly<{
  type: "result";
  result: unknown;
  queryId?: string;
  finishReason?: string;
}>;

type ErrorEvent = Readonly<{
  type: "error";
  error?: string;
  finishReason?: string;
}>;

type ToolCallDeltaEvent = Readonly<{
  type: "tool_call_delta";
  toolName: string | null;
  start: boolean;
}>;

type ToolCallResultEvent = Readonly<{
  type: "tool_call_result";
}>;

type ReasoningEvent = Readonly<{
  type: "reasoning";
  start: boolean;
}>;

type StreamEvent = DeltaEvent | ResultEvent | ErrorEvent | ToolCallDeltaEvent | ToolCallResultEvent | ReasoningEvent;

// Backstops the server-side watchdog in case the connection itself hangs without erroring.
const STREAM_IDLE_TIMEOUT_MS = 100_000;

function readWithTimeout<T>(
  reader: ReadableStreamDefaultReader<T>,
  timeoutMs: number,
): Promise<ReadableStreamReadResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("Haystack stopped responding. Please retry.")),
      timeoutMs,
    );
  });
  return Promise.race([reader.read(), timeout]).finally(() =>
    clearTimeout(timer),
  );
}

function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getRecord(value: unknown): JsonRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return {};
}

function takeCompleteSseBlocks(
  buffer: string,
  done: boolean,
): { blocks: string[]; remainder: string } {
  const normalized = buffer.replaceAll("\r\n", "\n");
  const lastBoundary = normalized.lastIndexOf("\n\n");

  if (lastBoundary === -1) {
    return done
      ? { blocks: normalized.trim() ? [normalized] : [], remainder: "" }
      : { blocks: [], remainder: normalized };
  }

  const completePart = normalized.slice(0, lastBoundary);
  const remainder = normalized.slice(lastBoundary + 2);
  const blocks = completePart
    .split("\n\n")
    .filter((block) => block.trim().length > 0);
  if (done && remainder.trim()) blocks.push(remainder);
  return { blocks, remainder: done ? "" : remainder };
}

function parseEvent(block: string): StreamEvent | undefined {
  const dataLines = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  if (dataLines.length === 0) return undefined;

  try {
    const value: unknown = JSON.parse(dataLines.join("\n"));
    const event = getRecord(value);

    if (event.type === "delta") {
      const text = asText(getRecord(event.delta).text);
      return text
        ? {
            type: "delta",
            delta: { text },
            finishReason: trimText(event.finish_reason) || undefined,
          }
        : undefined;
    }

    if (event.type === "result" && "result" in event) {
      return {
        type: "result",
        result: event.result,
        queryId: trimText(event.query_id) || undefined,
        finishReason: trimText(event.finish_reason) || undefined,
      };
    }

    if (event.type === "tool_call_delta") {
      const delta = getRecord(event.tool_call_delta);
      return {
        type: "tool_call_delta",
        toolName: asText(delta.tool_name) || null,
        start: event.start === true,
      };
    }

    if (event.type === "tool_call_result") {
      return { type: "tool_call_result" };
    }

    if (event.type === "reasoning") {
      return { type: "reasoning", start: event.start === true };
    }

    if (event.type === "error") {
      const error = asText(event.error);
      const finishReason = trimText(event.finish_reason) || undefined;
      return error
        ? { type: "error", error, finishReason }
        : { type: "error", finishReason };
    }

    return undefined;
  } catch {
    return undefined;
  }
}

export async function collectHaystackStream(
  url: string,
  query: string,
  signal?: AbortSignal,
): Promise<CollectedStreamResult> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, includeResult: true }),
    signal,
  });

  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      details?: string;
    };
    throw new Error(
      trimText(payload.error) || trimText(payload.details) || "Request failed.",
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamedText = "";
  let result: StreamResult = { text: "", sources: [] };
  let done = false;

  while (!done) {
    const read = await readWithTimeout(reader, STREAM_IDLE_TIMEOUT_MS);
    done = read.done;
    buffer += decoder.decode(read.value ?? new Uint8Array(), { stream: !done });
    const parsed = takeCompleteSseBlocks(buffer, done);
    buffer = parsed.remainder;

    for (const block of parsed.blocks) {
      const event = parseEvent(block);
      if (!event) continue;

      if (event.type === "delta") {
        streamedText += event.delta.text;
      } else if (event.type === "result") {
        const extracted = extractHaystackResult(event.result);
        result = {
          text: extracted.text,
          sources: extracted.sources.map((source) => source.item),
          queryId: event.queryId,
          resultId: extracted.resultId ?? undefined,
        };
      } else if (event.type === "error") {
        throw new Error(
          trimText(event.error) || "Haystack returned an error event.",
        );
      }

      if (event.type === "result") {
        done = true;
        void reader.cancel();
        break;
      }
    }
  }

  const renumberedStreamed = renumberCitationTokens(streamedText.trim());
  const renumberedResult = renumberCitationTokens(result.text.trim());
  const finalText =
    renumberedResult &&
    (/\[\d+\]/.test(renumberedResult) || !/\[\d+\]/.test(renumberedStreamed))
      ? renumberedResult
      : renumberedStreamed || renumberedResult;

  return {
    ...result,
    text: finalText,
    searchSessionId:
      response.headers.get("X-Haystack-Search-Session-Id") ?? undefined,
  };
}

export function useHaystackStream() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [status, setStatus] = useState<ChatStatus>(CHAT_STATUS.idle);
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function stream(
    conversationId: string,
    userMessageId: string,
    authorityRank: AuthorityRank | null,
    handlers: StreamHandlers,
  ): Promise<void> {
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus(CHAT_STATUS.connecting);
    setIsStreaming(true);

    try {
      const response = await fetch("/api/haystack/search-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          userMessageId,
          ...(authorityRank === null ? {} : { authorityRank }),
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          details?: string;
        };
        throw new Error(
          trimText(payload.error) ||
            trimText(payload.details) ||
            "Request failed.",
        );
      }

      setStatus(CHAT_STATUS.connecting);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;
      let receivedContent = false;

      while (!done) {
        const read = await readWithTimeout(reader, STREAM_IDLE_TIMEOUT_MS);
        done = read.done;
        buffer += decoder.decode(read.value ?? new Uint8Array(), {
          stream: !done,
        });
        const parsed = takeCompleteSseBlocks(buffer, done);
        buffer = parsed.remainder;

        for (const block of parsed.blocks) {
          const event = parseEvent(block);
          if (!event) continue;

          if (event.type === "delta") {
            receivedContent = true;
            setStatus(CHAT_STATUS.streaming);
            handlers.onDelta(event.delta.text);
          } else if (event.type === "tool_call_delta" && event.start) {
            setStatus(CHAT_STATUS.tool_calling);
            setActiveToolName(event.toolName);
            handlers.onToolCall?.(event.toolName);
          } else if (event.type === "tool_call_result") {
            setStatus(CHAT_STATUS.tool_called);
            setActiveToolName(null);
          } else if (event.type === "reasoning" && event.start) {
            setStatus(CHAT_STATUS.reasoning);
          } else if (event.type === "result") {
            const extracted = extractHaystackResult(event.result);
            receivedContent = receivedContent || Boolean(extracted.text);
            handlers.onResult({
              text: extracted.text,
              sources: extracted.sources.map((source) => source.item),
              queryId: event.queryId,
              resultId: extracted.resultId ?? undefined,
            });
          } else if (event.type === "error") {
            throw new Error(
              trimText(event.error) || "Haystack returned an error event.",
            );
          }

          if (event.type === "result") {
            done = true;
            void reader.cancel();
            break;
          }
        }
      }

      if (!receivedContent) {
        throw new Error("Haystack returned an empty response.");
      }
      setStatus(CHAT_STATUS.done);
    } catch (error) {
      if (controller.signal.aborted) return;
      controller.abort();
      setStatus(CHAT_STATUS.failed);
      throw error;
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsStreaming(false);
    }
  }

  function cancel(): void {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setStatus(CHAT_STATUS.cancelled);
  }

  return { isStreaming, status, activeToolName, stream, cancel };
}
