"use client";

import { useRef, useState } from "react";
import { BookMarked, Check, Copy, FileText, RefreshCw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { FileTypeIcon } from "@/components/FileTypeIcon";
import type { ChatMessage as ChatMessageType } from "./hooks/useChat";
import type { ChatStatus as HaystackStatus } from "./hooks/useHaystackStream";
import { ChatStatus } from "./ChatStatus";
import { FeedbackButtons } from "./FeedbackButtons";
import { SaveToWikiDialog } from "./SaveToWikiDialog";
import { SourceDocumentList } from "./SourceDocumentList";
import {
  citationNumberFromHref,
  createCitationPlugin,
  renumberCitationTokens,
} from "./citationMarkdown";

type ChatMessageProps = {
  activeToolName?: string | null;
  message: ChatMessageType;
  streamStatus: HaystackStatus;
  onRetry: (messageId: string) => void;
  /** Question this answer replies to, used to title a saved wiki page. */
  question?: string;
  /** Knowledge base the "Save to wiki" action proposes; null = global. */
  wikiProjectId?: string | null;
  wikiProjectName?: string;
};

type CitationLabel = Readonly<{
  fileName: string;
  sectionNumber: number;
}>;

type SelectedCitation = Readonly<{
  number: number;
  quote?: string;
}>;

function citationLabels(
  sources: ChatMessageType["sources"],
): Map<number, CitationLabel> {
  const labels = new Map<number, CitationLabel>();
  const sectionsByFile = new Map<string, number>();

  for (const source of sources ?? []) {
    const fileName = source.fileName?.trim() || source.title.trim() || "Source";
    const fileKey = source.fileId || fileName.toLocaleLowerCase("en-GB");
    const sectionNumber = (sectionsByFile.get(fileKey) ?? 0) + 1;
    sectionsByFile.set(fileKey, sectionNumber);
    for (const citationNumber of source.citationNumbers ?? []) {
      labels.set(citationNumber, { fileName, sectionNumber });
    }
  }

  return labels;
}

export function ChatMessage({
  activeToolName,
  message,
  streamStatus,
  onRetry,
  question,
  wikiProjectId = null,
  wikiProjectName,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const [selectedCitation, setSelectedCitation] = useState<SelectedCitation>();
  const [saveToWikiOpen, setSaveToWikiOpen] = useState(false);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (message.role === "user") {
    return (
      <article aria-label="Your message" className="flex animate-message-in flex-col items-end gap-1">
        {message.attachments?.length ? (
          <ul className="flex flex-wrap justify-end gap-1.5" aria-label="Attached files">
            {message.attachments.map((attachment) => (
              <li
                key={attachment.fileId}
                className="inline-flex max-w-56 items-center gap-1 truncate rounded-sm border border-(--ec-line) bg-slate-50 px-2 py-1 text-xs text-(--ec-ink)"
                title={attachment.fileName}
              >
                <FileTypeIcon
                  fileName={attachment.fileName}
                  className="size-3 shrink-0"
                />
                <span className="truncate">{attachment.fileName}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="max-w-[min(42rem,90%)] rounded-md bg-(--ec-blue) px-4 py-3 text-sm leading-6 text-white shadow-sm">
          <p className="whitespace-pre-wrap">{message.text}</p>
        </div>
      </article>
    );
  }

  const canRetry =
    message.status === "error" || message.status === "cancelled";
  const showStatus =
    message.status === "pending" ||
    message.status === "streaming" ||
    message.status === "cancelled" ||
    message.status === "error";
  const citationNumbers = new Set(
    message.sources?.flatMap((source) => source.citationNumbers ?? []),
  );
  const citationLabelByNumber = citationLabels(message.sources);
  const displayText = renumberCitationTokens(message.text);

  async function copyAnswer(): Promise<void> {
    const textToCopy = renumberCitationTokens(message.text);
    if (!textToCopy) return;
    await navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    if (copyResetRef.current) clearTimeout(copyResetRef.current);
    copyResetRef.current = setTimeout(() => setCopied(false), 1800);
  }

  return (
    <article
      aria-label="ALINA response"
      className="group max-w-4xl animate-message-in"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-sm bg-(--ec-yellow) font-serif text-sm font-bold text-(--ec-blue)">
          A
        </span>
        <p className="text-sm font-semibold text-(--ec-blue)">ALINA</p>
      </div>

      {displayText ? (
        <div className="prose prose-slate max-w-none text-base leading-relaxed prose-headings:font-sans prose-h1:text-2xl prose-h1:font-bold prose-h2:text-xl prose-h2:font-bold prose-h3:text-lg prose-h3:font-bold prose-headings:text-(--ec-blue) prose-headings:mt-4 prose-headings:mb-3 prose-p:text-[15px] prose-p:leading-7 prose-a:text-(--ec-blue) prose-a:underline prose-code:wrap-break-word prose-pre:max-w-full prose-pre:overflow-x-auto prose-table:block prose-table:max-w-full prose-table:overflow-x-auto">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, createCitationPlugin(citationNumbers)]}
            components={{
              a: ({ children, href, node, title, ...props }) => {
                const citationNumber = citationNumberFromHref(href);
                const quote =
                  title ??
                  (props as Record<string, unknown>)["data-citation-quote"] ??
                  (node?.properties as Record<string, unknown> | undefined)?.[
                    "data-citation-quote"
                  ];
                const citationLabel = citationNumber
                  ? citationLabelByNumber.get(citationNumber)
                  : undefined;
                const accessibleLabel = citationLabel
                  ? `${citationLabel.fileName}, reference ${citationLabel.sectionNumber}`
                  : `Reference ${citationNumber}`;
                return citationNumber && citationLabel ? (
                  <button
                    type="button"
                    className="not-prose mx-0.5 inline-flex max-w-full items-center gap-1 rounded-sm border border-blue-300 bg-blue-100 px-1.5 py-0.5 align-baseline text-[11px] font-semibold leading-4 text-(--ec-blue) shadow-xs hover:border-blue-400 hover:bg-blue-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ec-yellow) focus-visible:ring-offset-1"
                    aria-label={`Open ${accessibleLabel}`}
                    title={accessibleLabel}
                    data-citation-quote={
                      typeof quote === "string" ? quote : undefined
                    }
                    onClick={() =>
                      setSelectedCitation({
                        number: citationNumber,
                        quote: typeof quote === "string" ? quote : undefined,
                      })
                    }
                  >
                    <FileText className="size-3 shrink-0" aria-hidden="true" />
                    <span className="max-w-40 truncate">
                      {citationLabel.fileName}
                    </span>
                    <span className="shrink-0 text-slate-500">
                      Reference {citationLabel.sectionNumber}
                    </span>
                  </button>
                ) : (
                  <a
                    {...props}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {children}
                  </a>
                );
              },
            }}
          >
            {displayText}
          </ReactMarkdown>
        </div>
      ) : null}

      {showStatus ? (
        <ChatStatus
          activeToolName={activeToolName}
          messageStatus={message.status ?? "pending"}
          streamStatus={streamStatus}
          errorMessage={message.errorMessage}
        />
      ) : null}

      {message.sources?.length ? (
        <SourceDocumentList
          sources={message.sources}
          selectedCitation={selectedCitation}
          onSelectedCitationChange={setSelectedCitation}
        />
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-1">
          {message.text ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void copyAnswer()}
              aria-label={copied ? "Answer copied" : "Copy answer"}
              title={copied ? "Copied" : "Copy answer"}
              className="h-8 px-2 text-slate-600"
            >
              {copied ? (
                <Check className="size-4 text-emerald-700" aria-hidden="true" />
              ) : (
                <Copy className="size-4" aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          ) : null}
          {canRetry ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRetry(message.id)}
              className="h-8 px-2 text-(--ec-blue)"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Retry
            </Button>
          ) : null}
          {message.status === "complete" && message.text ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSaveToWikiOpen(true)}
              className="h-8 px-2 text-(--ec-blue)"
              title="Save this grounded answer as a draft knowledge-base page"
            >
              <BookMarked className="size-4" aria-hidden="true" />
              Save to wiki
            </Button>
          ) : null}
        </div>
        <SaveToWikiDialog
          open={saveToWikiOpen}
          answerText={displayText}
          sources={message.sources ?? []}
          question={question}
          messageId={message.id}
          projectId={wikiProjectId}
          projectName={wikiProjectName}
          onClose={() => setSaveToWikiOpen(false)}
        />
        {message.status === "complete" && message.feedback ? (
          <FeedbackButtons
            queryId={message.feedback.queryId}
            resultId={message.feedback.resultId}
          />
        ) : null}
      </div>
    </article>
  );
}