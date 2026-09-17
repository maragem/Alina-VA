"use client";

type UndoToastProps = Readonly<{
  message: string | null;
  onUndo: () => void;
}>;

export function UndoToast({ message, onUndo }: UndoToastProps) {
  if (!message) return null;
  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-80 flex animate-lift-in -translate-x-1/2 items-center gap-5 rounded-lg bg-slate-950 px-4 py-3 text-sm text-white shadow-2xl"
    >
      <span>{message}</span>
      <button type="button" className="font-bold text-(--ec-yellow)" onClick={onUndo}>
        Undo
      </button>
    </div>
  );
}