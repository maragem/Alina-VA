"use client";

import { useRef, useState } from "react";
import type { DragEvent, FormEvent, KeyboardEvent, RefObject } from "react";
import { Paperclip, Send, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FileTypeIcon } from "@/components/FileTypeIcon";
import {
  AUTHORITY_CATEGORIES,
  type AuthorityRank,
} from "@/lib/documentMetadata";
import type {
  ConversationAttachment,
  PendingConversationAttachment,
} from "./conversationTypes";

const AUTHORITY_RANKS = [1, 2, 3, 4] as const;

function authorityRankTitle(rank: AuthorityRank): string {
  const categories = AUTHORITY_CATEGORIES.filter(
    (category) => category.rank === rank,
  ).map((category) => category.label);
  return `Rank ${rank}: ${categories.join(", ")}`;
}

type ChatComposerProps = {
  attachments: readonly (ConversationAttachment | PendingConversationAttachment)[];
  attachmentError?: string;
  canSend: boolean;
  draft: string;
  isStreaming: boolean;
  selectedAuthorityRank: AuthorityRank | null;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onAttachFiles: (files: FileList | File[]) => void;
  onAuthorityRankChange: (rank: AuthorityRank | null) => void;
  onDraftChange: (draft: string) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onSend: () => void;
  onStop: () => void;
};

export function ChatComposer({
  attachments,
  attachmentError,
  canSend,
  draft,
  isStreaming,
  selectedAuthorityRank,
  textareaRef,
  onAttachFiles,
  onAuthorityRankChange,
  onDraftChange,
  onRemoveAttachment,
  onSend,
  onStop,
}: ChatComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  function resizeTextarea(textarea: HTMLTextAreaElement): void {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 192)}px`;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (canSend) {
      onSend();
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    event.preventDefault();
    if (canSend) {
      onSend();
      event.currentTarget.style.height = "auto";
    }
  }

  function handleDragOver(event: DragEvent<HTMLFormElement>): void {
    event.preventDefault();
    setIsDraggingOver(true);
  }

  function handleDragLeave(event: DragEvent<HTMLFormElement>): void {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setIsDraggingOver(false);
  }

  function handleDrop(event: DragEvent<HTMLFormElement>): void {
    event.preventDefault();
    setIsDraggingOver(false);
    if (event.dataTransfer.files.length === 0) return;
    onAttachFiles(event.dataTransfer.files);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto w-full max-w-4xl"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <fieldset
        disabled={isStreaming}
        className="mb-1.5 flex flex-wrap items-center gap-2 px-1"
      >
        <legend className="sr-only">Filter sources by authority rank</legend>
        <span
          className="text-xs font-semibold uppercase tracking-wide text-(--ec-mute)"
          aria-hidden="true"
        >
          Authority
        </span>
        <div
          className="inline-flex overflow-hidden rounded-sm border border-(--ec-line) bg-white"
          aria-label="Authority rank"
        >
          <button
            type="button"
            aria-pressed={selectedAuthorityRank === null}
            title="Search all authority ranks"
            onClick={() => onAuthorityRankChange(null)}
            className={`h-8 w-12 border-r border-(--ec-line) text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              selectedAuthorityRank === null
                ? "bg-(--ec-blue) text-white"
                : "bg-white text-(--ec-ink) hover:bg-slate-100"
            }`}
          >
            All
          </button>
          {AUTHORITY_RANKS.map((rank) => (
            <button
              key={rank}
              type="button"
              aria-label={`Authority rank ${rank}`}
              aria-pressed={selectedAuthorityRank === rank}
              title={authorityRankTitle(rank)}
              onClick={() => onAuthorityRankChange(rank)}
              className={`h-8 w-9 border-r border-(--ec-line) text-xs font-semibold transition-colors last:border-r-0 disabled:cursor-not-allowed disabled:opacity-50 ${
                selectedAuthorityRank === rank
                  ? "bg-(--ec-blue) text-white"
                  : "bg-white text-(--ec-ink) hover:bg-slate-100"
              }`}
            >
              {rank}
            </button>
          ))}
        </div>
      </fieldset>

      {attachments.length > 0 ? (
        <ul className="mb-1.5 flex flex-wrap gap-1.5 px-1" aria-label="Attached files">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="inline-flex max-w-56 items-center gap-1 rounded-sm border border-(--ec-line) bg-slate-50 px-2 py-1 text-xs text-(--ec-ink)"
            >
              <FileTypeIcon
                fileName={attachment.fileName}
                className="size-3 shrink-0"
              />
              <span className="truncate">{attachment.fileName}</span>
              <button
                type="button"
                onClick={() => onRemoveAttachment(attachment.id)}
                aria-label={`Remove ${attachment.fileName}`}
                title="Remove attachment"
                className="shrink-0 rounded-full p-0.5 text-slate-500 hover:bg-slate-200 hover:text-(--ec-ink)"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {attachmentError ? (
        <p className="mb-1.5 px-1 text-xs text-red-700" role="alert">
          {attachmentError}
        </p>
      ) : null}

      <div
        className={`flex items-end gap-2 rounded-md border bg-white px-2 py-2 shadow-[0_8px_24px_rgba(15,23,42,0.10)] transition-[border-color,box-shadow] duration-150 focus-within:border-(--ec-blue) focus-within:shadow-[0_0_0_2px_rgba(255,204,0,0.45),0_10px_28px_rgba(15,23,42,0.12)] ${
          isDraggingOver ? "border-(--ec-blue) bg-blue-50" : "border-(--ec-line)"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files?.length) onAttachFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach a file"
          title="Attach a file"
          className="h-10 w-10 shrink-0 self-end rounded-sm"
        >
          <Paperclip className="size-4" aria-hidden="true" />
        </Button>
        <label htmlFor="chat-question" className="sr-only">
          Ask ALINA a question
        </label>
        <Textarea
          ref={textareaRef}
          id="chat-question"
          value={draft}
          rows={1}
          disabled={isStreaming}
          placeholder="Ask about contracts, procedures, suppliers, or your indexed documents"
          className="max-h-48 min-h-10 flex-1 border-0 bg-transparent px-2 py-2 text-[15px] leading-6 shadow-none focus-visible:outline-none focus-visible:ring-0"
          onChange={(event) => {
            onDraftChange(event.target.value);
            resizeTextarea(event.target);
          }}
          onKeyDown={handleKeyDown}
        />
        {isStreaming ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onStop}
            aria-label="Stop generating response"
            title="Stop response"
            className="h-10 w-10 shrink-0 self-end rounded-sm border-rose-200 text-rose-700 hover:bg-rose-50"
          >
            <Square className="size-4 fill-current" aria-hidden="true" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            disabled={!canSend}
            aria-label="Send message"
            title="Send message"
            className="h-10 w-10 shrink-0 self-end rounded-sm"
          >
            <Send className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </form>
  );
}