"use client";

import {
  clearCitationHighlights,
  highlightCitationQuotes,
  scrollRangeIntoView,
} from "@/lib/domTextHighlight";
import { findBestMatch, normalizeForMatch } from "@/lib/textHighlightMatch";
import { useEffect, useRef, useState } from "react";
import type { PreviewHighlight } from "./FilePreviewDialog";
import { PreviewPagination } from "./PreviewPagination";
import { PreviewError, PreviewLoading } from "./PreviewStatus";

const NO_QUOTES: readonly string[] = [];

function findQuotePage(
  pages: readonly HTMLElement[],
  quotes: readonly string[],
): number | null {
  const needles = quotes.map((quote) => normalizeForMatch(quote).text);

  for (const [index, page] of pages.entries()) {
    const text = normalizeForMatch(page.textContent ?? "").text;
    if (needles.some((needle) => findBestMatch(text, needle))) return index + 1;
  }
  return null;
}

export function DocxFilePreview({
  blob,
  highlight,
}: {
  blob: Blob;
  highlight?: PreviewHighlight;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const quotes = highlight?.quotes ?? NO_QUOTES;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;

    import("docx-preview")
      .then(({ renderAsync }) =>
        renderAsync(blob, container, container, {
          breakPages: true,
          experimental: true,
          ignoreLastRenderedPageBreak: false,
          renderAltChunks: false,
          useBase64URL: true,
        }),
      )
      .then(() => {
        if (cancelled) return;
        const pages = Array.from(
          container.querySelectorAll<HTMLElement>(".docx"),
        );
        setPageCount(Math.max(pages.length, 1));
        setPageNumber(quotes.length ? (findQuotePage(pages, quotes) ?? 1) : 1);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("This Word document could not be rendered.");
        setLoading(false);
      });

    return () => {
      cancelled = true;
      container.replaceChildren();
    };
  }, [blob, quotes]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || pageCount === 0) return;

    const pages = Array.from(container.querySelectorAll<HTMLElement>(".docx"));
    pages.forEach((page, index) => {
      page.hidden = index !== pageNumber - 1;
    });
  }, [pageCount, pageNumber]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || loading || !quotes.length) return;

    const page =
      container.querySelectorAll<HTMLElement>(".docx")[pageNumber - 1];
    if (!page) return;

    const [range] = highlightCitationQuotes(page, quotes);
    if (range) scrollRangeIntoView(range);

    return () => clearCitationHighlights(page);
  }, [loading, pageNumber, quotes]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1 overflow-auto bg-slate-100 p-3 sm:p-6">
        {loading ? (
          <div className="absolute inset-0 z-10 bg-slate-100">
            <PreviewLoading>Rendering Word document…</PreviewLoading>
          </div>
        ) : null}
        {error ? <PreviewError>{error}</PreviewError> : null}
        <div
          ref={containerRef}
          className="docx-preview mx-auto min-h-full w-full max-w-220"
        />
      </div>
      <PreviewPagination
        pageNumber={pageNumber}
        pageCount={pageCount}
        onPageChange={setPageNumber}
        label="Word document"
      />
    </div>
  );
}