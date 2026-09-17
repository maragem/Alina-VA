"use client";

import { Button } from "@/components/ui/button";
import {
  collectHaystackStream,
  type CollectedStreamResult,
} from "@/components/global/hooks/useHaystackStream";
import {
  buildFinalUatReferenceMap,
  effectiveStatus,
  FINAL_UAT_SHEET_NAME,
  parseFinalUatRows,
  parseUatRows,
  resultsToCsv,
  scoreUatResult,
  STATUS_LABELS,
  summaryToMarkdown,
  summarizeUatResults,
  UAT_SHEET_NAME,
  type UatEvaluationResult,
  type UatFinalReference,
  type UatManualOverride,
  type UatTestCase,
} from "@/lib/uatEvaluation";
import {
  ClipboardCopy,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  Play,
  Square,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";

type Worksheet = Readonly<{
  name: string;
  rows: string[][];
}>;

type RunTarget = "direct";
type ResultFilter = "all" | "attention";
type Concurrency = 2 | 4 | 6;

function valueToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function sourceLabels(result: CollectedStreamResult): string[] {
  return Array.from(
    new Set(
      result.sources.map(
        (source) =>
          source.fileName || source.title || source.locationLabel || "Document",
      ),
    ),
  );
}

function downloadText(content: string, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function statusClass(status: ReturnType<typeof effectiveStatus>): string {
  if (status === "pass") return "bg-emerald-100 text-emerald-800";
  if (status === "needs-review") return "bg-amber-100 text-amber-900";
  return "bg-rose-100 text-rose-800";
}

function referenceRowsForSheet(
  primarySheet: Worksheet,
  allSheets: readonly Worksheet[],
): { references: UatFinalReference[]; sheetName: string | null } {
  const primaryReferences = parseFinalUatRows(primarySheet.rows);
  if (primaryReferences.length > 0) {
    return { references: primaryReferences, sheetName: primarySheet.name };
  }

  const fallbackSheet = allSheets.find(
    (worksheet) => worksheet.name === FINAL_UAT_SHEET_NAME,
  );
  if (!fallbackSheet) return { references: [], sheetName: null };

  return {
    references: parseFinalUatRows(fallbackSheet.rows),
    sheetName: fallbackSheet.name,
  };
}

export function UatEvaluation() {
  const [fileName, setFileName] = useState("");
  const [worksheets, setWorksheets] = useState<Worksheet[]>([]);
  const [selectedSheet, setSelectedSheet] = useState(UAT_SHEET_NAME);
  const [testCases, setTestCases] = useState<UatTestCase[]>([]);
  const [referenceMap, setReferenceMap] = useState<Map<string, UatFinalReference>>(
    new Map(),
  );
  const [enabledIds, setEnabledIds] = useState<string[]>([]);
  const target: RunTarget = "direct";
  const [concurrency, setConcurrency] = useState<Concurrency>(4);
  const [results, setResults] = useState<UatEvaluationResult[]>([]);
  const [filter, setFilter] = useState<ResultFilter>("all");
  const [completedCount, setCompletedCount] = useState(0);
  const [runTotal, setRunTotal] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [message, setMessage] = useState("Load the golden dataset to begin.");
  const abortRef = useRef<AbortController | null>(null);

  async function loadWorkbook(blob: Blob, name: string): Promise<void> {
    try {
      const [buffer, xlsx] = await Promise.all([blob.arrayBuffer(), import("xlsx")]);
      const workbook = xlsx.read(buffer, {
        type: "array",
        cellFormula: false,
        cellHTML: false,
        cellText: true,
      });
      const parsedWorksheets = workbook.SheetNames.map((sheetName) => ({
        name: sheetName,
        rows: xlsx.utils
          .sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
            header: 1,
            raw: false,
            defval: "",
            blankrows: false,
          })
          .map((row) => row.map(valueToString)),
      }));
      const initialSheet = parsedWorksheets.find(
        (worksheet) => worksheet.name === UAT_SHEET_NAME,
      ) ?? parsedWorksheets[0];
      if (!initialSheet) throw new Error("The workbook contains no worksheets.");
      const parsedCases = parseUatRows(initialSheet.rows);
      const referenceRows = referenceRowsForSheet(initialSheet, parsedWorksheets);
      const references = buildFinalUatReferenceMap(
        referenceRows.references,
      );

      setFileName(name);
      setWorksheets(parsedWorksheets);
      setSelectedSheet(initialSheet.name);
      setTestCases(parsedCases);
      setReferenceMap(references);
      setEnabledIds(parsedCases.map((testCase) => testCase.id));
      setResults([]);
      setCompletedCount(0);
      setRunTotal(0);
      setMessage(
        `${parsedCases.length} questions ready from ${initialSheet.name}` +
          (references.size > 0
            ? ` (${references.size} matched against "${referenceRows.sheetName}").`
            : "."),
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The workbook could not be read.",
      );
    }
  }

  async function loadGoldenDataset(): Promise<void> {
    setMessage("Loading golden dataset...");
    const response = await fetch("/api/uat/dataset");
    if (!response.ok) {
      setMessage("The golden dataset could not be loaded.");
      return;
    }
    await loadWorkbook(await response.blob(), "Golden_DataSet.xlsx");
  }

  function chooseSheet(name: string): void {
    const worksheet = worksheets.find((candidate) => candidate.name === name);
    if (!worksheet) return;

    try {
      const parsedCases = parseUatRows(worksheet.rows);
      const referenceRows = referenceRowsForSheet(worksheet, worksheets);
      const references = buildFinalUatReferenceMap(referenceRows.references);
      setSelectedSheet(name);
      setTestCases(parsedCases);
      setReferenceMap(references);
      setEnabledIds(parsedCases.map((testCase) => testCase.id));
      setResults([]);
      setCompletedCount(0);
      setRunTotal(0);
      setMessage(
        `${parsedCases.length} questions ready from ${name}` +
          (references.size > 0
            ? ` (${references.size} matched against "${referenceRows.sheetName}").`
            : "."),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Invalid worksheet.");
    }
  }

  async function runEvaluation(): Promise<void> {
    const enabledTestCases = testCases.filter((testCase) =>
      enabledIds.includes(testCase.id),
    );
    if (enabledTestCases.length === 0 || isRunning) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setIsRunning(true);
    setResults([]);
    setCompletedCount(0);
    setRunTotal(enabledTestCases.length);
    setMessage(
      `Running ${enabledTestCases.length} questions with ${concurrency} parallel requests...`,
    );
    const nextResults: Array<UatEvaluationResult | undefined> = Array(
      enabledTestCases.length,
    );
    const url = "/api/uat/search-stream";
    let nextIndex = 0;
    let completed = 0;

    async function evaluateTestCase(
      testCase: UatTestCase,
    ): Promise<UatEvaluationResult | undefined> {
      const startedAt = performance.now();
      const reference = referenceMap.get(testCase.id) ?? null;

      try {
        const streamResult = await collectHaystackStream(
          url,
          testCase.question,
          controller.signal,
        );
        const actualSources = sourceLabels(streamResult);
        const score = scoreUatResult(
          testCase,
          streamResult.text,
          actualSources,
          reference,
        );
        return {
          testCase,
          reference,
          actualAnswer: streamResult.text,
          actualSources,
          ...score,
          manualOverride: null,
          latencyMs: Math.round(performance.now() - startedAt),
          target,
        };
      } catch (error) {
        if (controller.signal.aborted) return undefined;
        return {
          testCase,
          reference,
          actualAnswer: "",
          actualSources: [],
          answerScore: 0,
          sourceScore: 0,
          overallScore: 0,
          automaticStatus: "error",
          manualOverride: null,
          latencyMs: Math.round(performance.now() - startedAt),
          target,
          error: error instanceof Error ? error.message : "Request failed.",
        };
      }
    }

    async function runWorker(): Promise<void> {
      while (!controller.signal.aborted) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= enabledTestCases.length) return;

        const result = await evaluateTestCase(enabledTestCases[index]);
        if (!result) return;
        nextResults[index] = result;
        completed += 1;
        setResults(
          nextResults.filter(
            (candidate): candidate is UatEvaluationResult =>
              candidate !== undefined,
          ),
        );
        setCompletedCount(completed);
      }
    }

    await Promise.all(
      Array.from(
        { length: Math.min(concurrency, enabledTestCases.length) },
        () => runWorker(),
      ),
    );

    const wasCancelled = controller.signal.aborted;
    abortRef.current = null;
    setIsRunning(false);
    setMessage(
      wasCancelled
        ? `Run cancelled after ${completed} questions. Partial results are exportable.`
        : `Run completed: ${completed} questions evaluated.`,
    );
  }

  function cancelRun(): void {
    abortRef.current?.abort();
  }

  function toggleTestCase(id: string): void {
    setEnabledIds((current) =>
      current.includes(id)
        ? current.filter((candidate) => candidate !== id)
        : [...current, id],
    );
  }

  function setOverride(id: string, override: UatManualOverride): void {
    setResults((current) =>
      current.map((result) =>
        result.testCase.id === id
          ? { ...result, manualOverride: override }
          : result,
      ),
    );
  }

  const summary = summarizeUatResults(results);
  const enabledCount = enabledIds.length;
  const visibleResults = results.filter(
    (result) => filter === "all" || effectiveStatus(result) !== "pass",
  );
  const dateStamp = new Date().toISOString().slice(0, 10);

  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-[#f5f7fa]" aria-label="UAT evaluation">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <header className="border-b-2 border-(--ec-blue) pb-5">
          <p className="text-xs font-bold uppercase text-(--ec-blue)">Quality evaluation</p>
          <h2 className="mt-1 font-serif text-2xl font-bold text-(--ec-ink)">Golden dataset benchmark</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-(--ec-mute)">
            Run source-grounded UAT questions, review heuristic scores, and export results for reporting.
          </p>
        </header>

        <div className="mt-5 grid gap-4 border border-(--ec-line) bg-white p-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_10rem_auto] xl:items-end">
          <div>
            <label className="text-xs font-bold uppercase text-slate-600" htmlFor="uat-sheet">Worksheet</label>
            <select
              id="uat-sheet"
              className="ec-input mt-1 h-10"
              value={selectedSheet}
              onChange={(event) => chooseSheet(event.target.value)}
              disabled={worksheets.length === 0 || isRunning}
            >
              {worksheets.length === 0 ? <option>{UAT_SHEET_NAME}</option> : null}
              {worksheets.map((worksheet) => <option key={worksheet.name}>{worksheet.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold uppercase text-slate-600" htmlFor="uat-concurrency">Parallel requests</label>
            <select
              id="uat-concurrency"
              className="ec-input mt-1 h-10"
              value={concurrency}
              onChange={(event) =>
                setConcurrency(Number(event.target.value) as Concurrency)
              }
              disabled={isRunning}
            >
              <option value={2}>2</option>
              <option value={4}>4</option>
              <option value={6}>6</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={loadGoldenDataset} disabled={isRunning}>
              <FileSpreadsheet className="size-4" aria-hidden="true" />
              Load golden dataset
            </Button>
            <label className="relative inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-(--ec-line) bg-white px-4 py-2 text-sm font-medium text-(--ec-ink) transition-all hover:bg-slate-50 focus-within:ring-2 focus-within:ring-(--ec-yellow) focus-within:ring-offset-2">
              <Upload className="size-4" aria-hidden="true" />
              Upload
              <input
                className="absolute inset-0 cursor-pointer opacity-0"
                type="file"
                accept=".xlsx,.xls,.csv"
                aria-label="Upload evaluation workbook"
                disabled={isRunning}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void loadWorkbook(file, file.name);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-l-4 border-(--ec-yellow) bg-white px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-(--ec-ink)">{message}</p>
            <p className="mt-0.5 text-xs text-(--ec-mute)">{fileName || "No workbook loaded"}</p>
          </div>
          <div className="flex gap-2">
            {isRunning ? (
              <Button variant="outline" onClick={cancelRun}>
                <Square className="size-4" aria-hidden="true" /> Stop {completedCount}/{runTotal}
              </Button>
            ) : (
              <Button onClick={runEvaluation} disabled={enabledCount === 0}>
                <Play className="size-4" aria-hidden="true" /> Run {enabledCount || ""} questions
              </Button>
            )}
          </div>
        </div>

        {isRunning ? (
          <div className="mt-3 h-2 overflow-hidden bg-slate-200" role="progressbar" aria-valuenow={completedCount} aria-valuemin={0} aria-valuemax={runTotal}>
            <div className="h-full bg-(--ec-blue) transition-[width]" style={{ width: `${(completedCount / runTotal) * 100}%` }} />
          </div>
        ) : null}

        {testCases.length > 0 ? (
          <section className="mt-6" aria-labelledby="dataset-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 id="dataset-heading" className="font-serif text-lg font-bold text-(--ec-blue)">Test dataset</h3>
                <p className="text-sm text-(--ec-mute)">{enabledCount} of {testCases.length} questions enabled</p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isRunning || enabledCount === testCases.length}
                  onClick={() => setEnabledIds(testCases.map((testCase) => testCase.id))}
                >
                  Enable all
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isRunning || enabledCount === 0}
                  onClick={() => setEnabledIds([])}
                >
                  Disable all
                </Button>
              </div>
            </div>
            <div className="mt-3 max-h-96 overflow-auto border border-(--ec-line) bg-white">
              <table className="min-w-full border-collapse text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-100 text-xs uppercase text-slate-600">
                  <tr>
                    <th className="w-12 px-3 py-3 text-center">Run</th>
                    <th className="px-3 py-3">ID</th>
                    <th className="px-3 py-3">Type</th>
                    <th className="min-w-80 px-3 py-3">Question</th>
                    <th className="min-w-96 px-3 py-3">Expected</th>
                  </tr>
                </thead>
                <tbody>
                  {testCases.map((testCase) => (
                    <tr key={testCase.id} className="border-t border-(--ec-line) align-top">
                      <td className="px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          className="size-4 accent-(--ec-blue)"
                          checked={enabledIds.includes(testCase.id)}
                          disabled={isRunning}
                          onChange={() => toggleTestCase(testCase.id)}
                          aria-label={`Enable ${testCase.id}`}
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 font-bold text-(--ec-blue)">{testCase.id}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-600">{testCase.testType || "-"}</td>
                      <td className="px-3 py-3 font-semibold text-(--ec-ink)">{testCase.question}</td>
                      <td className="px-3 py-3 text-xs whitespace-pre-wrap text-slate-600">{testCase.expectedAnswer}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {results.length > 0 ? (
          <>
            <div className="mt-6 grid grid-cols-2 gap-px bg-(--ec-line) border border-(--ec-line) md:grid-cols-5">
              {[
                ["Pass rate", `${(summary.passRate * 100).toFixed(1)}%`],
                ["Passed", summary.passed],
                ["Partial pass", summary.needsReview],
                ["Failed", summary.failed],
                ["Average score", `${(summary.averageScore * 100).toFixed(1)}%`],
              ].map(([label, value]) => (
                <div key={label} className="bg-white px-4 py-3">
                  <p className="text-xs font-bold uppercase text-slate-500">{label}</p>
                  <p className="mt-1 text-xl font-bold text-(--ec-blue)">{value}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-1" aria-label="Result filter">
                <Button size="sm" variant={filter === "all" ? "secondary" : "ghost"} onClick={() => setFilter("all")}>All</Button>
                <Button size="sm" variant={filter === "attention" ? "secondary" : "ghost"} onClick={() => setFilter("attention")}>Needs attention</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => downloadText(resultsToCsv(results), `alina-uat-${dateStamp}.csv`, "text/csv;charset=utf-8")}>
                  <Download className="size-4" aria-hidden="true" /> CSV
                </Button>
                <Button size="sm" variant="outline" onClick={() => downloadText(summaryToMarkdown(results), `alina-uat-summary-${dateStamp}.md`, "text/markdown;charset=utf-8")}>
                  <Download className="size-4" aria-hidden="true" /> Markdown
                </Button>
                <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(summaryToMarkdown(results))}>
                  <ClipboardCopy className="size-4" aria-hidden="true" /> Copy summary
                </Button>
              </div>
            </div>

            <div className="mt-3 overflow-x-auto border border-(--ec-line) bg-white">
              <table className="min-w-full border-collapse text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase text-slate-600">
                  <tr>
                    <th className="px-3 py-3">ID</th>
                    <th className="min-w-72 px-3 py-3">Question</th>
                    <th className="min-w-96 px-3 py-3">Expected</th>
                    <th className="min-w-96 px-3 py-3">Previous answer</th>
                    <th className="min-w-72 px-3 py-3">Comment</th>
                    <th className="min-w-96 px-3 py-3">Actual</th>
                    <th className="px-3 py-3">Sources</th>
                    <th className="px-3 py-3 text-right">Score</th>
                    <th className="px-3 py-3">Previous result</th>
                    <th className="px-3 py-3">Final status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleResults.map((result) => {
                    const status = effectiveStatus(result);
                    return (
                      <tr key={result.testCase.id} className="border-t border-(--ec-line) align-top">
                        <td className="whitespace-nowrap px-3 py-3 font-bold text-(--ec-blue)">{result.testCase.id}</td>
                        <td className="px-3 py-3 font-semibold text-(--ec-ink)">{result.testCase.question}</td>
                        <td className="px-3 py-3 text-xs whitespace-pre-wrap text-slate-600">{result.testCase.expectedAnswer}</td>
                        <td className="px-3 py-3 text-xs whitespace-pre-wrap text-slate-600">{result.reference?.previousAnswer || "-"}</td>
                        <td className="px-3 py-3 text-xs whitespace-pre-wrap text-slate-600">{result.reference?.comment || "-"}</td>
                        <td className="px-3 py-3 text-xs whitespace-pre-wrap text-slate-700">{result.actualAnswer || result.error}</td>
                        <td className="max-w-64 px-3 py-3 text-xs text-slate-600">{result.actualSources.join("; ") || "None"}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-right font-bold">{(result.overallScore * 100).toFixed(1)}%</td>
                        <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-600">{result.reference?.previousResult || "-"}</td>
                        <td className="px-3 py-3">
                          <span className={`inline-block px-2 py-1 text-xs font-bold uppercase ${statusClass(status)}`}>{STATUS_LABELS[status]}</span>
                          {!result.error ? (
                            <select
                              className="mt-2 block w-full border border-(--ec-line) bg-white px-2 py-1 text-xs"
                              aria-label={`Manual override for ${result.testCase.id}`}
                              value={result.manualOverride ?? ""}
                              onChange={(event) => setOverride(result.testCase.id, (event.target.value || null) as UatManualOverride)}
                            >
                              <option value="">Automatic</option>
                              <option value="pass">{STATUS_LABELS.pass}</option>
                              <option value="needs-review">{STATUS_LABELS["needs-review"]}</option>
                              <option value="fail">{STATUS_LABELS.fail}</option>
                            </select>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {isRunning && completedCount === 0 ? (
          <p className="mt-6 flex items-center text-sm text-(--ec-mute)" role="status">
            <LoaderCircle className="mr-2 size-4 animate-spin" aria-hidden="true" /> Waiting for the first answer...
          </p>
        ) : null}
      </div>
    </section>
  );
}