"use client";

import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, Pencil, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import type { ConversationSummary } from "./conversationTypes";
import type { ProjectSummary } from "@/components/projects/projectTypes";

type ConversationHistoryProps = Readonly<{
  activeConversationId?: string;
  conversations: readonly ConversationSummary[];
  disabled: boolean;
  error?: string;
  activeProjectId?: string;
  projects: readonly ProjectSummary[];
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onDelete: (id: string) => Promise<void>;
  onLoadMore: () => Promise<void>;
  onNew: () => void;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onScopeChange: (projectId: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}>;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function ConversationHistory(props: ConversationHistoryProps) {
  const { mobileOpen, onCloseMobile } = props;
  const [editingId, setEditingId] = useState<string>();
  const [title, setTitle] = useState("");
  const [mutationError, setMutationError] = useState<string>();
  const [busyId, setBusyId] = useState<string>();
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary>();
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!mobileOpen) return;
    
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseMobile();
    }
    
    // Focus search input when drawer opens
    setTimeout(() => searchInputRef.current?.focus(), 50);
    
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mobileOpen, onCloseMobile]);

  function beginRename(conversation: ConversationSummary): void {
    setEditingId(conversation.id);
    setTitle(conversation.title);
    setMutationError(undefined);
  }

  async function saveRename(): Promise<void> {
    if (!editingId || !title.trim()) return;
    setBusyId(editingId);
    try {
      await props.onRename(editingId, title.trim());
      setEditingId(undefined);
    } catch (error) {
      setMutationError(
        error instanceof Error ? error.message : "Could not rename the conversation.",
      );
    } finally {
      setBusyId(undefined);
    }
  }

  async function remove(conversation: ConversationSummary): Promise<void> {
    setBusyId(conversation.id);
    setMutationError(undefined);
    try {
      await props.onDelete(conversation.id);
    } catch (error) {
      setMutationError(
        error instanceof Error ? error.message : "Could not delete the conversation.",
      );
    } finally {
      setBusyId(undefined);
      setDeleteTarget(undefined);
    }
  }

  const content = (
    <>
      <div className="flex items-center justify-between border-b border-slate-200 px-2.5 py-2.5">
        <h3 className="text-sm font-semibold text-(--ec-blue)">
          Conversations
        </h3>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 rounded-sm px-2 text-xs"
          onClick={props.onNew}
          disabled={props.disabled}
        >
          New
        </Button>
      </div>
      <div className="border-b border-slate-200 px-2 py-2">
        <div className="relative flex items-center">
          <Search
            className="pointer-events-none absolute left-2 size-3.5 text-(--ec-mute)"
            aria-hidden="true"
          />
          <input
            ref={searchInputRef}
            type="search"
            placeholder="Search…"
            value={props.searchQuery}
            onChange={(e) => props.onSearchChange(e.target.value)}
            className="conversation-search h-8 w-full appearance-none rounded-md border border-slate-200 bg-white py-1 pl-7 pr-7 text-xs text-(--ec-ink) placeholder:text-(--ec-mute) focus:outline-none focus:ring-2 focus:ring-(--ec-yellow)"
          />
          {props.searchQuery ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => props.onSearchChange("")}
              className="absolute right-2 text-(--ec-mute) hover:text-(--ec-ink)"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-(--ec-mute)">
            Project
          </p>
          {props.activeProjectId ? (
            <button
              type="button"
              onClick={() => props.onScopeChange("")}
              className="text-[10px] font-medium text-(--ec-blue) hover:underline"
            >
              Clear
            </button>
          ) : null}
        </div>
        <select
          aria-label="Retrieval scope"
          className="mt-2 h-8 w-full rounded-md border border-(--ec-line) bg-white px-2 text-xs font-semibold text-(--ec-blue)"
          value={props.activeProjectId ?? ""}
          onChange={(event) => props.onScopeChange(event.target.value)}
        >
          <option value="">Global ⋅ No Project</option>
          {props.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {props.isLoading ? (
          <div className="flex justify-center py-8 text-(--ec-mute)">
            <LoaderCircle
              className="size-5 animate-spin"
              aria-label="Loading conversations"
            />
          </div>
        ) : props.conversations.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs leading-5 text-(--ec-mute)">
            {props.searchQuery
              ? "No conversations match your search."
              : "Your conversations will appear here."}
          </p>
        ) : (
          <ul className="space-y-1">
            {props.conversations.map((conversation) => {
              const active = conversation.id === props.activeConversationId;
              const busy = busyId === conversation.id;
              return (
                <li
                  key={conversation.id}
                  className={`group border-l-2 ${active ? "border-(--ec-yellow) bg-blue-50" : "border-transparent hover:bg-slate-100"}`}
                >
                  {editingId === conversation.id ? (
                    <div className="flex items-center gap-1 p-2">
                      <Input
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        maxLength={80}
                        className="h-8 rounded-sm bg-white text-xs"
                        autoFocus
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void saveRename();
                          if (event.key === "Escape") setEditingId(undefined);
                        }}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        onClick={() => void saveRename()}
                        disabled={busy || !title.trim()}
                        aria-label="Save title"
                      >
                        <Check className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        onClick={() => setEditingId(undefined)}
                        aria-label="Cancel rename"
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 p-1.5">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 p-1 text-left"
                        onClick={() => props.onOpen(conversation.id)}
                        disabled={props.disabled}
                      >
                        <span
                          className={`mt-0.5 size-2 shrink-0 rounded-full ${
                            active ? "bg-(--ec-yellow)" : "bg-slate-300"
                          }`}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-(--ec-ink)">
                            {conversation.title}
                          </span>
                          {conversation.projectId ? (
                            <span className="mt-0.5 block truncate text-[10px] font-medium text-blue-600">
                              {props.projects.find(
                                (project) => project.id === conversation.projectId,
                              )?.name ?? "Project"}
                            </span>
                          ) : null}
                          <span className="mt-0.5 block text-[11px] text-(--ec-mute)">
                            {formatDate(conversation.updatedAt)}
                          </span>
                        </span>
                      </button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 opacity-0 group-hover:opacity-100 focus:opacity-100"
                        onClick={() => beginRename(conversation)}
                        disabled={props.disabled || busy}
                        aria-label={`Rename ${conversation.title}`}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-red-700 opacity-0 group-hover:opacity-100 focus:opacity-100"
                        onClick={() => setDeleteTarget(conversation)}
                        disabled={props.disabled || busy}
                        aria-label={`Delete ${conversation.title}`}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {props.hasMore ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full rounded-sm text-xs"
            disabled={props.isLoadingMore}
            onClick={() => void props.onLoadMore()}
          >
            {props.isLoadingMore ? "Loading…" : "Load more"}
          </Button>
        ) : null}
        {props.error || mutationError ? (
          <p className="p-2 text-xs leading-5 text-red-700" role="alert">
            {mutationError ?? props.error}
          </p>
        ) : null}
      </div>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete conversation?"
        description={
          deleteTarget
            ? `"${deleteTarget.title}" will be permanently removed.`
            : ""
        }
        busy={Boolean(busyId)}
        onCancel={() => setDeleteTarget(undefined)}
        onConfirm={() => (deleteTarget ? void remove(deleteTarget) : undefined)}
      />
    </>
  );

  return (
    <>
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-slate-50 lg:flex">
        {content}
      </aside>
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 animate-fade-in bg-slate-950/35"
            aria-label="Close conversation history"
            onClick={onCloseMobile}
          />
          <aside className="relative flex h-full w-[min(22rem,88vw)] animate-slide-in-left flex-col bg-white shadow-xl">
            <Button
              size="icon"
              variant="ghost"
              className="absolute right-2 top-2 z-10 size-8"
              onClick={onCloseMobile}
              aria-label="Close conversation history"
            >
              <X className="size-4" />
            </Button>
            {content}
          </aside>
        </div>
      ) : null}
    </>
  );
}