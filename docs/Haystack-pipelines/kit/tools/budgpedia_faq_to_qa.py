"""Extracts question/answer pairs from a BUDGpedia-style FAQ page exported as PDF, in two
outputs: the kit's reference Q&A YAML (guidance for the agent) and a Markdown document with
one heading per question (to index as a citable source).

    python tools/budgpedia_faq_to_qa.py SUMMA_questions_and_answers.pdf \\
        --sections "Timeline of SUMMA releases" "Change management" ... \\
        --source "SUMMA questions and answers (BUDGpedia FAQ, 03/09/2026)" \\
        --qa-out ../qa/summa-faq.yaml --md-out ../../summa/corpus-additions/SUMMA-FAQ.md

Layout assumptions (the BUDGpedia FAQ pages): section titles on their own line; questions
numbered "N. ..." per section, numbering increasing within a section (a number that does
not increase is a list item inside an answer); a question may wrap onto the next line; some
numbered entries are topics whose sub-questions are unnumbered lines ending in "?".
Requires pypdf. Review the output: PDF text extraction loses bullets and link targets.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import yaml

QUESTION_WORDS = ("Who", "What", "Which", "How", "Is", "Are", "Can", "Could", "Do", "Does", "Will",
                  "Would", "Where", "When", "Why", "Should", "Have", "Did", "Was", "Were")
NUM = re.compile(r"^\s*(\d{1,2})\s*\.\s*(.+)$")


def extract_lines(pdf: Path, stop_at: str | None) -> list[str]:
    from pypdf import PdfReader
    lines: list[str] = []
    for page in PdfReader(str(pdf)).pages:
        for raw in (page.extract_text() or "").splitlines():
            # BUDGpedia exports carry non-breaking spaces and private-use icon glyphs
            # (e.g. the collapse chevron before each section title); drop both.
            line = re.sub(r"[\ue000-\uf8ff]", "", raw.replace("\xa0", " ")).rstrip()
            if stop_at and line.strip() == stop_at:
                return lines
            lines.append(line)
    return lines


def paragraphs(block: list[str]) -> str:
    """Joins wrapped lines, keeps blank lines as paragraph breaks."""
    out, cur = [], []
    for line in block:
        if not line.strip():
            if cur:
                out.append(" ".join(cur))
                cur = []
            continue
        cur.append(re.sub(r"\s+", " ", line.strip()))
    if cur:
        out.append(" ".join(cur))
    return "\n\n".join(p for p in out if p)


def parse(lines: list[str], sections: list[str], topic_entries: set[tuple[str, int]]) -> list[dict]:
    entries: list[dict] = []
    section, last_num = None, 0
    current: dict | None = None
    body: list[str] = []

    def close():
        nonlocal current, body
        if current is not None:
            current["answer"] = paragraphs(body)
            entries.append(current)
        current, body = None, []

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if stripped in sections:
            close()
            section, last_num = stripped, 0
            i += 1
            continue
        m = NUM.match(line)
        if section and m and int(m.group(1)) > last_num and int(m.group(1)) <= last_num + 4:
            num, text = int(m.group(1)), m.group(2).strip()
            j = i + 1
            # a wrapped question: keep joining while there is no "?" yet and the line was full width
            while not text.endswith("?") and len(lines[j - 1].strip()) > 60 and j < len(lines) \
                    and lines[j].strip() and not NUM.match(lines[j]) and not text.endswith((".", ":")):
                text += " " + lines[j].strip()
                j += 1
            close()
            last_num = num
            current = {"section": section, "number": num, "question": re.sub(r"\s+", " ", text),
                       "topic": (section, num) in topic_entries}
            i = j
            continue
        if current and current.get("topic"):
            # unnumbered sub-question (possibly wrapped onto the next line)
            cand = stripped
            k = i
            if cand and cand.split(" ")[0].rstrip(",") in QUESTION_WORDS and "?" not in cand \
                    and len(cand) > 60 and i + 1 < len(lines) and lines[i + 1].strip().endswith("?"):
                cand = cand + " " + lines[i + 1].strip()
                k = i + 1
            if cand.endswith("?") and cand.split(" ")[0].rstrip(",") in QUESTION_WORDS and len(cand) < 220:
                # the first sub-question hangs off the numbered topic heading; later ones inherit its title
                topic_title = current.get("topic_title") or current["question"]
                close()
                current = {"section": section, "number": last_num, "question": re.sub(r"\s+", " ", cand),
                           "topic": True, "topic_title": topic_title}
                i = k + 1
                continue
        body.append(line)
        i += 1
    close()
    # topic headings without their own answer text are dropped; sub-questions keep the topic title
    cleaned = []
    for e in entries:
        if e.get("topic") and e.get("topic_title") is None and not e["question"].endswith("?") and len(e["answer"]) < 40:
            continue
        cleaned.append(e)
    return cleaned


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("pdf")
    ap.add_argument("--sections", nargs="+", required=True, help="section titles exactly as printed")
    ap.add_argument("--topic", action="append", default=[], help="'Section:N' entries that are topics with sub-questions")
    ap.add_argument("--stop-at", default="Page author", help="line that marks the end of the content")
    ap.add_argument("--source", required=True, help="source label for the Q&A sources field")
    ap.add_argument("--title", default="FAQ")
    ap.add_argument("--qa-out")
    ap.add_argument("--md-out")
    args = ap.parse_args(argv)
    topics = {(t.rsplit(":", 1)[0], int(t.rsplit(":", 1)[1])) for t in args.topic}
    lines = extract_lines(Path(args.pdf), args.stop_at)
    entries = parse(lines, args.sections, topics)
    qa = {"entries": []}
    md = [f"# {args.title}", ""]
    section_seen = None
    for e in entries:
        label = f"{args.source}, section '{e['section']}', question {e['number']}"
        if e.get("topic_title"):
            label += f" ({e['topic_title']})"
        qa["entries"].append({"question": e["question"], "answer": e["answer"], "sources": [label]})
        if e["section"] != section_seen:
            md += [f"## {e['section']}", ""]
            section_seen = e["section"]
        heading = e["question"] if not e.get("topic_title") else f"{e['topic_title']}: {e['question']}"
        md += [f"### {heading}", "", e["answer"], ""]
    if args.qa_out:
        Path(args.qa_out).write_text(
            f"# Reference Q&A extracted from {Path(args.pdf).name} by kit/tools/budgpedia_faq_to_qa.py.\n"
            "# Guidance for the agent, never cited. Review: PDF extraction loses bullets and link targets.\n"
            + yaml.safe_dump(qa, sort_keys=False, allow_unicode=True, width=100), encoding="utf-8")
    if args.md_out:
        Path(args.md_out).write_text("\n".join(md).rstrip() + "\n", encoding="utf-8")
    print(f"{len(entries)} entries", file=sys.stderr)
    for e in entries:
        print(f"  [{e['section']}] {e['number']}. {e['question'][:95]}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
