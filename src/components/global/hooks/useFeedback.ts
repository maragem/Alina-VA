"use client";

import { useState } from "react";

export const FEEDBACK_SCORES = [
  "ACCURATE",
  "FAIRLY_ACCURATE",
  "INACCURATE",
] as const;
export type FeedbackScore = (typeof FEEDBACK_SCORES)[number];

type FeedbackResponse = Readonly<{
  feedbackId?: unknown;
  score?: unknown;
  error?: unknown;
}>;

type UseFeedbackOptions = Readonly<{
  queryId: string;
  resultId: string;
}>;

function getText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isFeedbackScore(value: unknown): value is FeedbackScore {
  return (
    typeof value === "string" &&
    FEEDBACK_SCORES.includes(value as FeedbackScore)
  );
}

export function useFeedback({ queryId, resultId }: UseFeedbackOptions) {
  const [feedbackId, setFeedbackId] = useState<string>();
  const [selectedScore, setSelectedScore] = useState<FeedbackScore>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function submitFeedback(
    score: FeedbackScore,
    comment?: string,
  ): Promise<boolean> {
    const trimmedComment = comment?.trim();

    if (isSubmitting || (score === selectedScore && !trimmedComment)) {
      return false;
    }

    setError(undefined);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/haystack/feedback", {
        method: feedbackId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          feedbackId
            ? {
                feedbackId,
                score,
                ...(trimmedComment ? { comment: trimmedComment } : {}),
              }
            : {
                queryId,
                resultId,
                score,
                ...(trimmedComment ? { comment: trimmedComment } : {}),
              },
        ),
      });
      const payload = (await response
        .json()
        .catch(() => ({}))) as FeedbackResponse;
      const returnedFeedbackId = getText(payload.feedbackId);

      if (!response.ok) {
        throw new Error(getText(payload.error) || "Could not save feedback.");
      }

      if (!returnedFeedbackId || !isFeedbackScore(payload.score)) {
        throw new Error("Haystack returned an invalid feedback response.");
      }

      setFeedbackId(returnedFeedbackId);
      setSelectedScore(payload.score);
      return true;
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Could not save feedback.",
      );
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  return { error, isSubmitting, selectedScore, submitFeedback };
}
