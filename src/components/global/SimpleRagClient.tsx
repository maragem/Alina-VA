"use client";

import { JSX, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  FileSearch,
  Scale,
  SearchCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatComposer } from "./ChatComposer";
import { ChatMessage } from "./ChatMessage";
import { ConversationHistory } from "./ConversationHistory";
import { useChat } from "./hooks/useChat";
import { useConversationHistory } from "./hooks/useConversationHistory";
import type { ProjectSummary } from "@/components/projects/projectTypes";

const SUGGESTED_PROMPTS = [
  {
    icon: SearchCheck,
    label: "Compare award criteria",
    prompt:
      "Compare the award criteria described across the relevant procurement documents.",
  },
  {
    icon: Scale,
    label: "Find contractual obligations",
    prompt:
      "What are the main contractual obligations, deadlines, and penalties mentioned in the indexed documents?",
  },
  {
    icon: FileSearch,
    label: "Summarise a procedure",
    prompt:
      "Summarise the procurement procedure, including its scope, timeline, and eligibility requirements.",
  },
] as const;

type SimpleRagClientProps = Readonly<{
  initialConversationId?: string;
  initialProjectId?: string;
}>;

export function SimpleRagClient({
  initialConversationId,
  initialProjectId,
}: SimpleRagClientProps): JSX.Element {
  const history = useConversationHistory();
  const {
    activeConversationId,
    activeProjectId,
    activeToolName,
    attachments,
    attachmentError,
    canSend,
    conversationError,
    draft,
    isStreaming,
    isLoadingConversation,
    loadConversation,
    messages,
    pendingAttachments,
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
  } = useChat({
    initialConversationId,
    initialProjectId,
    onConversationUpsert: history.upsertConversation,
  });
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const wasStreamingRef = useRef(false);
  const isFollowingRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);

  useEffect(() => {
    let active = true;
    void fetch("/api/projects", { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ projects: ProjectSummary[] }> : { projects: [] })
      .then((payload) => {
        if (active) setProjects(payload.projects);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!isFollowingRef.current) return;
    const frame = requestAnimationFrame(() => {
      const transcript = transcriptRef.current;
      if (!transcript) return;
      transcript.scrollTop = transcript.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, isStreaming]);

  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      textareaRef.current?.focus();
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  function handleTranscriptScroll(): void {
    const transcript = transcriptRef.current;
    if (!transcript) return;

    const distanceFromBottom =
      transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
    const isNearBottom = distanceFromBottom < 96;
    isFollowingRef.current = isNearBottom;
    setShowScrollButton(!isNearBottom);
  }

  function scrollToLatest(): void {
    isFollowingRef.current = true;
    setShowScrollButton(false);
    const transcript = transcriptRef.current;
    if (!transcript) return;
    transcript.scrollTo({
      top: transcript.scrollHeight,
      behavior: "smooth",
    });
  }

  function chooseSuggestion(prompt: string): void {
    setDraft(prompt);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 192)}px`;
      textarea.setSelectionRange(prompt.length, prompt.length);
    });
  }

  function startNewConversation(): void {
    resetConversation(activeProjectId);
    setHistoryOpen(false);
    isFollowingRef.current = true;
    setShowScrollButton(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function changeScope(projectId: string): void {
    resetConversation(projectId || undefined);
    setHistoryOpen(false);
    isFollowingRef.current = true;
    setShowScrollButton(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function openConversation(id: string): void {
    setHistoryOpen(false);
    isFollowingRef.current = true;
    setShowScrollButton(false);
    void loadConversation(id);
  }

  async function renameConversation(id: string, title: string): Promise<void> {
    await history.renameConversation(id, title);
    updateActiveConversationTitle(id, title);
  }

  async function deleteConversation(id: string): Promise<void> {
    await history.deleteConversation(id);
    if (id === activeConversationId) startNewConversation();
  }

  return (
    <section
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-white"
      aria-label="ALINA global assistant"
    >
      <div className="flex min-h-0 flex-1">
        <ConversationHistory
          activeConversationId={activeConversationId}
          activeProjectId={activeProjectId}
          conversations={history.conversations}
          disabled={isStreaming}
          error={history.error}
          projects={projects}
          hasMore={history.hasMore}
          isLoading={history.isLoading}
          isLoadingMore={history.isLoadingMore}
          mobileOpen={historyOpen}
          onCloseMobile={() => setHistoryOpen(false)}
          onDelete={deleteConversation}
          onLoadMore={history.loadMore}
          onNew={startNewConversation}
          onOpen={openConversation}
          onRename={renameConversation}
          onScopeChange={changeScope}
          searchQuery={history.searchQuery}
          onSearchChange={history.setSearchQuery}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[linear-gradient(to_bottom,#f8fafc_0,#fff_11rem)]">
            <div
              ref={transcriptRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
              onScroll={handleTranscriptScroll}
            >
              {isLoadingConversation ? (
                <div className="flex min-h-full items-center justify-center text-sm text-slate-500">
                  Loading conversation…
                </div>
              ) : messages.length === 0 ? (
                <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-4 py-8 sm:px-6 sm:py-10">
                  <div className="max-w-xl">
                    <span className="flex size-11 items-center justify-center rounded-sm bg-(--ec-yellow) font-serif text-xl font-bold text-(--ec-blue)">
                      A
                    </span>
                    <h3 className="mt-4 font-serif text-2xl font-bold text-(--ec-blue) sm:mt-5 sm:text-3xl">
                      What would you like to examine?
                    </h3>
                    <p className="mt-3 text-base leading-7 text-slate-600">
                      Ask a question and ALINA will answer from the indexed
                      documents, with source references for verification.
                    </p>
                  </div>

                  <div
                    className="mt-6 flex snap-x gap-2 overflow-x-auto pb-2 sm:mt-7 sm:grid sm:grid-cols-3 sm:overflow-visible sm:pb-0"
                    aria-label="Suggested questions"
                  >
                    {SUGGESTED_PROMPTS.map(({ icon: Icon, label, prompt }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => chooseSuggestion(prompt)}
                        className="group flex min-h-16 w-60 shrink-0 snap-start items-center gap-3 border border-slate-200 bg-white p-3 text-left transition-colors hover:border-(--ec-blue) hover:bg-blue-50/40 sm:block sm:min-h-24 sm:w-auto sm:p-3.5"
                      >
                        <Icon
                          className="size-5 text-(--ec-blue)"
                          aria-hidden="true"
                        />
                        <span className="block text-sm font-semibold leading-5 text-slate-900 group-hover:text-(--ec-blue) sm:mt-3">
                          {label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div
                  className="mx-auto w-full max-w-5xl space-y-8 px-4 pt-8 pb-4 sm:px-6 sm:pt-10 sm:pb-6"
                  role="log"
                  aria-live="polite"
                  aria-busy={isStreaming}
                  aria-label="Conversation"
                >
                  {messages.map((message) => (
                    <ChatMessage
                      key={message.id}
                      message={message}
                      activeToolName={activeToolName}
                      streamStatus={status}
                      onRetry={(messageId) => void retryMessage(messageId)}
                    />
                  ))}
                </div>
              )}
            </div>

            {showScrollButton ? (
              <Button
                variant="outline"
                size="icon"
                onClick={scrollToLatest}
                aria-label="Scroll to latest message"
                title="Scroll to latest"
                className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-white shadow-md animate-fade-in"
              >
                <ArrowDown className="size-4" aria-hidden="true" />
              </Button>
            ) : null}
          </div>

          {conversationError ? (
            <p
              className="border-t border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700"
              role="alert"
            >
              {conversationError}
            </p>
          ) : null}
          <footer className="border-t border-(--ec-line) bg-white px-4 py-2 sm:px-5 sm:py-3">
            <ChatComposer
              attachments={[...attachments, ...pendingAttachments]}
              attachmentError={attachmentError}
              canSend={canSend}
              draft={draft}
              isStreaming={isStreaming}
              selectedAuthorityRank={selectedAuthorityRank}
              textareaRef={textareaRef}
              onAttachFiles={(files) => {
                for (const file of Array.from(files)) void uploadAttachment(file);
              }}
              onAuthorityRankChange={setSelectedAuthorityRank}
              onDraftChange={setDraft}
              onRemoveAttachment={(id) => void removeAttachment(id)}
              onSend={() => void sendMessage()}
              onStop={stopResponse}
            />
          </footer>
        </div>
      </div>
    </section>
  );
}