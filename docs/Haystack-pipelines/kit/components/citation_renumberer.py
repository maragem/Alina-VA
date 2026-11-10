import hashlib
import re
from haystack import component
from haystack.dataclasses import ChatMessage, Document
TOKEN_LEN = 6
# [a1b2c3] and, defensively, [A1B2C3] and [a1b2c3, d4e5f6]
TOKEN_PATTERN = re.compile(
    r"\[([0-9a-fA-F]{%d}(?:\s*,\s*[0-9a-fA-F]{%d})*)\]" % (TOKEN_LEN, TOKEN_LEN)
)
def citation_token(document_id):
    """Stable per-document citation token. MUST stay identical in
    attachment_formatter, both result_formatters and citation_renumberer."""
    return hashlib.sha1(str(document_id).encode("utf-8")).hexdigest()[:TOKEN_LEN].lower()
@component
class CitationRenumberer:
    """Turns citation tokens into [1], [2], [3] and aligns the documents output.
    The tools hand the model stable per-passage tokens; this rewrites the ones it
    used into numbers in order of first appearance and emits exactly those passages,
    in that order, as `documents`. Each returned document also carries
    meta.citation_number (its [n]) and meta.citation_token, so the front end can
    build clickable references by lookup rather than by array position.
    Only the rewritten answer leaves the pipeline, never the tool-call messages.
    """
    @component.output_types(documents=list[Document], messages=list[ChatMessage])
    def run(self, messages: list[ChatMessage], documents: list[Document] | None = None):
        documents = documents or []
        by_token = {}
        for doc in documents:
            by_token.setdefault(citation_token(doc.id), doc)

        # The answer is the last assistant message carrying text.
        target = None
        for index in range(len(messages) - 1, -1, -1):
            role = getattr(messages[index].role, "value", messages[index].role)
            if role != "assistant":
                continue
            try:
                text = messages[index].text or ""
            except Exception:
                text = ""
            if text.strip():
                target = index
                break

        def deduplicated():
            seen, out = set(), []
            for doc in documents:
                if doc.id in seen:
                    continue
                seen.add(doc.id)
                out.append(doc)
            return out

        if target is None:
            return {"documents": deduplicated(),
                    "messages": [messages[-1]] if messages else []}

        numbering = {}   # citation token -> [n]
        order = []       # Document at index n-1

        def replace(match):
            rendered = []
            for token in (t.strip().lower() for t in match.group(1).split(",")):
                # INVARIANT - do not "improve" this: a number is handed out ONLY for a
                # token that RESOLVES, so `numbering` and `order` always have the same
                # length. Numbering an unresolvable token shifts every later citation
                # by one and misattributes every passage after it.
                if token not in by_token:
                    continue
                if token not in numbering:
                    numbering[token] = len(numbering) + 1
                    order.append(by_token[token])
                rendered.append("[%d]" % numbering[token])
            return "".join(dict.fromkeys(rendered))

        original = messages[target].text or ""
        rewritten = TOKEN_PATTERN.sub(replace, original)
        cited = []
        for position, document in enumerate(order, start=1):
            document.meta["citation_number"] = position
            document.meta["citation_token"] = citation_token(document.id)
            cited.append(document)

        # ONLY the rewritten answer leaves the pipeline.
        answer = ChatMessage.from_assistant(
            text=rewritten, meta=dict(messages[target].meta or {})
        )
        return {"documents": cited or deduplicated(), "messages": [answer]}
