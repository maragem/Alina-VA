export const UAT_SHEET_NAME = "GoldenStandards_FinalUAT";
export const FINAL_UAT_SHEET_NAME = "Final UAT";

export type UatTestCase = Readonly<{
  groupOfDocuments: string;
  id: string;
  testType: string;
  question: string;
  expectedAnswer: string;
  expectedSource: string;
  expectedCitation: string;
  priority: string;
  owner: string;
}>;

export type UatResultStatus = "pass" | "needs-review" | "fail" | "error";
export type UatManualOverride = Exclude<UatResultStatus, "error"> | null;

// "needs-review" is displayed to users as "Partial pass".
export const STATUS_LABELS: Record<UatResultStatus, string> = {
  pass: "Pass",
  "needs-review": "Partial pass",
  fail: "Fail",
  error: "Error",
};

// Reference row from the golden standards sheet, joined to a UatTestCase by Question ID.
export type UatFinalReference = Readonly<{
  id: string;
  previousAnswer: string;
  comment: string;
  previousResult: string;
  correctDocumentCitation: string;
  documentsUsed: string;
}>;

export type UatEvaluationResult = Readonly<{
  testCase: UatTestCase;
  reference: UatFinalReference | null;
  actualAnswer: string;
  actualSources: readonly string[];
  answerScore: number;
  sourceScore: number;
  overallScore: number;
  automaticStatus: UatResultStatus;
  manualOverride: UatManualOverride;
  latencyMs: number;
  target: "proxy" | "direct";
  error?: string;
}>;

export type UatSummary = Readonly<{
  total: number;
  passed: number;
  needsReview: number;
  failed: number;
  errors: number;
  passRate: number;
  averageScore: number;
}>;

const REQUIRED_HEADERS = ["Question ID", "Question", "Expected Answer"] as const;

const OPTIONAL_HEADERS = {
  groupOfDocuments: "Group of Documents",
  testType: "Test Type",
  expectedSource: "Expected Source (Document / Page / Section)",
  expectedCitation: "Expected Citation",
  priority: "Priority",
  owner: "Business Owner / Tech Team",
} as const;

const FINAL_UAT_REQUIRED_HEADERS = ["Question ID"] as const;

const FINAL_UAT_OPTIONAL_HEADERS = {
  previousAnswer: "Answer by ALINA",
  comment: "Comment",
  previousResult: "Final UAT Result",
  correctDocumentCitation: "Correct Document Citation",
  documentsUsed: "Documents used",
} as const;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "was",
  "were",
  "will",
  "with",
]);

