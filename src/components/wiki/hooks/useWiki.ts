"use client";

import { useCallback, useEffect, useState } from "react";
import { apiError } from "@/lib/apiError";
import type { WikiPageSummary, WikiPageView, WikiSearchHit } from "@/lib/wiki";

export type KnowledgeBaseInfo = Readonly<{
  projectId: string | null;
  name: string;
  canEdit: boolean;
}>;

type TreeResponse = Readonly<{ knowledgeBase: KnowledgeBaseInfo; pages: WikiPageSummary[] }>;

function kbParam(projectId: string | null): string {
  return projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
}

type TreeState = Readonly<{
  key: string;
  knowledgeBase?: KnowledgeBaseInfo;
  pages: readonly WikiPageSummary[];
  error?: string;
}>;

export function useWikiTree(projectId: string | null) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<TreeState | null>(null);
  const key = `${projectId ?? "global"}:${version}`;

  useEffect(() => {
    let active = true;
    void fetch(`/api/wiki/pages${kbParam(projectId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw await apiError(response, "Could not load the knowledge base.");
        return (await response.json()) as TreeResponse;
      })
      .then((payload) => {
        if (active) setState({ key, knowledgeBase: payload.knowledgeBase, pages: payload.pages });
      })
      .catch((reason: unknown) => {
        if (active) {
          setState({
            key,
            pages: [],
            error: reason instanceof Error ? reason.message : "Could not load the knowledge base.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [key, projectId]);

  const refresh = useCallback(() => setVersion((current) => current + 1), []);
  // While a refresh is in flight keep showing the previous tree for the same knowledge base.
  const sameKnowledgeBase = state?.key.startsWith(`${projectId ?? "global"}:`) ?? false;
  return {
    knowledgeBase: sameKnowledgeBase ? state?.knowledgeBase : undefined,
    pages: sameKnowledgeBase ? state?.pages ?? [] : [],
    loading: state?.key !== key,
    error: sameKnowledgeBase ? state?.error : undefined,
    refresh,
  };
}

type PageState = Readonly<{
  pageId: string;
  page: WikiPageView | null;
  error?: string;
}>;

export function useWikiPage(pageId: string | undefined) {
  // Loading is derived: the stored result belongs to a different page until the fetch lands.
  const [state, setState] = useState<PageState | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!pageId) return;
    let active = true;
    void fetch(`/api/wiki/pages/${pageId}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw await apiError(response, "Could not load the page.");
        return (await response.json()) as { page: WikiPageView };
      })
      .then((payload) => {
        if (active) setState({ pageId, page: payload.page });
      })
      .catch((reason: unknown) => {
        if (active) {
          setState({
            pageId,
            page: null,
            error: reason instanceof Error ? reason.message : "Could not load the page.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [pageId, version]);

  const current = pageId && state?.pageId === pageId ? state : null;
  return {
    page: current?.page ?? null,
    error: current?.error,
    loading: Boolean(pageId) && current === null,
    reload: () => setVersion((value) => value + 1),
    setPage: (page: WikiPageView) => setState({ pageId: page.id, page }),
  };
}

export function useWikiSearch(projectId: string | null) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<readonly WikiSearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      const reset = setTimeout(() => {
        setHits([]);
        setSearching(false);
      }, 0);
      return () => clearTimeout(reset);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      const params = new URLSearchParams({ q: trimmed });
      if (projectId) params.set("projectId", projectId);
      void fetch(`/api/wiki/search?${params}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) return { hits: [] as WikiSearchHit[] };
          return (await response.json()) as { hits: WikiSearchHit[] };
        })
        .then((payload) => setHits(payload.hits))
        .catch(() => undefined)
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [projectId, query]);

  return { query, setQuery, hits, searching };
}
