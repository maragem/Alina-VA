import { apiError } from "@/lib/apiError";

export type ConversationSummary = Readonly<{
  id: string;
  title: string;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type ConversationAttachment = Readonly<{
  id: string;
  fileId: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
}>;

export type PendingConversationAttachment = Readonly<{
  id: string;
  fileName: string;
  sizeBytes: number;
}>;

export type MessageAttachment = Readonly<{
  fileId: string;
  fileName: string;
}>;

export type ConversationApiMessage = Readonly<{
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "pending" | "complete" | "cancelled" | "error";
  replyToMessageId: string | null;
  queryId: string | null;
  resultId: string | null;
  attachments?: readonly MessageAttachment[];
  createdAt: string;
}>;

export type ConversationDetailResponse = Readonly<{
  conversation: ConversationSummary;
  messages: readonly ConversationApiMessage[];
  sources: readonly Readonly<{
    messageId: string;
    citationOrder: number;
    sourceMetadata: unknown;
  }>[];
}>;

export async function responseError(
  response: Response,
  fallback: string,
): Promise<Error> {
  return apiError(response, fallback);
}