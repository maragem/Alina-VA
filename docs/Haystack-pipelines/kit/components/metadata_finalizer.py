import re
from dataclasses import replace

from haystack import component
from haystack.dataclasses import Document

# MUST equal structure_promoter.PAGE_SENTINEL and the header splitter's page_break_character.
PAGE_SENTINEL = "␌"
MAX_HEADER_CHARS = 180
MAX_SECTION_CHARS = 140
# Metadata derived from the FILE NAME when the chunk does not already carry the field.
# Each rule: {"field": ..., "pattern": <regex, IGNORECASE>, "value": <fixed value>} or
# without "value", in which case group(1) of the match is used. File-level metadata set
# at upload always wins; this is the fallback for corpora that have none.
FILENAME_RULES = []  # KIT:filename_rules
# Fields that must never be null because the query side groups or sorts on them
# (e.g. {"authority_rank": 5} puts unranked files below everything else).
META_DEFAULTS = {}  # KIT:meta_defaults
# "Article 11" / "Article 11a" / "Article I.1" -> the reference itself
PROVISION = re.compile(r"^(?:Article|Clause)\s+([IVXLCDM]+\.\d+(?:\.\d+)*|\d+\s*[a-z]?)\b", re.I)
PARAGRAPH = re.compile(r"^\s*(\d{1,3})\.\s+\S", re.M)


def _tidy(value: str) -> str:
    value = re.sub(r"[#*_]+", " ", value or "")
    return re.sub(r"\s+", " ", value).strip(" |-\u2013\u2014")


def _missing(value) -> bool:
    return value is None or value == "" or value == "unknown"


@component
class MetadataFinalizer:
    """Last stop before embedding: composes the display/embedding header, the structural
    fields, the file-name-derived metadata and the defaults the query side relies on."""

    @component.output_types(documents=list[Document])
    def run(self, documents: list[Document]):
        out = []
        for doc in documents:
            content = (doc.content or "").replace(PAGE_SENTINEL, "")
            meta = dict(doc.meta)

            file_name = (
                meta.get("file_name")
                or meta.get("dl_meta_origin_filename")
                or "unknown file"
            )
            meta["file_name"] = file_name

            section = _tidy(meta.get("header", ""))[:MAX_SECTION_CHARS]

            parents = meta.get("parent_headers") or []
            if isinstance(parents, str):
                parents = [parents]
            path_parts = [_tidy(p) for p in parents if _tidy(p)]
            if section:
                path_parts.append(section)

            meta["section_title"] = section
            meta["section_path"] = " > ".join(path_parts)[:MAX_HEADER_CHARS]

            # Provision reference: article or contract clause, from the deepest heading
            # that carries one. Enables a metadata filter for "what does Article 29 say".
            provision = None
            for part in [section] + list(reversed(path_parts)):
                found = PROVISION.match(part or "")
                if found:
                    provision = re.sub(r"\s+", "", found.group(1))
                    break
            meta["provision_ref"] = provision

            # Paragraph-numbered documents (judgments) are cited by paragraph: record the
            # range this chunk covers so an answer can say "paragraph 42" and be checkable.
            if meta.get("structure_profile") in ("judgment", "paragraph_numbered"):
                numbers = [int(n) for n in PARAGRAPH.findall(content)]
                meta["paragraph_range"] = (
                    f"{min(numbers)}-{max(numbers)}" if numbers else None
                )
            else:
                meta["paragraph_range"] = None

            # "<file_name> | <section>": the human label in the sources panel AND the text
            # the rerankers and the document embedder prepend to the chunk. Falls back to
            # the file name alone when the document has no detectable structure.
            header = f"{file_name} | {section}" if section else file_name
            meta["header"] = header[:MAX_HEADER_CHARS]

            for rule in FILENAME_RULES:
                if not _missing(meta.get(rule["field"])):
                    continue
                found = re.search(rule["pattern"], file_name, re.I)
                if found:
                    meta[rule["field"]] = rule.get("value", found.group(1) if found.groups() else found.group(0))

            for key, value in META_DEFAULTS.items():
                if _missing(meta.get(key)):
                    meta[key] = value

            meta.setdefault("page_number", None)
            # Every path in the kit's indexing pipeline splits, so split_id is present. A
            # document that reached here unsplit still becomes listable (the file scan
            # enumerates split_id == 0) instead of vanishing from list_corpus_files.
            if meta.get("split_id") is None:
                meta["split_id"] = 0
            out.append(replace(doc, content=content, meta=meta))
        return {"documents": out}
