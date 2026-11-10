import hashlib
from haystack import component
from haystack.dataclasses import Document
PER_DOC_CHARS = 12000  # KIT:per_doc_chars
MAX_DOCS_PER_CALL = 30  # KIT:max_docs_per_call
# Optional metadata rendered as attributes when present (version, date, type...).
EXTRA_ATTRS = ["doc_type", "version", "document_date"]  # KIT:extra_attrs
# The three texts around the passages. Every branch must end by naming the
# condition under which the agent searches again: a tool result that reads as a
# licence to stop is the failure ALINA 9j measured (7 regressions).
INTRO = "Passages grouped by document, in document order. Cite each claim with the passage's reference token in square brackets, copied exactly, e.g. [a1b2c3]."  # KIT:formatter_intro
OUTRO = "These are the passages this ONE query surfaced, not everything the corpus holds on the question. If the document that actually governs the point is not among them, or a part of the question is still unanswered, search again with different terms, or open the governing document directly with search_in_file."  # KIT:formatter_outro
EMPTY = "No documents matched this query. This is a result about the QUERY, not about the corpus: reformulate with the vocabulary the documents themselves use and search again before concluding anything."  # KIT:formatter_empty
TOKEN_LEN = 6
def citation_token(document_id):
    """Stable per-document citation token. MUST stay identical in
    attachment_formatter, both result_formatters and citation_renumberer."""
    return hashlib.sha1(str(document_id).encode("utf-8")).hexdigest()[:TOKEN_LEN]
def _attr(doc, key):
    value = doc.meta.get(key)
    return f' {key}="{value}"' if value not in (None, "") else ""
def render(doc):
    full = doc.content or ""
    body = full[:PER_DOC_CHARS]
    truncated = ' truncated="true"' if len(full) > len(body) else ""
    tail = "\n[... this passage continues beyond what is shown here ...]" if truncated else ""
    source = doc.meta.get("display_name") or doc.meta.get("file_name")
    extra = "".join(_attr(doc, key) for key in EXTRA_ATTRS)
    return (
        f'<document reference="{citation_token(doc.id)}" source="{source}" '
        f'section="{doc.meta.get("header")}" page="{doc.meta.get("page_number")}"'
        f'{extra}{truncated}>\n{body}{tail}\n</document>'
    )
@component
class ResultFormatter:
    """Renders retrieved passages with STABLE citation tokens, dedups against the
    documents already in agent state, and appends only the new ones."""
    @component.output_types(documents=list[Document], result=str)
    def run(self, documents: list[Document], state_documents: list[Document] | None = None):
        known = {d.id for d in (state_documents or [])}
        new_docs, kept = [], []
        for doc in (documents or [])[:MAX_DOCS_PER_CALL]:
            if doc.id not in known:
                known.add(doc.id)
                new_docs.append(doc)
            kept.append(doc)
        if not kept:
            return {"documents": [], "result": EMPTY}
        return {"documents": new_docs, "result": (
            INTRO + "\n<documents>\n" + "\n".join(render(d) for d in kept)
            + "\n</documents>\n" + OUTRO
        )}
