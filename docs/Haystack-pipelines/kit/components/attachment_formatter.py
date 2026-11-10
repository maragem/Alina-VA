import hashlib
from haystack import component
from haystack.dataclasses import Document
PER_DOC_CHARS = 12000  # KIT:per_doc_chars
MAX_ATTACHMENT_DOCS = 40  # KIT:max_attachment_docs
# Optional metadata rendered as attributes when present (version, date, type...).
EXTRA_ATTRS = ["doc_type", "version", "document_date"]  # KIT:extra_attrs
TOKEN_LEN = 6
def citation_token(document_id):
    """Stable per-document citation token. MUST stay identical in
    attachment_formatter, both result_formatters and citation_renumberer."""
    return hashlib.sha1(str(document_id).encode("utf-8")).hexdigest()[:TOKEN_LEN]
def source_name(doc):
    return doc.meta.get("display_name") or doc.meta.get("file_name")
def _attr(doc, key):
    value = doc.meta.get(key)
    return f' {key}="{value}"' if value not in (None, "") else ""
@component
class AttachmentFormatter:
    """Renders the attachments for the first user turn (bounded per passage) and
    seeds them into agent state with the same citation tokens as corpus passages."""
    @component.output_types(documents=list[Document], result=str)
    def run(self, documents: list[Document]):
        kept = (documents or [])[:MAX_ATTACHMENT_DOCS]
        blocks = []
        for doc in kept:
            full = doc.content or ""
            body = full[:PER_DOC_CHARS]
            truncated = ' truncated="true"' if len(full) > len(body) else ""
            tail = "\n[... this passage continues beyond what is shown here ...]" if truncated else ""
            extra = "".join(_attr(doc, key) for key in EXTRA_ATTRS)
            blocks.append(
                f'<document reference="{citation_token(doc.id)}" source="{source_name(doc)}" '
                f'section="{doc.meta.get("header")}" page="{doc.meta.get("page_number")}"{extra}{truncated}>\n'
                f"{body}{tail}\n</document>"
            )
        result = "<documents>\n" + "\n".join(blocks) + "\n</documents>" if blocks else ""
        if len(documents or []) > MAX_ATTACHMENT_DOCS:
            result += (
                f"\n(The attachment was long: {len(documents)} passages, the first "
                f"{MAX_ATTACHMENT_DOCS} are shown.)"
            )
        return {"documents": kept, "result": result}
