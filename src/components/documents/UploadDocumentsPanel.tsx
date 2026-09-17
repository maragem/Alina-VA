"use client";

import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/apiError";
import {
  AUTHORITY_CATEGORIES,
  type AuthorityCategory,
} from "@/lib/documentMetadata";
import {
  ACCEPTED_FILE_EXTENSIONS,
  fileAcceptanceError,
} from "@/lib/fileValidation";
import { LoaderCircle, Upload, X } from "lucide-react";
import { FileTypeIcon } from "@/components/FileTypeIcon";
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";

type UploadState = "pending" | "uploading" | "failed";

type UploadItem = {
  id: string;
  file: File;
  state: UploadState;
  error?: string;
};

type UploadDocumentsPanelProps = {
  onClose: () => void;
  onComplete: (result: { uploadedFileIds: string[]; failed: number }) => void;
  projectId?: string;
};

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadDocumentsPanel({
  onClose,
  onComplete,
  projectId,
}: UploadDocumentsPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [tags, setTags] = useState("");
  const [authorityCategory, setAuthorityCategory] = useState<
    AuthorityCategory | ""
  >("");
  const [rejections, setRejections] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  function addFiles(files: File[]) {
    const nextItems: UploadItem[] = [];
    const nextRejections: string[] = [];

    for (const file of files) {
      const rejection = fileAcceptanceError(file);
      if (rejection) {
        nextRejections.push(`${file.name}: ${rejection}`);
        continue;
      }
      nextItems.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
        state: "pending",
      });
    }

    setItems((current) => [...current, ...nextItems]);
    setRejections(nextRejections);
    setSummary(null);
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (!uploading) addFiles(Array.from(event.dataTransfer.files));
  }

  async function uploadFile(
    item: UploadItem,
  ): Promise<{ fileId?: string; error?: string }> {
    const formData = new FormData();
    formData.append("file", item.file);
    if (projectId) formData.append("projectId", projectId);
    if (tags.trim()) formData.append("tags", tags);
    if (authorityCategory)
      formData.append("authorityCategory", authorityCategory);

    const response = await fetch("/api/haystack/files", {
      method: "POST",
      body: formData,
    });
    if (!response.ok)
      return {
        error: await apiErrorMessage(response, "The file could not be uploaded."),
      };
    const payload = (await response.json().catch(() => null)) as {
      fileId?: unknown;
    } | null;
    return typeof payload?.fileId === "string"
      ? { fileId: payload.fileId }
      : { error: "The upload service returned an invalid file ID." };
  }

  async function handleSubmit() {
    const candidates = items.filter((item) => item.state !== "uploading");
    if (candidates.length === 0 || uploading) return;

    setUploading(true);
    setSummary(null);
    setRejections([]);
    setItems((current) =>
      current.map((item) =>
        candidates.some((candidate) => candidate.id === item.id)
          ? { ...item, state: "uploading", error: undefined }
          : item,
      ),
    );

    const outcomes = new Map<string, { fileId?: string; error?: string }>();
    for (const item of candidates) {
      try {
        outcomes.set(item.id, await uploadFile(item));
      } catch {
        outcomes.set(item.id, { error: "Could not reach the upload service." });
      }
    }

    const uploadedFileIds = [...outcomes.values()].flatMap((outcome) =>
      outcome.fileId ? [outcome.fileId] : [],
    );
    const succeeded = uploadedFileIds.length;
    const failed = candidates.length - succeeded;
    setItems((current) =>
      current.flatMap((item) => {
        const outcome = outcomes.get(item.id);
        if (outcome === undefined || outcome.fileId)
          return outcome?.fileId ? [] : [item];
        return [{ ...item, state: "failed", error: outcome.error }];
      }),
    );
    setSummary(
      failed > 0
        ? `${succeeded} ${succeeded === 1 ? "file" : "files"} uploaded; ${failed} failed.`
        : `${succeeded} ${succeeded === 1 ? "file" : "files"} uploaded and queued for indexing.`,
    );
    setUploading(false);
    onComplete({ uploadedFileIds, failed });
  }

  return (
    <section
      className="border-b border-(--ec-line) bg-slate-50 px-5 py-4"
      aria-labelledby="upload-title"
    >
      <div
        className={`flex flex-wrap items-center justify-between gap-4 border-2 border-dashed bg-white p-4 ${isDragging ? "border-(--ec-blue) bg-blue-50" : "border-(--ec-blue-100)"}`}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!uploading) setIsDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setIsDragging(false);
        }}
        onDrop={handleDrop}
      >
        <div>
          <h3
            id="upload-title"
            className="text-sm font-semibold text-slate-950"
          >
            {projectId ? "Upload files to this project" : "Upload global files"}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {projectId
              ? "These files will only be available in assigned projects."
              : "These files will be available in global chat and every project."}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            PDF, DOC, DOCX, ODT, XLSX, TXT, or MD. Maximum 50 MB per file.
          </p>
        </div>
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          multiple
          accept={ACCEPTED_FILE_EXTENSIONS.join(",")}
          onChange={handleInputChange}
          disabled={uploading}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          <Upload className="size-4" aria-hidden />
          Browse files
        </Button>
      </div>

      {items.length > 0 ? (
        <ul
          className="mt-3 divide-y divide-slate-200 animate-lift-in border border-slate-200 bg-white"
          aria-label="Selected files"
        >
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-3 py-2">
              <FileTypeIcon
                fileName={item.file.name}
                className="size-4 shrink-0 text-(--ec-blue)"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {item.file.name}
                </p>
                <p className="text-xs text-slate-500">
                  {formatSize(item.file.size)}
                </p>
                {item.error ? (
                  <p className="mt-1 text-xs text-rose-700">{item.error}</p>
                ) : null}
                {item.state === "uploading" ? (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full animate-progress-stripes bg-linear-to-r from-[--ec-blue] via-blue-500 to-[--ec-blue]" />
                  </div>
                ) : null}
              </div>
              {item.state === "uploading" ? (
                <LoaderCircle
                  className="size-4 animate-spin text-(--ec-blue)"
                  aria-label="Uploading"
                />
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`Remove ${item.file.name}`}
                disabled={uploading}
                onClick={() =>
                  setItems((current) =>
                    current.filter((currentItem) => currentItem.id !== item.id),
                  )
                }
              >
                <X className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {rejections.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs text-rose-700" role="alert">
          {rejections.map((rejection) => (
            <li key={rejection}>{rejection}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="min-w-56 flex-1 text-xs font-semibold text-(--ec-mute)">
          Tags
          <input
            className="ec-input mt-1 h-9 rounded-md"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="Comma-separated, e.g. regulation, finance"
            disabled={uploading}
          />
        </label>
        <label className="min-w-64 flex-1 text-xs font-semibold text-(--ec-mute)">
          Data hierarchy
          <select
            className="mt-1 h-9 w-full rounded-md border border-(--ec-line) bg-white px-2 text-sm text-(--ec-ink)"
            value={authorityCategory}
            onChange={(event) =>
              setAuthorityCategory(event.target.value as AuthorityCategory | "")
            }
            disabled={uploading}
          >
            <option value="">No classification</option>
            {[1, 2, 3, 4].map((rank) => (
              <optgroup key={rank} label={`Level ${rank}`}>
                {AUTHORITY_CATEGORIES.filter(
                  (category) => category.rank === rank,
                ).map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
                ))}
              </optgroup>
            ))}
            <optgroup label="Unranked">
              {AUTHORITY_CATEGORIES.filter(
                (category) => category.rank === null,
              ).map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p
          className={`animate-fade-in text-xs ${summary?.includes("failed") ? "text-rose-700" : "text-(--ec-mute)"}`}
          aria-live="polite"
        >
          {summary}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={uploading}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={items.length === 0 || uploading}
          >
            {uploading ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
            ) : (
              <Upload className="size-4" aria-hidden />
            )}
            {uploading ? "Uploading" : "Upload & index"}
          </Button>
        </div>
      </div>
    </section>
  );
}