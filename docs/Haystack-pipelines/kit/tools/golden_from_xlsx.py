"""Converts a golden-standards workbook (the ALINA UAT sheet layout) into the kit's
golden-questions YAML, so an evaluation set can live in the repository as text.

    python tools/golden_from_xlsx.py Golden_DataSet.xlsx -o ../summa/eval/golden-questions.yaml [--sheet NAME]

Required columns: "Question ID", "Question", "Expected Answer". Optional, used when present:
"Expected Source (Document / Page / Section)", "Expected Citation", "Comment", "Shape".
Headers are matched case-insensitively after whitespace normalisation. Requires openpyxl.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import yaml

REQUIRED = ["question id", "question", "expected answer"]
OPTIONAL = {
    "expected source (document / page / section)": "expected_sources",
    "expected source": "expected_sources",
    "expected citation": "expected_citation",
    "comment": "notes",
    "shape": "shape",
}


def _norm(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def convert(path: Path, sheet: str | None = None) -> dict:
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[sheet] if sheet else wb.worksheets[0]
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    if not rows:
        raise SystemExit("empty sheet")
    header = {_norm(h).lower(): i for i, h in enumerate(rows[0]) if h is not None}
    missing = [h for h in REQUIRED if h not in header]
    if missing:
        raise SystemExit(f"missing columns: {missing}; found {sorted(header)}")
    questions = []
    for row in rows[1:]:
        cell = lambda name: _norm(row[header[name]]) if name in header and header[name] < len(row) else ""
        qid, question = cell("question id"), cell("question")
        if not qid or not question:
            continue
        entry = {"id": qid, "shape": "", "question": question, "expected_answer": cell("expected answer"),
                 "expected_sources": [], "must_mention": [], "must_not": [], "notes": ""}
        for col, key in OPTIONAL.items():
            value = cell(col)
            if not value:
                continue
            if key == "expected_sources":
                entry[key] = [s.strip() for s in re.split(r"[;\n]+", value) if s.strip()]
            elif key == "expected_citation":
                entry["expected_sources"] = entry["expected_sources"] or [value]
            else:
                entry[key] = value
        questions.append(entry)
    return {"questions": questions}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("xlsx")
    ap.add_argument("-o", "--output")
    ap.add_argument("--sheet")
    args = ap.parse_args(argv)
    data = convert(Path(args.xlsx), args.sheet)
    text = ("# Golden questions converted from " + Path(args.xlsx).name + " by kit/tools/golden_from_xlsx.py.\n"
            "# Fill `shape` and `must_mention` by hand; `expected_answer` is the reference text to judge against.\n"
            + yaml.safe_dump(data, sort_keys=False, allow_unicode=True, width=100))
    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")
        print(f"wrote {args.output}: {len(data['questions'])} questions")
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
