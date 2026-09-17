"use client";

import { Button } from "@/components/ui/button";
import { useModalLifecycle } from "@/components/ui/hooks/useModalLifecycle";

type ConfirmDialogProps = Readonly<{
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}>;

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Delete",
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  useModalLifecycle({ open, onEscape: onCancel, lockBodyScroll: true });

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-70 flex animate-fade-in items-center justify-center bg-slate-950/45 p-4">
      <section
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        aria-modal="true"
        role="alertdialog"
        className="w-full max-w-md animate-scale-in rounded-lg bg-white p-6 shadow-2xl"
      >
        <h2 id="confirm-dialog-title" className="text-lg font-bold text-slate-950">
          {title}
        </h2>
        <p id="confirm-dialog-description" className="mt-2 text-sm leading-6 text-slate-600">
          {description}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button autoFocus variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button className="bg-rose-700 hover:bg-rose-800" onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </section>
    </div>
  );
}