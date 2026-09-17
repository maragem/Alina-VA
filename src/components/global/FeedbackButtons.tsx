"use client";

import { useState } from "react";
import { LoaderCircle, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { type FeedbackScore, useFeedback } from "./hooks/useFeedback";

type FeedbackButtonsProps = Readonly<{
  queryId: string;
  resultId: string;
}>;

const FEEDBACK_OPTIONS: readonly Readonly<{
  label: string;
  score: FeedbackScore;
  icon: typeof ThumbsUp;
}>[] = [
  { label: "Helpful", score: "ACCURATE", icon: ThumbsUp },
  {
    label: "Partially helpful",
    score: "FAIRLY_ACCURATE",
    icon: ThumbsUp,
  },
  { label: "Not helpful", score: "INACCURATE", icon: ThumbsDown },
];

export function FeedbackButtons({ queryId, resultId }: FeedbackButtonsProps) {
  const { error, isSubmitting, selectedScore, submitFeedback } = useFeedback({
    queryId,
    resultId,
  });
  const [isCommentOpen, setIsCommentOpen] = useState(false);
  const [savedComment, setSavedComment] = useState("");
  const [commentDraft, setCommentDraft] = useState("");

  function openCommentEditor(): void {
    setCommentDraft(savedComment);
    setIsCommentOpen(true);
  }

  async function saveComment(): Promise<void> {
    if (!selectedScore) return;

    const saved = await submitFeedback(selectedScore, commentDraft);
    if (saved) {
      const nextComment = commentDraft.trim();
      setSavedComment(nextComment);
      setCommentDraft(nextComment);
      setIsCommentOpen(false);
    }
  }

  function cancelComment(): void {
    setCommentDraft(savedComment);
    setIsCommentOpen(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-medium text-(--ec-mute)">
          Was this answer helpful?
        </p>
        {FEEDBACK_OPTIONS.map(({ icon: Icon, label, score }) => {
          const isSelected = selectedScore === score;

          return (
            <Button
              key={score}
              variant={isSelected ? "secondary" : "outline"}
              size="sm"
              aria-label={`Mark this response as ${label.toLowerCase()}`}
              aria-pressed={isSelected}
              disabled={isSubmitting}
              onClick={() => void submitFeedback(score)}
              className={
                isSelected
                  ? "border border-(--ec-blue) text-(--ec-blue)"
                  : undefined
              }
            >
              <Icon
                className={
                  score === "FAIRLY_ACCURATE"
                    ? "size-3.5 rotate-270"
                    : "size-3.5"
                }
                aria-hidden="true"
              />
              {label}
            </Button>
          );
        })}
        {isSubmitting && (
          <LoaderCircle
            className="size-4 animate-spin text-(--ec-mute)"
            aria-label="Saving feedback"
          />
        )}
        <p className="sr-only" aria-live="polite">
          {isSubmitting
            ? "Saving feedback."
            : selectedScore
              ? "Feedback saved."
              : ""}
        </p>
      </div>
      {selectedScore ? (
        isCommentOpen ? (
          <div className="w-full max-w-2xl space-y-2 rounded-md border border-(--ec-line) bg-slate-50/70 p-3">
            <p className="text-xs font-medium text-(--ec-mute)">
              Add an optional comment
            </p>
            <Textarea
              value={commentDraft}
              onChange={(event) => setCommentDraft(event.target.value)}
              placeholder="Tell us what was missing or what could be better."
              aria-label="Feedback comment"
              rows={3}
              autoFocus
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => void saveComment()}
                disabled={isSubmitting || !commentDraft.trim()}
                className="h-8 px-3"
              >
                Save comment
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={cancelComment}
                disabled={isSubmitting}
                className="h-8 px-2 text-(--ec-blue)"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={openCommentEditor}
              disabled={isSubmitting}
              className="h-8 px-2 text-(--ec-blue)"
            >
              {savedComment.trim() ? "Edit comment" : "Add comment"}
            </Button>
          </div>
        )
      ) : null}
      {error && (
        <p className="mt-1 text-xs text-rose-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
