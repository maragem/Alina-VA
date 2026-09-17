"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthorityRank } from "@/lib/documentMetadata";
import { renumberCitationTokens } from "@/lib/haystackStreamPayload";
import { isEmptySource, type SourceItem } from "../sourceDocuments";
import {
  responseError,
  type ConversationAttachment,
  type ConversationDetailResponse,
  type ConversationSummary,
  type MessageAttachment,
  type PendingConversationAttachment,
} from "../conversationTypes";
import { useHaystackStream } from "./useHaystackStream";

type Role = "user" | "assistant";
export type AssistantMessageStatus =
  | "pending"
  | "streaming"
  | "complete"
  | "cancelled"
  | "error";

export type ChatMessage = Readonly<{
  id: string;
  role: Role;
  text: string;
  status?: AssistantMessageStatus;
  sources?: readonly SourceItem[];
  attachments?: readonly MessageAttachment[];
  feedback?: Readonly<{
    queryId: string;
    resultId: string;
  }>;
  persistedUserMessageId?: string;
  errorMessage?: string;
}>;

function uid(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

type UseChatOptions = Readonly<{
  initialConversationId?: string;
  initialProjectId?: string;
  onConversationUpsert: (conversation: ConversationSummary) => void;
}>;

function detailMessages(payload: ConversationDetailResponse): ChatMessage[] {
  const sources = new Map<string, SourceItem[]>();
  for (const source of payload.sources) {
    const item = source.sourceMetadata as SourceItem;
    if (isEmptySource(item)) continue;
    const normalizedItem: SourceItem = {
      ...item,
      citationNumbers:
        item.citationNumbers?.length
          ? item.citationNumbers
          : [source.citationOrder + 1],
    };
    const current = sources.get(source.messageId) ?? [];
    current.push(normalizedItem);
    sources.set(source.messageId, current);
  }
  const answered = new Set(
    payload.messages.flatMap((message) =>
      message.role === "assistant" && message.replyToMessageId
        ? [message.replyToMessageId]
        : [],
    ),
  );
  return payload.messages.flatMap((message): ChatMessage[] => {
    if (message.role === "user") {
      const userMessage: ChatMessage = {
        id: message.id,
        role: "user",
        text: message.content,
        attachments: message.attachments,
      };
      return answered.has(message.id)
        ? [userMessage]
        : [
            userMessage,
            {
              id: `retry-${message.id}`,
              role: "assistant",
              text: "",
              status: "cancelled",
              persistedUserMessageId: message.id,
            },
          ];
    }
    return [
      {
        id: message.id,
        role: "assistant",
        text: renumberCitationTokens(message.content),
        status: message.status,
        sources: sources.get(message.id),
        persistedUserMessageId: message.replyToMessageId ?? undefined,
        feedback:
          message.queryId && message.resultId
            ? { queryId: message.queryId, resultId: message.resultId }
            : undefined,
      },
    ];
  });
}

async function fetchConversation(id: string): Promise<ConversationDetailResponse> {
  const response = await fetch(`/api/conversations/${id}`, { cache: "no-store" });
  if (!response.ok) {
    throw await responseError(response, "Could not load the conversation.");
  }
  return (await response.json()) as ConversationDetailResponse;
}

async function fetchAttachments(
  id: string,
): Promise<readonly ConversationAttachment[]> {
  const response = await fetch(`/api/conversations/${id}/attachments`, {
    cache: "no-store",
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as {
    attachments: readonly ConversationAttachment[];
  };
  return payload.attachments;
}

export function useChat({
  initialConversationId,
  initialProjectId,
  onConversationUpsert,
}: UseChatOptions) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  const [activeConversationId, setActiveConversationId] =
    useState(initialConversationId);
  const [activeConversationTitle, setActiveConversationTitle] = useState("");
  const [activeProjectId, setActiveProjectId] = useState<string | undefined>(
    initialProjectId,
  );
  const [isLoadingConversation, setIsLoadingConversation] = useState(
    Boolean(initialConversationId),
  );
  const [conversationError, setConversationError] = useState<string>();
  const [selectedAuthorityRank, setSelectedAuthorityRank] =
    useState<AuthorityRank | null>(null);
  const [attachments, setAttachments] = useState<
    readonly ConversationAttachment[]
  >([]);
  const [pendingAttachments, setPendingAttachments] = useState<
    readonly { id: string; file: File }[]
  >([]);
  const [attachmentError, setAttachmentError] = useState<string>();
  const activeAssistantIdRef = useRef<string | null>(null);
  const conversationEpochRef = useRef(0);
  const routeSyncConversationIdRef = useRef<string | null>(null);
  const { isStreaming, status, activeToolName, stream, cancel } = useHaystackStream();
  const canSend =
    Boolean(draft.trim()) && !isStreaming && !isLoadingConversation;

  useEffect(() => {
    if (!initialConversationId) return;
    if (routeSyncConversationIdRef.current === initialConversationId) {
      routeSyncConversationIdRef.current = null;
      return;
    }
    let active = true;
    void fetchConversation(initialConversationId)
      .then((payload) => {
        if (!active) return;
        setMessages(detailMessages(payload));
        setActiveConversationTitle(payload.conversation.title);
        setActiveProjectId(payload.conversation.projectId ?? undefined);
        setConversationError(undefined);
      })
      .then(() => fetchAttachments(initialConversationId))
      .then((loaded) => {
        if (active) setAttachments(loaded);
      })
      .catch((error: unknown) => {
        if (active) {
          setConversationError(
            error instanceof Error
              ? error.message
              : "Could not load the conversation.",
          );
        }
      })
      .finally(() => {
        if (active) setIsLoadingConversation(false);
      });
    return () => {
      active = false;
    };
  }, [initialConversationId]);

  async function runRequest(
    assistantId: string,
    conversationId: string,
    userMessageId: string,
  ): Promise<void> {
    activeAssistantIdRef.current = assistantId;
    const epoch = conversationEpochRef.current;
    try {
      await stream(conversationId, userMessageId, selectedAuthorityRank, {
        onDelta(text) {
          if (epoch !== conversationEpochRef.current) return;
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    text: `${message.text}${text}`,
                    status: "streaming",
                  }
                : message,
            ),
          );
        },
        onResult(result) {
          if (epoch !== conversationEpochRef.current) return;
          setMessages((current) =>
            current.map((message) => {
              if (message.id !== assistantId) return message;
              const renumberedStreamed = renumberCitationTokens(message.text);
              const renumberedResult = renumberCitationTokens(result.text.trim());
              const answerText =
                renumberedResult &&
                (/\[\d+\]/.test(renumberedResult) || !/\[\d+\]/.test(renumberedStreamed))
                  ? renumberedResult
                  : renumberedStreamed || renumberedResult;

              return {
                ...message,
                text: answerText,
                sources: result.sources,
                feedback:
                  result.queryId && result.resultId
                    ? {
                        queryId: result.queryId,
                        resultId: result.resultId,
                      }
                    : undefined,
                status: "complete",
              };
            }),
          );
          if (activeConversationId === conversationId) {
            onConversationUpsert({
              id: conversationId,
              title: activeConversationTitle,
              projectId: activeProjectId ?? null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          }
        },
      });
      if (activeAssistantIdRef.current === assistantId) {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId &&
            (message.status === "pending" || message.status === "streaming")
              ? { ...message, status: "complete" }
              : message,
          ),
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unexpected error while streaming from Haystack.";

      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                status: "error",
                errorMessage,
              }
            : message,
        ),
      );
    } finally {
      if (activeAssistantIdRef.current === assistantId) {
        activeAssistantIdRef.current = null;
      }
    }
  }

  async function persistQuestion(
    question: string,
    queuedFiles: readonly File[],
  ): Promise<{
    conversationId: string;
    userMessageId: string;
  }> {
    let response: Response;
    if (activeConversationId) {
      response = await fetch(
        `/api/conversations/${activeConversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question }),
        },
      );
    } else if (queuedFiles.length > 0) {
      const formData = new FormData();
      formData.append("question", question);
      if (activeProjectId) formData.append("projectId", activeProjectId);
      for (const file of queuedFiles) formData.append("files", file);
      response = await fetch("/api/conversations", {
        method: "POST",
        body: formData,
      });
    } else {
      response = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          ...(activeProjectId ? { projectId: activeProjectId } : {}),
        }),
      });
    }
    if (!response.ok) {
      throw await responseError(response, "Could not save the question.");
    }
    const payload = (await response.json()) as {
      conversation?: ConversationSummary;
      attachments?: readonly ConversationAttachment[];
      message: { id: string };
    };
    const conversationId = activeConversationId ?? payload.conversation?.id;
    if (!conversationId)
      throw new Error("Conversation creation returned no ID.");
    if (payload.conversation) {
      setActiveConversationId(payload.conversation.id);
      setActiveConversationTitle(payload.conversation.title);
      onConversationUpsert(payload.conversation);
      routeSyncConversationIdRef.current = payload.conversation.id;
      router.replace(`/global?conversation=${payload.conversation.id}`, {
        scroll: false,
      });
    }
    if (payload.attachments && payload.attachments.length > 0) {
      const created = payload.attachments;
      setAttachments((current) => [...current, ...created]);
    }
    return { conversationId, userMessageId: payload.message.id };
  }

  async function sendMessage(): Promise<void> {
    if (!canSend) return;

    const question = draft.trim();
    const assistantId = uid("assistant");
    const queuedAttachments = pendingAttachments;
    setDraft("");
    setMessages((current) => [
      ...current,
      {
        id: uid("user"),
        role: "user",
        text: question,
        attachments: [
          ...attachments.map((attachment) => ({
            fileId: attachment.fileId,
            fileName: attachment.fileName,
          })),
          ...queuedAttachments.map((pending) => ({
            fileId: pending.id,
            fileName: pending.file.name,
          })),
        ],
      },
      {
        id: assistantId,
        role: "assistant",
        text: "",
        status: "pending",
      },
    ]);
    try {
      const persisted = await persistQuestion(
        question,
        queuedAttachments.map((pending) => pending.file),
      );
      if (queuedAttachments.length > 0) setPendingAttachments([]);
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? { ...message, persistedUserMessageId: persisted.userMessageId }
            : message,
        ),
      );
      await runRequest(
        assistantId,
        persisted.conversationId,
        persisted.userMessageId,
      );
    } catch (error) {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                status: "error",
                errorMessage:
                  error instanceof Error ? error.message : "Could not save the question.",
              }
            : message,
        ),
      );
    }
  }

  async function retryMessage(assistantId: string): Promise<void> {
    if (isStreaming) return;

    const assistantIndex = messages.findIndex(
      (message) => message.id === assistantId && message.role === "assistant",
    );
    const questionMessage = messages[assistantIndex - 1];
    if (assistantIndex < 1 || questionMessage?.role !== "user") return;

    setMessages((current) =>
      current.map((message) =>
        message.id === assistantId
          ? {
              id: message.id,
              role: "assistant",
              text: "",
              status: "pending",
              persistedUserMessageId: message.persistedUserMessageId,
            }
          : message,
      ),
    );
    let userMessageId = messages[assistantIndex]?.persistedUserMessageId;
    try {
      if (!userMessageId) {
        const persisted = await persistQuestion(questionMessage.text, []);
        userMessageId = persisted.userMessageId;
        if (!activeConversationId) {
          await runRequest(
            assistantId,
            persisted.conversationId,
            persisted.userMessageId,
          );
          return;
        }
      }
      if (!activeConversationId) return;
      await runRequest(assistantId, activeConversationId, userMessageId);
    } catch (error) {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                status: "error",
                errorMessage:
                  error instanceof Error ? error.message : "Could not retry the question.",
              }
            : message,
        ),
      );
    }
  }

  function stopResponse(): void {
    const assistantId = activeAssistantIdRef.current;
    if (!assistantId) return;

    activeAssistantIdRef.current = null;
    cancel();
    setMessages((current) =>
      current.map((message) =>
        message.id === assistantId
          ? { ...message, status: "cancelled" }
          : message,
      ),
    );
  }

  function resetConversation(projectId?: string): void {
    cancel();
    conversationEpochRef.current += 1;
    activeAssistantIdRef.current = null;
    setDraft("");
    setMessages([]);
    setActiveConversationId(undefined);
    setActiveConversationTitle("");
    setActiveProjectId(projectId);
    setConversationError(undefined);
    setSelectedAuthorityRank(null);
    setAttachments([]);
    setPendingAttachments([]);
    setAttachmentError(undefined);
    router.replace("/global", { scroll: false });
  }

  async function loadConversation(id: string): Promise<void> {
    if (id === activeConversationId || isStreaming) return;
    cancel();
    conversationEpochRef.current += 1;
    setIsLoadingConversation(true);
    setConversationError(undefined);
    try {
      const payload = await fetchConversation(id);
      setActiveConversationId(id);
      setActiveConversationTitle(payload.conversation.title);
      setActiveProjectId(payload.conversation.projectId ?? undefined);
      setMessages(detailMessages(payload));
      setDraft("");
      setSelectedAuthorityRank(null);
      setAttachments(await fetchAttachments(id));
      setAttachmentError(undefined);
      routeSyncConversationIdRef.current = id;
      router.replace(`/global?conversation=${id}`, { scroll: false });
    } catch (error) {
      setConversationError(
        error instanceof Error ? error.message : "Could not load the conversation.",
      );
    } finally {
      setIsLoadingConversation(false);
    }
  }

  function updateActiveConversationTitle(id: string, title: string): void {
    if (id === activeConversationId) setActiveConversationTitle(title);
  }

  async function uploadAttachmentForConversation(
    conversationId: string,
    file: File,
  ): Promise<boolean> {
    setAttachmentError(undefined);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const response = await fetch(
        `/api/conversations/${conversationId}/attachments`,
        { method: "POST", body: formData },
      );
      if (!response.ok) {
        throw await responseError(response, "Could not attach the file.");
      }
      const payload = (await response.json()) as {
        attachment: ConversationAttachment;
      };
      setAttachments((current) => [...current, payload.attachment]);
      return true;
    } catch (error) {
      setAttachmentError(
        error instanceof Error ? error.message : "Could not attach the file.",
      );
      return false;
    }
  }

  async function uploadAttachment(file: File): Promise<void> {
    if (!activeConversationId) {
      setPendingAttachments((current) => [
        ...current,
        { id: uid("pending-file"), file },
      ]);
      setAttachmentError(undefined);
      return;
    }
    await uploadAttachmentForConversation(activeConversationId, file);
  }

  async function removeAttachment(attachmentId: string): Promise<void> {
    if (
      pendingAttachments.some((attachment) => attachment.id === attachmentId)
    ) {
      setPendingAttachments((current) =>
        current.filter((attachment) => attachment.id !== attachmentId),
      );
      return;
    }
    if (!activeConversationId) return;
    const previous = attachments;
    setAttachments((current) =>
      current.filter((attachment) => attachment.id !== attachmentId),
    );
    try {
      const response = await fetch(
        `/api/conversations/${activeConversationId}/attachments/${attachmentId}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        throw await responseError(response, "Could not remove the attachment.");
      }
    } catch (error) {
      setAttachments(previous);
      setAttachmentError(
        error instanceof Error
          ? error.message
          : "Could not remove the attachment.",
      );
    }
  }

  return {
    activeConversationId,
    activeProjectId,
    activeConversationTitle,
    activeToolName,
    attachments,
    pendingAttachments: pendingAttachments.map<PendingConversationAttachment>(
      (pending) => ({
        id: pending.id,
        fileName: pending.file.name,
        sizeBytes: pending.file.size,
      }),
    ),
    attachmentError,
    canSend,
    cancelStream: cancel,
    draft,
    conversationError,
    isStreaming,
    isLoadingConversation,
    loadConversation,
    messages,
    removeAttachment,
    resetConversation,
    retryMessage,
    selectedAuthorityRank,
    sendMessage,
    setDraft,
    setSelectedAuthorityRank,
    status,
    stopResponse,
    updateActiveConversationTitle,
    uploadAttachment,
  };
}
