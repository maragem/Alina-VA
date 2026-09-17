"use client";

import { LoaderCircle } from "lucide-react";

export function PreviewLoading({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex h-full min-h-48 items-center justify-center px-8 text-sm text-(--ec-mute)"
      role="status"
    >
      <LoaderCircle className="mr-2 size-5 animate-spin" aria-hidden />
      {children}
    </div>
  );
}

export function PreviewError({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex h-full min-h-48 items-center justify-center px-8 text-sm text-rose-700"
      role="alert"
    >
      {children}
    </div>
  );
}
