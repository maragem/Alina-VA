"use client";

import {
  clearCitationHighlights,
  highlightCitationQuotes,
  scrollRangeIntoView,
} from "@/lib/domTextHighlight";
import { findBestMatch, normalizeForMatch } from "@/lib/textHighlightMatch";
import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import type { PreviewHighlight } from "./FilePreviewDialog";
import { PreviewPagination } from "./PreviewPagination";
import { PreviewError, PreviewLoading } from "./PreviewStatus";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type PdfDocumentProxy = Readonly<{
  numPages: number;
  getPage: (pageNumber: number) => Promise<{
    getTextContent: () => Promise<{ items: readonly unknown[] }>;
  }>;
}>;

const NO_QUOTES: readonly string[] = [];
const MAX_SEARCHED_PAGES = 60;

/** Pages to scan, nearest to the hinted page first. */
function searchOrder(
  pageCount: number,
  pageHint: number | undefined,
): number[] {
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1);
  if (!pageHint || !Number.isFinite(pageHint)) {
    return pages.slice(0, MAX_SEARCHED_PAGES);
  }
  return pages
    .sort(
      (left, right) =>
        Math.abs(left - pageHint) - Math.abs(right - pageHint) || left - right,
    )
    .slice(0, MAX_SEARCHED_PAGES);
}

function textContentToString(items: readonly unknown[]): string {
  return items
    .map((item) =>
      item && typeof item === "object" && "str" in item
        ? String((item as { str: unknown }).str)
        : "",
    )
    .join(" ");
}

export function PdfFilePreview({
  blob,
  highlight,
}: {
  blob: Blob;
  highlight?: PreviewHighlight;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<Uint8Array | null>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [pdf, setPdf] = useState<PdfDocumentProxy | null>(null);
  const [textLayerVersion, setTextLayerVersion] = useState(0);
  const [quoteMissing, setQuoteMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pdfFile = useMemo(() => (data ? { data } : null), [data]);
  const quotes = highlight?.quotes ?? NO_QUOTES;
  const pageHint = highlight?.pageHint;
  const needles = useMemo(
    () => quotes.map((quote) => normalizeForMatch(quote).text),
    [quotes],
  );

  useEffect(() => {
    let disposed = false;

    blob
      .arrayBuffer()
      .then((buffer) => {
        if (!disposed) setData(new Uint8Array(buffer));
      })
      .catch(() => {
        if (!disposed) setError("This PDF could not be read.");
      });

    return () => {
      disposed = true;
    };
  }, [blob]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Locate the cited passage without rendering pages, then jump straight to it.
  useEffect(() => {
    if (!pdf || !needles.length) return;
    let cancelled = false;

    void (async () => {
      for (const candidate of searchOrder(pdf.numPages, pageHint)) {
        if (cancelled) return;
        try {
          const page = await pdf.getPage(candidate);
          const content = await page.getTextContent();
          if (cancelled) return;
          const text = normalizeForMatch(
            textContentToString(content.items),
          ).text;
          if (needles.some((needle) => findBestMatch(text, needle))) {
            setPageNumber(candidate);
            return;
          }
        } catch {
          return;
        }
      }
      if (!cancelled) setQuoteMissing(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [needles, pageHint, pdf]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || textLayerVersion === 0 || !quotes.length) return;

    const textLayer = container.querySelector<HTMLElement>(
      ".react-pdf__Page__textContent",
    );
    if (!textLayer) return;

    textLayer.style.mixBlendMode = "multiply";
    const pageElement = textLayer.closest<HTMLElement>(".react-pdf__Page");
    if (pageElement) pageElement.style.isolation = "isolate";

    const [range] = highlightCitationQuotes(textLayer, quotes);
    if (range) scrollRangeIntoView(range);

    return () => {
      clearCitationHighlights(textLayer);
      textLayer.style.mixBlendMode = "";
      if (pageElement) pageElement.style.isolation = "";
    };
  }, [quotes, textLayerVersion]);

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-3 sm:p-6">
        {!data && !error ? (
          <PreviewLoading>Preparing PDF…</PreviewLoading>
        ) : null}
        {error ? <PreviewError>{error}</PreviewError> : null}
        {pdfFile ? (
          <Document
            file={pdfFile}
            className="mx-auto flex w-fit justify-center shadow-lg"
            loading={<PreviewLoading>Rendering PDF…</PreviewLoading>}
            error={<PreviewError>This PDF could not be rendered.</PreviewError>}
            onLoadSuccess={(document) => {
              setPageCount(document.numPages);
              setPageNumber(1);
              setPdf(document as unknown as PdfDocumentProxy);
            }}
            onLoadError={() => setError("This PDF could not be rendered.")}
            onSourceError={() => setError("This PDF could not be read.")}
          >
            <Page
              pageNumber={pageNumber}
              width={Math.max(280, Math.min(containerWidth - 48, 900))}
              renderAnnotationLayer={false}
              renderTextLayer={quotes.length > 0}
              onRenderTextLayerSuccess={() =>
                setTextLayerVersion((version) => version + 1)
              }
            />
          </Document>
        ) : null}
      </div>
      {quoteMissing ? (
        <p className="border-t border-(--ec-line) bg-amber-50 px-4 py-2 text-xs text-(--ec-ink)">
          The cited passage could not be located in the original file.
        </p>
      ) : null}
      <PreviewPagination
        pageNumber={pageNumber}
        pageCount={pageCount}
        onPageChange={setPageNumber}
        label="PDF"
      />
    </div>
  );
}