function normalizeHeader(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function cell(row: readonly string[], index: number | undefined): string {
  return index === undefined ? "" : (row[index] ?? "").trim();
}

export function parseUatRows(rows: readonly (readonly string[])[]): UatTestCase[] {
  if (rows.length === 0) throw new Error("The selected worksheet is empty.");

  const headerIndexes = new Map(
    rows[0].map((header, index) => [normalizeHeader(header), index]),
  );
  const missingHeaders = REQUIRED_HEADERS.filter(
    (header) => !headerIndexes.has(header),
  );

  if (missingHeaders.length > 0) {
    throw new Error(`Missing required columns: ${missingHeaders.join(", ")}.`);
  }

  const requiredIndex = (header: (typeof REQUIRED_HEADERS)[number]) =>
    headerIndexes.get(header);
  const optionalIndex = (header: string) => headerIndexes.get(header);

  return rows
    .slice(1)
    .map((row) => ({
      groupOfDocuments: cell(row, optionalIndex(OPTIONAL_HEADERS.groupOfDocuments)),
      id: cell(row, requiredIndex("Question ID")),
      testType: cell(row, optionalIndex(OPTIONAL_HEADERS.testType)),
      question: cell(row, requiredIndex("Question")),
      expectedAnswer: cell(row, requiredIndex("Expected Answer")),
      expectedSource: cell(row, optionalIndex(OPTIONAL_HEADERS.expectedSource)),
      expectedCitation: cell(row, optionalIndex(OPTIONAL_HEADERS.expectedCitation)),
      priority: cell(row, optionalIndex(OPTIONAL_HEADERS.priority)),
      owner: cell(row, optionalIndex(OPTIONAL_HEADERS.owner)),
    }))
    .filter((testCase) => testCase.id || testCase.question)
    .filter((testCase) => testCase.question)
    .map((testCase, index) => {
      if (!testCase.id) {
        throw new Error(
          `Row ${index + 2} must include a Question ID and Question.`,
        );
      }
      return testCase;
    });
}

export function parseFinalUatRows(
  rows: readonly (readonly string[])[],
): UatFinalReference[] {
  if (rows.length === 0) return [];

  const headerIndexes = new Map(
    rows[0].map((header, index) => [normalizeHeader(header), index]),
  );
  const missingHeaders = FINAL_UAT_REQUIRED_HEADERS.filter(
    (header) => !headerIndexes.has(header),
  );
  if (missingHeaders.length > 0) return [];

  const requiredIndex = (header: (typeof FINAL_UAT_REQUIRED_HEADERS)[number]) =>
    headerIndexes.get(header);
  const optionalIndex = (header: string) => headerIndexes.get(header);

  return rows
    .slice(1)
    .map((row) => ({
      id: cell(row, requiredIndex("Question ID")),
      previousAnswer: cell(row, optionalIndex(FINAL_UAT_OPTIONAL_HEADERS.previousAnswer)),
      comment: cell(row, optionalIndex(FINAL_UAT_OPTIONAL_HEADERS.comment)),
      previousResult: cell(row, optionalIndex(FINAL_UAT_OPTIONAL_HEADERS.previousResult)),
      correctDocumentCitation: cell(
        row,
        optionalIndex(FINAL_UAT_OPTIONAL_HEADERS.correctDocumentCitation),
      ),
      documentsUsed: cell(row, optionalIndex(FINAL_UAT_OPTIONAL_HEADERS.documentsUsed)),
    }))
    .filter(
      (reference) =>
        reference.id &&
        (reference.previousAnswer ||
          reference.comment ||
          reference.previousResult ||
          reference.correctDocumentCitation ||
          reference.documentsUsed),
    );
}

// Last row wins if a Question ID repeats across UAT rounds.
export function buildFinalUatReferenceMap(
  references: readonly UatFinalReference[],
): Map<string, UatFinalReference> {
  return new Map(references.map((reference) => [reference.id, reference]));
}

function tokens(value: string): Set<string> {
  return new Set(
    value
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token)),
  );
}

