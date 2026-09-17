"use client";

import { useEffect, useRef, useState } from "react";
import {
  responseError,
  type ConversationSummary,
} from "../conversationTypes";

const PAGE_SIZE = 10;

type ConversationListResponse = Readonly<{
  conversations: readonly ConversationSummary[];
  nextCursor: string | null;
}>;

export function useConversationHistory() {
  const [conversations, setConversations] = useState<
    readonly ConversationSummary[]
  >([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [searchQuery, setSearchQuery] = useState("");
  // debouncedQuery drives the actual fetch; updated 300 ms after searchQuery changes
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const activeQueryRef = useRef("");

  function updateSearchQuery(nextQuery: string): void {
    setSearchQuery((currentQuery) => {
      if (currentQuery === nextQuery) return currentQuery;
      setIsLoading(true);
      return nextQuery;
    });
  }

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(id);
  }, [searchQuery]);

  async function fetchPage(cursor?: string, query?: string): Promise<ConversationListResponse> {
    const url = new URL("/api/conversations", window.location.origin);
    url.searchParams.set("limit", String(PAGE_SIZE));
    if (cursor) url.searchParams.set("cursor", cursor);
    if (query) url.searchParams.set("q", query);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw await responseError(response, "Could not load conversation history.");
    }
    return (await response.json()) as ConversationListResponse;
  }

  useEffect(() => {
    let active = true;
    activeQueryRef.current = debouncedQuery;
    void fetchPage(undefined, debouncedQuery || undefined)
      .then((payload) => {
        if (!active) return;
        setConversations(payload.conversations);
        setNextCursor(payload.nextCursor);
        setError(undefined);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load conversation history.",
          );
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [debouncedQuery]);

  function upsertConversation(conversation: ConversationSummary): void {
    setConversations((current) => [
      conversation,
      ...current.filter((item) => item.id !== conversation.id),
    ]);
  }

  async function loadMore(): Promise<void> {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const payload = await fetchPage(nextCursor, activeQueryRef.current || undefined);
      setConversations((current) => [
        ...current,
        ...payload.conversations.filter(
          (incoming) => !current.some((item) => item.id === incoming.id),
        ),
      ]);
      setNextCursor(payload.nextCursor);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not load more conversations.",
      );
    } finally {
      setIsLoadingMore(false);
    }
  }

  async function renameConversation(id: string, title: string): Promise<void> {
    const response = await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) {
      throw await responseError(response, "Could not rename the conversation.");
    }
    const payload = (await response.json()) as {
      conversation: ConversationSummary;
    };
    upsertConversation(payload.conversation);
  }

  async function deleteConversation(id: string): Promise<void> {
    const response = await fetch(`/api/conversations/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      throw await responseError(response, "Could not delete the conversation.");
    }
    setConversations((current) => current.filter((item) => item.id !== id));
  }

  return {
    conversations,
    deleteConversation,
    error,
    hasMore: Boolean(nextCursor),
    isLoading,
    isLoadingMore,
    loadMore,
    renameConversation,
    searchQuery,
    setSearchQuery: updateSearchQuery,
    upsertConversation,
  };
}