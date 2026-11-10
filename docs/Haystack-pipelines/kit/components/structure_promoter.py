from dataclasses import replace
from haystack import component
from haystack.dataclasses import Document

import re
# Which promotions this corpus needs. "numbered" fits manuals and guidance ("2.1 Create a
# purchase order"); "legal" and "contract" fit acts and contracts (TITLE/CHAPTER/Article,
# "Article I.1"); "judgment" fits CJEU case law (rubric sections). Detection per document
# still guards every profile: a document that numbers its PARAGRAPHS 1..N never gets
# single-level numbers promoted, whatever is enabled.
ENABLED_PROFILES = {"numbered"}  # KIT:structure_profiles
# Printable, non-whitespace stand-in for the form feed, so DocumentCleaner's whitespace
# collapsing cannot swallow page breaks before MarkdownHeaderSplitter counts them.
# MUST equal the splitter's page_break_character and the finalizer's PAGE_SENTINEL.
PAGE_SENTINEL = "␌"
DECOR = r"[#*_\s]*"
ROMAN = r"[IVXLCDM]+"

LEGAL = [
    (1, re.compile(rf"^{DECOR}((?:PART|TITLE)\s+(?:{ROMAN}|\d+)\b.*?){DECOR}$", re.I)),
    (1, re.compile(rf"^{DECOR}(ANNEX(?:E)?\s+(?:{ROMAN}|\d+)?\b.*?){DECOR}$", re.I)),
    (2, re.compile(rf"^{DECOR}(CHAPTER\s+(?:{ROMAN}|\d+)\b.*?){DECOR}$", re.I)),
    (3, re.compile(rf"^{DECOR}(SECTION\s+(?:{ROMAN}|\d+)\b.*?){DECOR}$", re.I)),
]
# "Article 11", "Article 11a", "Article I.1", optionally with an inline title after -/:
ARTICLE_REF = rf"(?:\d+\s*[a-z]?|{ROMAN}\.\d+(?:\.\d+)*)"
ARTICLE = re.compile(rf"^{DECOR}(Article\s+{ARTICLE_REF})\s*(?:[-\u2013\u2014:]\s*(.{{2,150}}?))?{DECOR}$", re.I)
# Numbered heading. Single level REQUIRES the dot ("2. Scope"); multi-level may omit it
# ("3.2.1 Award criteria"). The mandatory dot is what stops "12 September 2024" matching.
NUM_MULTI = re.compile(rf"^{DECOR}((\d+(?:\.\d+)+)\.?\s+([^\s].{{1,110}}?)){DECOR}$")
NUM_SINGLE = re.compile(rf"^{DECOR}((\d+)\.\s+([^\s].{{1,110}}?)){DECOR}$")
JUDGMENT_RUBRICS = [
    "legal context", "background to the dispute", "the dispute in the main proceedings",
    "consideration of the questions? referred", "forms of order sought", "costs",
    "procedure and forms of order sought", "arguments of the parties", "findings of the court",
    "substance", "admissibility", "european union law", "national law", "the law",
    "the questions? referred for a preliminary ruling", "operative part",
]
RUBRIC = re.compile(rf"^{DECOR}((?:{'|'.join(JUDGMENT_RUBRICS)}).{{0,60}}?){DECOR}$", re.I)
OPERATIVE = re.compile(rf"^{DECOR}(On those grounds,?.{{0,80}}){DECOR}$", re.I)
PARA = re.compile(r"^\s*(\d{1,3})\.\s+\S")
JUDGMENT_MARK = re.compile(r"JUDGMENT OF THE (COURT|GENERAL COURT)|ORDER OF THE COURT", re.I)
BODY_START = re.compile(r"^\s*(?:\(?[a-z0-9]{1,4}\)|\d+\.)\s")
MAX_TITLE = 200
MAX_HEADING_CHARS = 120

