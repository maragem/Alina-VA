"use client";

import { Button } from "@/components/ui/button";
import { FileSpreadsheet } from "lucide-react";
import { useEffect, useState } from "react";
import { PreviewError, PreviewLoading } from "./PreviewStatus";

type Worksheet = Readonly<{
  name: string;
  rows: string[][];
}>;

const MAX_ROWS = 500;
const MAX_COLUMNS = 50;

function getCellValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toLocaleDateString("en-GB");
  return "";
}

export function XlsxFilePreview({ blob }: { blob: Blob }) {
  const [worksheets, setWorksheets] = useState<Worksheet[]>([]);
  const [selectedSheet, setSelectedSheet] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([blob.arrayBuffer(), import("xlsx")])
      .then(([buffer, xlsx]) => {
        const workbook = xlsx.read(buffer, {
          type: "array",
          cellFormula: false,
          cellHTML: false,
          cellText: true,
        });
        const parsedSheets = workbook.SheetNames.map((name) => {
          const worksheet = workbook.Sheets[name];
          const rows = xlsx.utils
            .sheet_to_json<unknown[]>(worksheet, {
              header: 1,
              raw: false,
              defval: "",
              blankrows: false,
            })
            .slice(0, MAX_ROWS)
            .map((row) => row.slice(0, MAX_COLUMNS).map(getCellValue));

          return { name, rows };
        });

        if (!cancelled) setWorksheets(parsedSheets);
      })
      .catch(() => {
        if (!cancelled) setError("This spreadsheet could not be rendered.");
      });

    return () => {
      cancelled = true;
    };
  }, [blob]);

  if (error) {
    return <PreviewError>{error}</PreviewError>;
  }

  if (worksheets.length === 0) {
    return <PreviewLoading>Reading spreadsheet…</PreviewLoading>;
  }

  const worksheet = worksheets[selectedSheet];
  const columnCount = Math.max(0, ...worksheet.rows.map((row) => row.length));
  const isTruncated = worksheet.rows.length >= MAX_ROWS || columnCount >= MAX_COLUMNS;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-(--ec-line) bg-slate-50 px-3 py-2">
        {worksheets.map((sheet, index) => (
          <Button
            key={sheet.name}
            variant={index === selectedSheet ? "secondary" : "ghost"}
            size="sm"
            className="max-w-52 shrink-0 truncate"
            onClick={() => setSelectedSheet(index)}
            title={sheet.name}
          >
            {sheet.name}
          </Button>
        ))}
      </div>

      {worksheet.rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-sm text-(--ec-mute)">
          <FileSpreadsheet className="mr-2 size-5" aria-hidden="true" />
          This worksheet is empty.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="min-w-full border-collapse text-left text-xs text-slate-800">
            <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
              <tr>
                <th className="sticky left-0 z-20 w-12 border-b border-r border-slate-200 bg-slate-100 px-3 py-2 text-right font-semibold" scope="col">
                  #
                </th>
                {Array.from({ length: columnCount }, (_, index) => (
                  <th key={index} className="min-w-36 border-b border-r border-slate-200 px-3 py-2 font-semibold" scope="col">
                    {worksheet.rows[0][index] || `Column ${index + 1}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {worksheet.rows.slice(1).map((row, rowIndex) => (
                <tr key={rowIndex} className="hover:bg-blue-50/50">
                  <th className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-3 py-2 text-right font-medium text-slate-500" scope="row">
                    {rowIndex + 2}
                  </th>
                  {Array.from({ length: columnCount }, (_, columnIndex) => (
                    <td key={columnIndex} className="max-w-120 border-b border-r border-slate-200 px-3 py-2 align-top whitespace-pre-wrap wrap-break-word">
                      {row[columnIndex]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isTruncated ? (
        <p className="shrink-0 border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          Preview shows the first {MAX_ROWS.toLocaleString()} rows and {MAX_COLUMNS} columns. Download the file to inspect the complete workbook.
        </p>
      ) : null}
    </div>
  );
}