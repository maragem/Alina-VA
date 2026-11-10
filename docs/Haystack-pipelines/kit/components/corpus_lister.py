import json
import re
from haystack import component
from haystack.dataclasses import Document
# The store hard-codes a 10 000-hit cap on the scan. With one chunk per file this
# means ~10 000 files; the check stays because a silent truncation here is exactly
# the failure that cost ALINA two debugging rounds.
SCAN_CAP = 10000
# Bounds the context cost of an UNFILTERED listing only. A listing narrowed by a
# name pattern is never truncated.
MAX_FILES_UNFILTERED = 600  # KIT:max_files_unfiltered
# Metadata shown on every line, "unknown" when absent.
LISTING_FIELDS = ["doc_type", "version", "document_date"]  # KIT:listing_fields
# Metadata the listing is sorted on before the name (numeric-aware, unknown last).
SORT_FIELDS = []  # KIT:listing_sort
LEGEND = "fields: file_name, file_id, doc_type, version, document_date. doc_type/version/document_date read 'unknown' when the document carries no such metadata; prefer the latest version or date when several documents describe the same process."  # KIT:listing_legend
ORDER_LABEL = "alphabetical"  # KIT:listing_order_label

def _name(doc):
    return doc.meta.get("display_name") or doc.meta.get("file_name") or "unknown"

def _meta(doc, key):
    value = doc.meta.get(key)
    return str(value) if value not in (None, "") else "unknown"

def _sort_value(entry, key):
    value = entry.get(key)
    if value in (None, "", "unknown"):
        return (1, 0, "")
    try:
        return (0, float(str(value).strip()), "")
    except ValueError:
        return (0, 0, str(value).lower())

@component
class CorpusFileLister:
    """Reduces chunks to a distinct-file listing.
    Receives documents from upstream retrievers (which own the document store), so
    this component never opens a connection itself:
      - `documents`    the scan (one chunk per file), capped at SCAN_CAP;
      - `name_matches` the BM25 hits on the name pattern.
    Name matching is done here: a regex when the pattern compiles, a
    case-insensitive substring otherwise, and a match when EVERY token of the
    pattern appears in the name, in any order.
    """
    @component.output_types(result=str)
    def run(self, documents: list[Document], name_matches: list[Document] | None = None, name_pattern: str = ""):
        name_pattern = (name_pattern or "").strip()
        scanned = len(documents or [])
        scan_truncated = scanned >= SCAN_CAP
        seen_ids, merged = set(), []
        for doc in list(documents or []) + list(name_matches or []):
            if doc.id in seen_ids:
                continue
            seen_ids.add(doc.id)
            merged.append(doc)
        pattern = None
        if name_pattern:
            try:
                pattern = re.compile(name_pattern, re.IGNORECASE)
            except re.error:
                pattern = None
        needle = name_pattern.lower()
        tokens = [w for w in re.split(r"[^A-Za-z0-9]+", needle) if w]
        def matches(name):
            low = name.lower()
            if pattern is not None and pattern.search(name):
                return True
            if needle and needle in low:
                return True
            return bool(tokens) and all(w in low for w in tokens)
        files = {}
        name_hits = 0
        for doc in merged:
            name = _name(doc)
            file_name = doc.meta.get("file_name") or name
            if name_pattern and not (matches(name) or matches(file_name)):
                continue
            name_hits += 1
            entry = {"file_name": name, "file_id": doc.meta.get("file_id")}
            for key in LISTING_FIELDS:
                entry[key] = _meta(doc, key)
            files.setdefault(doc.meta.get("file_id") or name, entry)
        listing = sorted(
            files.values(),
            key=lambda e: tuple(_sort_value(e, k) for k in SORT_FIELDS) + (e["file_name"].lower(),),
        )
        partial_note = (
            " WARNING: the file scan hit its limit, so this listing is partial."
            if scan_truncated else ""
        )
        if not listing:
            if name_pattern and name_hits == 0:
                return {"result": (
                    f'No document matches "{name_pattern}".' + partial_note +
                    " Retry with ONE distinctive word from the name, and with an empty "
                    "pattern to see the full list of documents. If it is still absent, the "
                    "document is not in this corpus: say so, and answer from search_corpus "
                    "if the subject is covered elsewhere."
                )}
            return {"result": "The corpus returned no documents." + partial_note}
        truncated = not name_pattern and len(listing) > MAX_FILES_UNFILTERED
        if truncated:
            listing = listing[:MAX_FILES_UNFILTERED]
        header = f"{len(listing)} document(s), {ORDER_LABEL}"
        if truncated:
            header += (
                f" - WARNING, THIS LISTING IS INCOMPLETE: it shows the first "
                f"{MAX_FILES_UNFILTERED} of {len(files)} documents. You may NOT "
                "conclude from it that any document is missing. Narrow it with a "
                "name pattern instead."
            )
        header += partial_note
        header += f"\n{LEGEND}"
        body = "\n".join(json.dumps(e, ensure_ascii=False) for e in listing)
        return {"result": f"{header}:\n{body}"}
