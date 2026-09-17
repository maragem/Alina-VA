"use client";

import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

export function PreviewPagination({
  pageNumber,
  pageCount,
  onPageChange,
  label,
}: {
  pageNumber: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  label: string;
}) {
  // null means "not being edited": the input mirrors pageNumber.
  const [draft, setDraft] = useState<string | null>(null);

  if (pageCount <= 0) return null;

  const step = (delta: number) => {
    setDraft(null);
    onPageChange(Math.min(Math.max(pageNumber + delta, 1), pageCount));
  };

  const commit = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      onPageChange(Math.min(Math.max(parsed, 1), pageCount));
    }
    setDraft(null);
  };

  return (
    <div className="flex min-h-14 items-center justify-center gap-3 border-t border-(--ec-line) bg-white px-4">
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        disabled={pageNumber <= 1}
        onClick={() => step(-1)}
        aria-label={`Previous ${label} page`}
      >
        <ChevronLeft className="size-4" aria-hidden />
      </Button>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <span>Page</span>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={draft ?? String(pageNumber)}
          maxLength={String(pageCount).length}
          aria-label={`${label} page number, between 1 and ${pageCount}`}
          className="w-14 rounded-md border border-(--ec-line) bg-white px-2 py-1 text-center text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-(--ec-yellow)"
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.target.value.replace(/\D/g, ""))}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setDraft(null);
            }
          }}
        />
        <span>of {pageCount}</span>
      </label>
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        disabled={pageNumber >= pageCount}
        onClick={() => step(1)}
        aria-label={`Next ${label} page`}
      >
        <ChevronRight className="size-4" aria-hidden />
      </Button>
    </div>
  );
}
