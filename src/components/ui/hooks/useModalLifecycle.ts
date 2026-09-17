"use client";

import { useEffect } from "react";

type UseModalLifecycleInput = {
  open: boolean;
  onEscape: () => void;
  lockBodyScroll?: boolean;
};

export function useModalLifecycle({
  open,
  onEscape,
  lockBodyScroll = false,
}: UseModalLifecycleInput): void {
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onEscape();
    }

    const previousOverflow = document.body.style.overflow;
    if (lockBodyScroll) document.body.style.overflow = "hidden";

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (lockBodyScroll) document.body.style.overflow = previousOverflow;
    };
  }, [lockBodyScroll, onEscape, open]);
}