def _looks_like_title(title, raw_line):
    """A heading is a label, not a sentence: few words, no terminal punctuation."""
    title = (title or "").strip()
    if len(title.split()) > 12:
        return False
    return not raw_line.rstrip().endswith((".", ";", ",", ":"))

def is_heading(l): return l.lstrip().startswith("#")
def clean(t): return re.sub(r"[#*_]+", "", t or "").strip(" .:-\u2013\u2014")

def detect_profile(text, lines):
    """Decides, per document, which promotions are safe."""
    nums = [int(m.group(1)) for m in (PARA.match(l) for l in lines) if m]
    ascending = 0
    for a, b in zip(nums, nums[1:]):
        if b == a + 1:
            ascending += 1
    # A long run of consecutive "N." lines means the document numbers its PARAGRAPHS
    # (every CJEU judgment, the recitals of every legal act, some step-by-step guides).
    # Single-level numbers are then body text and must never become headings.
    paragraph_numbered = ascending >= 10
    judgment = "judgment" in ENABLED_PROFILES and (
        bool(JUDGMENT_MARK.search(text[:4000])) or len(RUBRIC.findall(text)) >= 2)
    return {"paragraph_numbered": paragraph_numbered, "judgment": judgment}

def promote(text):
    text = text.replace("\f", PAGE_SENTINEL)
    lines = text.split("\n")
    profile = detect_profile(text, [l.replace(PAGE_SENTINEL, "").strip() for l in lines])
    articles = bool(ENABLED_PROFILES & {"legal", "contract"})
    result, consumed, added = [], set(), 0
    for i, raw in enumerate(lines):
        if i in consumed: continue
        line = raw.replace(PAGE_SENTINEL, "").strip()
        if not line or is_heading(raw):
            result.append(raw); continue

        m = ARTICLE.match(line) if articles else None
        if m:
            label, title = clean(m.group(1)), clean(m.group(2))
            if not title:
                for off, cand in enumerate(lines[i+1:i+4], start=i+1):
                    s = cand.replace(PAGE_SENTINEL, "").strip()
                    if not s: continue
                    if (not BODY_START.match(s) and not is_heading(cand)
                            and len(s) <= MAX_TITLE and not ARTICLE.match(s)):
                        title = clean(s); consumed.add(off)
                    break
            result.append(f"#### {label}" + (f" - {title}" if title else "")); added += 1; continue

        done = False
        if "legal" in ENABLED_PROFILES:
            for lvl, pat in LEGAL:
                f = pat.match(line)
                if f and len(line) <= MAX_HEADING_CHARS:
                    result.append(f"{'#'*lvl} {clean(f.group(1))}"); added += 1; done = True; break
        if done: continue

        if profile["judgment"] and len(line) <= MAX_HEADING_CHARS:
            f = RUBRIC.match(line) or OPERATIVE.match(line)
            if f:
                result.append(f"## {clean(f.group(1))}"); added += 1; continue

        if "numbered" in ENABLED_PROFILES:
            f = NUM_MULTI.match(line)
            if not f and not profile["paragraph_numbered"]:
                f = NUM_SINGLE.match(line)
            if f and not _looks_like_title(f.group(3), line):
                f = None
            if f and len(f.group(1)) <= MAX_HEADING_CHARS:
                depth = min(f.group(2).count(".") + 2, 4)
                result.append(f"{'#'*depth} {clean(f.group(1))}"); added += 1; continue

        result.append(raw)
    return "\n".join(result), added, profile


@component
class StructurePromoter:
    """Promotes document structure to markdown headings; shields page breaks."""

    @component.output_types(documents=list[Document])
    def run(self, documents: list[Document]):
        out = []
        for doc in documents:
            content, added, profile = promote(doc.content or "")
            meta = dict(doc.meta)
            meta["structure_headings_added"] = added
            meta["structure_profile"] = (
                "judgment" if profile["judgment"]
                else "paragraph_numbered" if profile["paragraph_numbered"]
                else "generic"
            )
            out.append(replace(doc, content=content, meta=meta))
        return {"documents": out}