function coverageScore(expected: string, actual: string): number {
  const expectedTokens = tokens(expected);
  if (expectedTokens.size === 0) return actual.trim() ? 1 : 0;
  const actualTokens = tokens(actual);
  const matches = [...expectedTokens].filter((token) => actualTokens.has(token));
  return matches.length / expectedTokens.size;
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function scoreUatResult(
  testCase: UatTestCase,
  actualAnswer: string,
  actualSources: readonly string[],
  reference: UatFinalReference | null = null,
): Pick<
  UatEvaluationResult,
  "answerScore" | "sourceScore" | "overallScore" | "automaticStatus"
> {
  // Similarity is judged against the ground-truth answer plus the previous ALINA answer and
  // reviewer comment recorded in the golden standards workbook, so regressions from a prior good answer are caught too.
  const expectedAnswerText = [
    testCase.expectedAnswer,
    reference?.previousAnswer,
    reference?.comment,
  ]
    .filter(Boolean)
    .join(" ");
  const expectedSourceText = [
    testCase.expectedSource,
    reference?.correctDocumentCitation,
    reference?.documentsUsed,
  ]
    .filter(Boolean)
    .join(" ");

  const answerScore = roundScore(coverageScore(expectedAnswerText, actualAnswer));
  const sourceScore = expectedSourceText
    ? roundScore(coverageScore(expectedSourceText, actualSources.join(" ")))
    : actualSources.length > 0
      ? 1
      : 0;
  const overallScore = roundScore(answerScore * 0.75 + sourceScore * 0.25);
  const automaticStatus: UatResultStatus =
    overallScore >= 0.7 && answerScore >= 0.6
      ? "pass"
      : overallScore >= 0.45
        ? "needs-review"
        : "fail";

  return { answerScore, sourceScore, overallScore, automaticStatus };
}

export function effectiveStatus(result: UatEvaluationResult): UatResultStatus {
  return result.error ? "error" : (result.manualOverride ?? result.automaticStatus);
}

export function summarizeUatResults(
  results: readonly UatEvaluationResult[],
): UatSummary {
  const statuses = results.map(effectiveStatus);
  const scoredResults = results.filter((result) => !result.error);
  const passed = statuses.filter((status) => status === "pass").length;

  return {
    total: results.length,
    passed,
    needsReview: statuses.filter((status) => status === "needs-review").length,
    failed: statuses.filter((status) => status === "fail").length,
    errors: statuses.filter((status) => status === "error").length,
    passRate: results.length ? roundScore(passed / results.length) : 0,
    averageScore: scoredResults.length
      ? roundScore(
          scoredResults.reduce((sum, result) => sum + result.overallScore, 0) /
            scoredResults.length,
        )
      : 0,
  };
}

function csvCell(value: string | number): string {
  const text = String(value).replaceAll('"', '""');
  return `"${text}"`;
}

export function resultsToCsv(results: readonly UatEvaluationResult[]): string {
  const header = [
    "Question ID",
    "Test Type",
    "Priority",
    "Question",
    "Expected Answer",
    "Previous Answer",
    "Actual Answer",
    "Expected Source",
    "Documents Used",
    "Actual Sources",
    "Comment",
    "Previous Result",
    "Answer Score",
    "Source Score",
    "Overall Score",
    "Automatic Status",
    "Manual Override",
    "Final Status",
    "Target",
    "Latency (ms)",
    "Error",
  ];
  const lines = results.map((result) =>
    [
      result.testCase.id,
      result.testCase.testType,
      result.testCase.priority,
      result.testCase.question,
      result.testCase.expectedAnswer,
      result.reference?.previousAnswer ?? "",
      result.actualAnswer,
      result.testCase.expectedSource,
      result.reference?.documentsUsed ?? "",
      result.actualSources.join("\n"),
      result.reference?.comment ?? "",
      result.reference?.previousResult ?? "",
      result.answerScore,
      result.sourceScore,
      result.overallScore,
      STATUS_LABELS[result.automaticStatus],
      result.manualOverride ? STATUS_LABELS[result.manualOverride] : "",
      STATUS_LABELS[effectiveStatus(result)],
      result.target,
      result.latencyMs,
      result.error ?? "",
    ].map(csvCell).join(","),
  );

  return [header.map(csvCell).join(","), ...lines].join("\r\n");
}

export function summaryToMarkdown(
  results: readonly UatEvaluationResult[],
  generatedAt = new Date(),
): string {
  const summary = summarizeUatResults(results);
  const failures = results
    .filter((result) => effectiveStatus(result) !== "pass")
    .sort((first, second) => first.overallScore - second.overallScore)
    .slice(0, 10);

  return [
    "# ALINA UAT Evaluation",
    "",
    `Generated: ${generatedAt.toISOString()}`,
    "",
    "## Summary",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Questions | ${summary.total} |`,
    `| Passed | ${summary.passed} |`,
    `| Partial pass | ${summary.needsReview} |`,
    `| Failed | ${summary.failed} |`,
    `| Errors | ${summary.errors} |`,
    `| Pass rate | ${(summary.passRate * 100).toFixed(1)}% |`,
    `| Average score | ${(summary.averageScore * 100).toFixed(1)}% |`,
    "",
    "## Questions Requiring Attention",
    "",
    "| ID | Status | Score | Question |",
    "| --- | --- | ---: | --- |",
    ...failures.map(
      (result) =>
        `| ${result.testCase.id} | ${STATUS_LABELS[effectiveStatus(result)]} | ${(result.overallScore * 100).toFixed(1)}% | ${result.testCase.question.replaceAll("|", "\\|").replaceAll("\n", " ")} |`,
    ),
    failures.length === 0 ? "| - | - | - | No failures |" : "",
    "",
    "> Scores are heuristic indicators. Manual overrides represent the final reviewed status.",
    "",
  ].join("\n");
}