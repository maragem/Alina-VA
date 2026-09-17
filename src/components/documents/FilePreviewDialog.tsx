"use client";

import { Button, buttonVariants } from "@/components/ui/button";
import { useModalLifecycle } from "@/components/ui/hooks/useModalLifecycle";
import { apiErrorMessage } from "@/lib/apiError";
import { Download, FileQuestion, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { PreviewLoading } from "./PreviewStatus";

export type PreviewHighlight = Readonly<{
  quotes: readonly string[];
  pageHint?: number;
}>;

export type PreviewFile = Readonly<{
  id: string;
  name: string;
  highlight?: PreviewHighlight;
}>;

type FilePreviewDialogProps = {
  file: PreviewFile | null;
  onClose: () => void;
};

type PreviewKind = "docx" | "image" | "pdf" | "web" | "xlsx" | "unsupported";

const PdfFilePreview = dynamic(
  () => import("./PdfFilePreview").then((module) => module.PdfFilePreview),
  { ssr: false },
);
const DocxFilePreview = dynamic(
  () => import("./DocxFilePreview").then((module) => module.DocxFilePreview),
  { ssr: false },
);
const XlsxFilePreview = dynamic(
  () => import("./XlsxFilePreview").then((module) => module.XlsxFilePreview),
  { ssr: false },
);

function getPreviewKind(fileName: string, contentType: string): PreviewKind {
  const name = fileName.toLowerCase();
  const type = contentType.split(";", 1)[0].toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx")
  ) return "docx";
  if (
    type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    name.endsWith(".xlsx")
  ) return "xlsx";
  if (type.startsWith("image/") && type !== "image/svg+xml") return "image";
  if (
    type.startsWith("text/") ||
    type === "application/json" ||
    type === "application/xml" ||
    name.endsWith(".svg")
  ) return "web";
  return "unsupported";
}

function FilePreview({
  file,
  onClose,
}: {
  file: PreviewFile;
  onClose: () => void;
}) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState<PreviewKind>("unsupported");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isDocx = file.name.toLowerCase().endsWith(".docx");

  useModalLifecycle({ open: true, onEscape: onClose, lockBodyScroll: true });

  useEffect(() => {
    const controller = new AbortController();
    let nextObjectUrl: string | null = null;

    fetch(
      isDocx
        ? `/api/haystack/files/${encodeURIComponent(file.id)}/preview`
        : `/api/haystack/files/${encodeURIComponent(file.id)}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            await apiErrorMessage(response, "The file could not be loaded."),
          );
        return response.blob();
      })
      .then((blob) => {
        if (controller.signal.aborted) return;
        nextObjectUrl = URL.createObjectURL(blob);
        setBlob(blob);
        setPreviewKind(isDocx ? "pdf" : getPreviewKind(file.name, blob.type));
        setObjectUrl(nextObjectUrl);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          reason instanceof Error
            ? reason.message
            : "The file could not be loaded.",
        );
        setLoading(false);
      });

    return () => {
      controller.abort();
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
    };
  }, [file, isDocx]);

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in bg-slate-950/60 p-3 sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="m-auto flex h-full max-h-220 w-full max-w-6xl animate-scale-in-slow flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-preview-title"
      >
        <header className="flex min-h-16 items-center gap-3 border-b border-(--ec-line) px-4 sm:px-5">
          <div className="min-w-0 flex-1">
            <h2
              id="file-preview-title"
              className="truncate font-semibold text-slate-950"
            >
              {file.name}
            </h2>
            <p className="text-xs text-(--ec-mute)">File preview</p>
          </div>
          {objectUrl || isDocx ? (
            <div className="hidden sm:block">
              <a
                className={buttonVariants({ variant: "outline", size: "sm" })}
                href={isDocx ? `/api/haystack/files/${encodeURIComponent(file.id)}` : objectUrl ?? undefined}
                download={file.name}
              >
                <Download className="size-4" aria-hidden />
                Download
              </a>
            </div>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close preview"
            autoFocus
          >
            <X className="size-5" aria-hidden />
          </Button>
        </header>

        <div className="min-h-0 flex-1 bg-slate-100">
          {loading ? <PreviewLoading>Loading preview…</PreviewLoading> : null}
          {error ? (
            <div
              className="flex h-full flex-col items-center justify-center px-6 text-center"
              role="alert"
            >
              <FileQuestion className="size-10 text-slate-400" aria-hidden />
              <p className="mt-3 font-semibold text-slate-900">
                Preview unavailable
              </p>
              <p className="mt-1 max-w-md text-sm text-(--ec-mute)">{error}</p>
            </div>
          ) : null}
          {!loading && !error && blob && previewKind === "pdf" ? (
            <PdfFilePreview blob={blob} highlight={file.highlight} />
          ) : null}
          {!loading && !error && blob && previewKind === "docx" ? (
            <DocxFilePreview blob={blob} highlight={file.highlight} />
          ) : null}
          {!loading && !error && blob && previewKind === "xlsx" ? (
            <XlsxFilePreview blob={blob} />
          ) : null}
          {!loading && !error && objectUrl && previewKind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element -- blob URLs are not supported by next/image.
            <img
              className="h-full w-full object-contain p-3 sm:p-6"
              src={objectUrl}
              alt={file.name}
            />
          ) : null}
          {!loading && !error && objectUrl && previewKind === "web" ? (
            <iframe
              className="h-full w-full border-0 bg-white"
              src={objectUrl}
              title={`Preview of ${file.name}`}
              sandbox=""
              referrerPolicy="no-referrer"
            />
          ) : null}
          {!loading && !error && objectUrl && previewKind === "unsupported" ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <FileQuestion className="size-10 text-slate-400" aria-hidden />
              <p className="mt-3 font-semibold text-slate-900">
                No browser preview available
              </p>
              <p className="mt-1 max-w-md text-sm text-(--ec-mute)">
                Download this file to open it in its associated application.
              </p>
              <a
                className="mt-5 inline-flex h-10 items-center gap-2 rounded-md bg-(--ec-blue) px-4 text-sm font-medium text-white hover:bg-(--ec-blue-soft)"
                href={objectUrl}
                download={file.name}
              >
                <Download className="size-4" aria-hidden />
                Download file
              </a>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export function FilePreviewDialog({ file, onClose }: FilePreviewDialogProps) {
  if (!file) return null;
  return <FilePreview key={file.id} file={file} onClose={onClose} />;
}