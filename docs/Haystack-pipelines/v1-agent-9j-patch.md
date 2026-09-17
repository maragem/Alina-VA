# DRAFT 9j - patch against v1-agent 9i

Sources: the UAT rerun of 09/09/2026 (`alina_uat_rerun.xlsx`, 30 questions, pipeline v40) and
five deepset traces pulled for GS-016, GS-022, GS-024, GS-025 and GS-027.

The traces changed two of the five fixes drafted from the rerun alone. Both corrections are
recorded below under "What the traces invalidated", because the reasoning that produced the
wrong fix is the part worth keeping.

---

## 1. What the traces establish

### 1.1 The Financial Regulation carries no structural metadata at all

On all 113 distinct FR chunks visible across the five traces:

- `header` is the **document title**, byte-identical on every chunk:
  `2024/2509 ## REGULATION (EU, Euratom) 2024/2509 OF THE EUROPEAN PARLIAMENT AND OF THE COUNCIL ## of 23 September 2024 ## on the financial ru...`
- `parent_headers` is `[]` on every chunk.
- The only structural signal is inline in the content, and it is thin:

| marker present in the chunk body | chunks | share |
|---|---|---|
| `## Article N ##` only | 1 | 1% |
| Annex-I point marker only | 36 | 32% |
| both | 28 | 25% |
| **neither** | **48** | **42%** |
| chunks spanning more than one `## Article N ##` | 10 | 9% |

Chunking is size-based and ignores provision boundaries. The passage the model cited in
GS-025 (split 433) opens mid-sentence and contains the headings of Articles 173, **174** and
175 - three provisions in one chunk, with the quoted sentence sitting between two of them.

### 1.2 GS-016: Article 167 was never retrieved, not retrieved-and-ignored

`search_in_file(FR)`, query `thresholds supplies services procurement procedures`.
BM25 30 + embedding 30 gave **47 candidates**. Nine of them mention Article 167, but every one
is a **cross-reference** from elsewhere in the act (points 36, 39 of Annex I, Article 177).
The chunk holding Article 167 itself, with the choice-of-procedure thresholds, is not among
the 47. The reranker did not drop it; retrieval never surfaced it.

The model then answered from what it actually had: Annex I point 39 (external action, splits
646-647) and the Union-delegations derogation (split 440). Its answer is a faithful reading of
a slice it had no way of knowing was unrepresentative.

**Retrieval coverage failure, confirmed. Not a generation failure.**

### 1.3 `state_documents` is 0 on every retrieval, so cross-call dedup never runs

| trace | tool_invoker | calls in one assistant message | `state_documents` at each formatter |
|---|---|---|---|
| GS-022 | 21.0s | 2 (`search_in_file` + `search_corpus`) | 0, 0 |
| GS-024 | 125.5s | **10** (8x `search_corpus`, 2x `search_in_file`) | 0 x10 |
| GS-027 | 50.7s | 4 | 0 x4 |

The model emits its whole search plan as one parallel batch. That is the mechanism the 9c
header describes, and 9c fixed its *numbering* symptom: GS-025 cites 2 documents out of 22
retrieved, GS-022 cites 27 out of 54, and the tokens resolve correctly. But 9c did **not**
fix the second symptom it predicted. Every `ResultFormatter` dedups against an empty state, so
GS-024 accumulated **252 documents in state for 31 cited**, and the cited panel repeats
`Liquidated Damages Application Guidance` eleven times across its pdf and docx copies.

### 1.4 The pdf/docx twins are real and they reach the sources panel

Cited panels, verbatim:

- GS-024: `Liquidated+Damages+Application+Guidance.docx` x5 and
  `Liquidated Damages Application Guidance.pdf` x6; `2. Draft Contract template_v2 - MC1 - SIDE III.pdf` x6.
- GS-022: `Requesting clarifications.pdf` x3 and `Requesting clarifications.docx` x3;
  `T-495_04_2008_abnormally-low-volumes.docx` x7.

This is #UX039 and #UX040 with a mechanism attached.

### 1.5 The parallelism is not buying what the 9c header assumed

The 9c note justifies keeping `parallel_tool_calls` on: *"four searches in 27s where sequential
would be 50-60s (the reranker alone is 7-10s per call)"*. The traces do not support that any
more:

- GS-024: **10 parallel searches, 125.5s** = 12.6s per search. No speedup over sequential.
- GS-025: a **single** `search_in_file` takes 44.8s, of which `ranker` 31.6s and
  `ranker_scoring` 12.0s.
- GS-016: the same chain, same candidate count (47), `ranker` **2.9s** and `ranker_scoring` 1.1s.

A 10x spread on identical work means the two rerankers are contended, not that the query is
hard. Ten concurrent invocations of a shared reranker serialise on the GPU and add memory
pressure - the v0.7 OOM note applies here. Parallelism is buying roughly nothing and costing
the dedup invariant. Worth revisiting separately; not changed in this patch, because
`parallel_tool_calls` is an unverified parameter on this gateway (a 400, per the 9c note).

### 1.6 The full message list leaves the pipeline

`citation_renumberer` returns 8 messages (GS-025), 9 (GS-022) and 17 (GS-024), i.e. the whole
agent conversation including tool calls and tool results. This is the [O2] note, and it
matches the rerun export, where all 27 non-error answers begin with raw
`**Tool Use:** {json}` blocks carrying `file_ids`.

### 1.7 GS-027: the question was truncated at the first tool call

```
consult_reference_qa {"query": "EMA participating entity MC1 FWC SIDE III"}
search_corpus        {"query": "\"EMA\" \"MC1\" \"SIDE III\" participating entities"}
list_corpus_files    {"name_pattern": "MC1"}      -> 1 file
list_corpus_files    {"name_pattern": "SIDE III"} -> 1 file
search_in_file       (SIDE III contract)
```

"What does EMA stand for" is never searched. The framing is already lost in the first
`consult_reference_qa` query and every later call inherits it. Nothing in the pipeline notices
that half the question was dropped.

---

## 2. What the traces invalidated

### 2.1 Twin dedup in `result_formatter` would not have worked

The draft keyed dedup on a `known_twins` set seeded from `state_documents`. Since
`state_documents` is **0 on every parallel call** (1.3), that set is always empty and the fix
would have caught nothing in exactly the case it was written for - GS-024, ten parallel calls.
It has to run where the accumulated state is actually visible: `citation_renumberer`.
Corrected in A2 below.

### 2.2 "Copy the instrument label from the `section` attribute" is impossible

The draft added `parent_section` to the rendered tag and told the model to copy the label
rather than compose it. `section` is the document title on every FR chunk and `parent_headers`
is empty (1.1), so there is nothing to copy. 42% of FR chunks carry no marker at all, and 9%
carry several. A label rule cannot be built on this metadata, and a derived-label component
would be right about a quarter of the time.

GS-025's "Point 174" is therefore **not** a discipline failure. The model quoted a chunk
containing three article headings, none of which unambiguously governs the sentence it quoted,
with no metadata to disambiguate. It got the number right and the instrument type wrong.

The real fix is upstream and is a separate ticket: `indexing-v06.yaml` must stamp the
governing provision into `header`/`parent_headers` and split on provision boundaries. That
requires re-indexing the FR. Corrected, much weaker, mitigation in A3.

---

## STAGE A

### A1. Two-layer retrieval: the second source layer stops being the agent's decision

**Closes**: G2 (GS-002, GS-006, GS-016 partially), G5 (GS-006), the GS-005 regression.
**Confirmed by the traces**, and strengthened: BM25 costs 28-277ms in these runs while the two
rerankers cost 3-44s, so a BM25-only second layer is close to free, and adding a *reranked*
second pass would have been the expensive mistake.

Unchanged from the first draft. Every search returns both authority layers in one tool result,
gated on a `question_shape` parameter the agent declares at the moment of the call - a far more
reliable act than remembering an obligation three steps later, and observable in the trace, so
the next UAT can separate a misclassification from a missing search. The prompt states the
obligation in four places today and the model ignores all four (GS-005, GS-006, GS-016 are the
same two-call trace); a fifth restatement is not a fix.

Empty-query gating is proven on this exact retriever in this deployment (`name_search` with an
empty pattern, trace 199b284e).

#### A1.1 `search_in_file` gains an implementing-guidance layer

Add to `parameters.properties`, and to `required`:

```yaml
              question_shape:
                type: string
                enum:
                - lookup
                - practical
                description: >-
                  Declare, BEFORE searching, which shape you are answering.
                  "lookup" = what a term means, what a provision says, what a
                  named document requires: the quoted provision is the complete
                  answer. "practical" = conditions, thresholds, procedure,
                  exceptions, evidence, or what to do in a case: the provision
                  states the rule and the implementing guidance states how the
                  Commission applies it, so both are needed. When in doubt
                  between the two, declare "practical".
```

`input_mapping` additions:

```yaml
            question_shape:
            - guidance_gate.question_shape
            file_ids:
            - file_filter_merger.file_ids
            - guidance_filter.excluded_file_ids
            query:
            - retrieval_query.query
            - ranker.query
            - ranker_scoring.query
            - guidance_gate.query
            filters:
            - file_filter_merger.base_filters
            - guidance_filter.base_filters
```

New components:

```yaml
              guidance_gate:
                # DRAFT 9j. Emits the query for the guidance layer ONLY on a practical
                # question. On a lookup it emits "", so the BM25 retriever returns nothing:
                # the 9e no-padding rule is preserved mechanically instead of by asking the
                # model to restrain itself.
                type: deepset_cloud_custom_nodes.code.code_component.Code
                init_parameters:
                  code: |
                    from haystack import component
                    @component
                    class GuidanceGate:
                        """Query passthrough gated on the declared question shape."""
                        @component.output_types(query=str)
                        def run(self, query: str, question_shape: str = "practical"):
                            shape = (question_shape or "").strip().lower()
                            return {"query": query if shape == "practical" else ""}
              guidance_filter:
                # SECURITY-SENSITIVE, same rule as file_filter_merger: AND the entitlement
                # filters, never replace them. Excludes the documents already being searched
                # AND the Financial Regulation, so this layer can only return material the
                # agent does not already have. That exclusion is the point: a plain follow-up
                # search returns more FR, because the FR dominates lexically.
                type: deepset_cloud_custom_nodes.code.code_component.Code
                init_parameters:
                  code: |
                    from typing import Any
                    from haystack import component
                    FR_FILE_ID = "4abf8796-9157-4ceb-932e-74cb788e4f1b"
                    @component
                    class GuidanceFilterBuilder:
                        @component.output_types(filters=dict[str, Any])
                        def run(self, excluded_file_ids: list[str], base_filters: dict[str, Any] | None = None):
                            excluded = sorted({str(f) for f in (excluded_file_ids or []) if f} | {FR_FILE_ID})
                            condition = {"field": "file_id", "operator": "not in", "value": excluded}
                            if not base_filters:
                                return {"filters": {"operator": "AND", "conditions": [condition]}}
                            return {"filters": {"operator": "AND", "conditions": [base_filters, condition]}}
              guidance_bm25:
                type: haystack_integrations.components.retrievers.opensearch.bm25_retriever.OpenSearchBM25Retriever
                init_parameters:
                  document_store:
                    type: haystack_integrations.document_stores.opensearch.document_store.OpenSearchDocumentStore
                    init_parameters:
                      embedding_dim: 768
                      index: ALINA-V0.3
                      use_ssl: false
                  top_k: 12
                  fuzziness: 0
```

New connections:

```yaml
            - sender: guidance_gate.query
              receiver: guidance_bm25.query
            - sender: guidance_filter.filters
              receiver: guidance_bm25.filters
            - sender: guidance_bm25.documents
              receiver: result_formatter.guidance_documents
```

#### A1.2 `search_corpus` gains a primary-instrument layer

Mirror image, and the fix for GS-002 (`refQA -> corpus`, FR never opened). Same
`question_shape` parameter, same gate component, `primary_bm25` identical to `guidance_bm25`,
and:

```yaml
              primary_filter:
                # SECURITY-SENSITIVE: AND, never replace.
                type: deepset_cloud_custom_nodes.code.code_component.Code
                init_parameters:
                  code: |
                    from typing import Any
                    from haystack import component
                    FR_FILE_ID = "4abf8796-9157-4ceb-932e-74cb788e4f1b"
                    @component
                    class PrimaryFilterBuilder:
                        @component.output_types(filters=dict[str, Any])
                        def run(self, base_filters: dict[str, Any] | None = None):
                            condition = {"field": "file_id", "operator": "in", "value": [FR_FILE_ID]}
                            if not base_filters:
                                return {"filters": {"operator": "AND", "conditions": [condition]}}
                            return {"filters": {"operator": "AND", "conditions": [base_filters, condition]}}
```

wired to `result_formatter.primary_documents`.

#### A1.3 Both `result_formatter`s render the second layer

The `search_in_file` variant; the `search_corpus` one differs only in the socket name and the
two header strings. Note what this version does **not** do: no twin dedup here. `state_documents`
is empty on every parallel call, so cross-call dedup is impossible at this point and belongs in
`citation_renumberer` (A2). The within-call dedup on `doc.id` stays, because it is real.

```python
import hashlib
from haystack import component
from haystack.dataclasses import Document
PER_DOC_CHARS = 12000
MAX_DOCS_PER_CALL = 30
MAX_SECOND_LAYER = 8
TOKEN_LEN = 6

def citation_token(document_id):
    """Stable per-document citation token. MUST stay identical in
    attachment_formatter, both result_formatters and citation_renumberer."""
    return hashlib.sha1(str(document_id).encode("utf-8")).hexdigest()[:TOKEN_LEN]

def render(doc):
    full = doc.content or ""
    body = full[:PER_DOC_CHARS]
    truncated = ' truncated="true"' if len(full) > len(body) else ""
    tail = "\n[... this passage continues beyond what is shown here ...]" if truncated else ""
    return (
        f'<document reference="{citation_token(doc.id)}" source="{doc.meta.get("file_name")}" '
        f'section="{doc.meta.get("header")}" page="{doc.meta.get("page_number")}"'
        f'{truncated}>\n{body}{tail}\n</document>'
    )

@component
class ResultFormatter:
    """Renders passages with STABLE citation tokens (9c), in two authority layers (9j)."""
    @component.output_types(documents=list[Document], result=str)
    def run(self, documents: list[Document],
            state_documents: list[Document] | None = None,
            guidance_documents: list[Document] | None = None):
        # NOTE 9j: state_documents is EMPTY on every call of a parallel batch (traces
        # 46d4f93a, 4e742a04, 7f6a49da: 0 on all 16 formatter spans observed). It is kept
        # because a sequential second round does populate it, but nothing that must work
        # across tool calls may depend on it.
        known = {d.id for d in (state_documents or [])}
        new_docs = []

        def take(candidates, limit):
            kept = []
            for doc in candidates:
                if len(kept) >= limit:
                    break
                if doc.id not in known:
                    known.add(doc.id)
                    new_docs.append(doc)
                    kept.append(doc)
            return kept

        primary = take(documents or [], MAX_DOCS_PER_CALL)
        second = take(guidance_documents or [], MAX_SECOND_LAYER)

        if not primary and not second:
            return {"documents": [], "result": (
                "This document does not contain passages matching the query. "
                "Reformulate with the document's own vocabulary, or tell the "
                "user the named document does not contain this information."
            )}
        parts = []
        if primary:
            parts.append(
                "Passages from the requested document(s), grouped by authority rank. "
                "Cite each claim with the passage's reference token in square brackets, "
                "copied exactly, e.g. [a1b2c3].\n<documents>\n"
                + "\n".join(render(d) for d in primary) + "\n</documents>"
            )
        if second:
            parts.append(
                "IMPLEMENTING GUIDANCE - this is a practical question, so these lower-authority "
                "passages were retrieved for you and no further search is needed to reach them. "
                "The provision above states the rule; these state how the Commission applies it. "
                "An answer to a practical question that cites only the provision is incomplete. "
                "Cite them after the provision, with their own tokens.\n<documents>\n"
                + "\n".join(render(d) for d in second) + "\n</documents>"
            )
        elif primary:
            parts.append(
                "No implementing guidance was retrieved for this call (lookup question, or "
                "nothing outside the searched document matched)."
            )
        return {"documents": new_docs, "result": "\n\n".join(parts)}
```

### A2. Twin collapse in `citation_renumberer` (replaces the draft's formatter-level dedup)

**Closes**: #UX039, #UX040, the eleven `Liquidated Damages Application Guidance` entries in
GS-024's panel and the six `Requesting clarifications` entries in GS-022's.

This is the only component that sees the accumulated state after the agent has finished, so it
is the only place cross-call dedup can run. The change is to key the numbering on a **twin key**
rather than on the token: two ingestions of the same passage collapse to one number and one
panel entry, and a passage cited under both tokens renders as one reference.

The INVARIANT the 9d regression established is preserved by construction: a number is issued
only for a token that resolves, and `numbering` and `order` grow together.

```python
import hashlib
import re
from haystack import component
from haystack.dataclasses import ChatMessage, Document
TOKEN_LEN = 6
TOKEN_PATTERN = re.compile(
    r"\[([0-9a-fA-F]{%d}(?:\s*,\s*[0-9a-fA-F]{%d})*)\]" % (TOKEN_LEN, TOKEN_LEN)
)
# Two twins cited in SEPARATE bracket groups ("[a1b2c3][d4e5f6]") both resolve to the
# same number and would render "[1][1]". The per-group dict.fromkeys cannot see across
# groups, so adjacency is collapsed once on the finished text.
ADJACENT = re.compile(r"(\[\d+\])(?:\1)+")
EXT = re.compile(r"\.(pdf|docx?|xlsx?|pptx?|txt)$", re.IGNORECASE)
WS = re.compile(r"\s+")

def citation_token(document_id):
    """Stable per-document citation token. MUST stay identical in
    attachment_formatter, both result_formatters and citation_renumberer."""
    return hashlib.sha1(str(document_id).encode("utf-8")).hexdigest()[:TOKEN_LEN].lower()

def twin_key(doc):
    """DRAFT 9j. Identifies the SAME passage ingested twice under two formats.
    The corpus holds pdf/docx pairs of several guidance documents; they are distinct
    document ids with distinct chunks, so id-based dedup never caught them. Confirmed
    in the cited panels of traces 7f6a49da (Liquidated Damages Application Guidance,
    5 .docx + 6 .pdf entries) and 4e742a04 (Requesting clarifications, 3 + 3).
    The content prefix is part of the key on purpose: two DIFFERENT passages of one
    document must stay distinct, so normalising the file name alone is not enough."""
    name = EXT.sub("", (doc.meta.get("file_name") or "").lower())
    name = re.sub(r"[+_\-\s]+", " ", name).strip()
    body = WS.sub(" ", (doc.content or "")).strip().lower()[:300]
    return (name, body)

def is_wiki_copy(doc):
    """Between twins, prefer the clean file name over the '+'-separated wiki upload."""
    return "+" in (doc.meta.get("file_name") or "")

@component
class CitationRenumberer:
    """Turns citation tokens into [1], [2], [3], collapses pdf/docx twins onto one
    number, and aligns the documents output. Each returned document carries
    meta.citation_number and meta.citation_token so the front end can resolve [n] by
    lookup rather than by array position."""
    @component.output_types(documents=list[Document], messages=list[ChatMessage])
    def run(self, messages: list[ChatMessage], documents: list[Document] | None = None):
        documents = documents or []
        by_token = {}
        for doc in documents:
            by_token.setdefault(citation_token(doc.id), doc)

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
            # Twin-aware, and prefers the clean file name over the '+' wiki copy, so the
            # fallback panel matches what the cited panel would have shown.
            best = {}
            for doc in documents:
                key = twin_key(doc)
                if key not in best or (is_wiki_copy(best[key]) and not is_wiki_copy(doc)):
                    best[key] = doc
            return list(best.values())

        if target is None:
            # DRAFT 9j [O2]: only the last message leaves the pipeline. See below.
            return {"documents": deduplicated(),
                    "messages": [messages[-1]] if messages else []}

        numbering = {}   # twin_key -> [n]
        order = []       # representative Document per twin_key, index n-1

        def replace(match):
            rendered = []
            for token in (t.strip().lower() for t in match.group(1).split(",")):
                # INVARIANT - do not "improve" this: a number is handed out ONLY for a
                # token that resolves to a document, so numbering and order always have
                # the same length. Numbering an unresolvable token shifts every later
                # citation by one, which is the 9d regression.
                doc = by_token.get(token)
                if doc is None:
                    continue
                key = twin_key(doc)
                if key not in numbering:
                    numbering[key] = len(numbering) + 1
                    order.append(doc)
                elif is_wiki_copy(order[numbering[key] - 1]) and not is_wiki_copy(doc):
                    # A cleaner copy of an already-numbered passage: swap the
                    # representative, keep the number.
                    order[numbering[key] - 1] = doc
                rendered.append(f"[{numbering[key]}]")
            # Two twins cited side by side must not render as [3][3].
            return "".join(dict.fromkeys(rendered))

        original = messages[target].text or ""
        rewritten = ADJACENT.sub(r"\1", TOKEN_PATTERN.sub(replace, original))
        cited = []
        for position, document in enumerate(order, start=1):
            document.meta["citation_number"] = position
            document.meta["citation_token"] = citation_token(document.id)
            cited.append(document)

        # DRAFT 9j [O2]: return ONLY the rewritten answer. Tool-call and tool-result
        # messages are internal - the traces show 8 (4f443baf), 9 (4e742a04) and 17
        # (7f6a49da) messages leaving the pipeline, and the rerun export shows the raw
        # "**Tool Use:** {json}" blocks, file_ids included, in front of every answer.
        # The app rebuilds history from search_session_id and history_sanitizer flattens
        # it to text, so nothing downstream needs them.
        answer = ChatMessage.from_assistant(
            text=rewritten, meta=dict(messages[target].meta or {})
        )
        return {"documents": cited or deduplicated(), "messages": [answer]}
```

Unit-tested against fixtures modelled on the GS-024 and GS-022 panels: twins collapse onto one
number and one panel entry, adjacent and comma-grouped twins render once, the clean copy wins as
representative, an invented token is dropped without shifting later citations (the 9d invariant),
and an answer with no citations falls back to a twin-deduplicated panel.

**Check before deploying**: confirm whether the app reads `messages[-1]` or the whole list. If
it renders all messages, this removes the leak; if it already takes the last one, the leak is
in the UAT export harness and the change is still correct but is not the fix.

### A3. Instrument labels: stop asserting what cannot be verified

**Closes**: nothing outright. Mitigates #UX042 / GS-025. The draft's version of this fix was
wrong (see 2.2) and this replaces it.

There is no metadata to copy a label from, and the content markers cover a quarter of FR
chunks. So the rule cannot be "copy the label"; it has to be "state a number only when the
marker for it is visible in the passage you are quoting". That converts a confidently wrong
label into either a correct one or none. Replace the draft rule under `# Citing and quoting`
with:

```
- Name the instrument by its document name, taken from the passage's `source` attribute.
  Give an article or annex-point number ONLY when the marker for it ("## Article 174 ##",
  "34. Multiple sourcing") is visible in the passage you are quoting, and only when the
  quoted text sits under that marker: a passage can span several provisions, and the
  marker that governs a sentence is the last one appearing BEFORE it in the passage.
  Where no marker covers the text you quote, cite the document and quote the wording
  without a structural number rather than inferring one. The Financial Regulation numbers
  its articles and its Annex I points in two separate series that collide, so a guessed
  label is wrong about half the time; "Point 174" for Article 174 is that error.
```

**The real fix is upstream, and this patch does not contain it.** `indexing-v06.yaml` stamps
the document title into `header` for every chunk of the FR and leaves `parent_headers` empty,
and splits on size without regard to provision boundaries. Until `header` carries the governing
provision, no prompt rule and no query-side component can make citations structurally reliable.
That is the single highest-value fix visible in these traces, and it needs its own ticket plus
a re-index.

### A4. System prompt deltas

1. Under `# How far to go: the two question shapes`, replace the closing sentences with:

```
   Both search tools take a `question_shape` parameter. Declare it at the moment of the call:
   the guidance layer is then retrieved for you and arrives in the same tool result, so a
   practical answer never depends on your remembering to search again. Declaring "practical"
   on a lookup pads the answer; declaring "lookup" on a practical question leaves it
   incomplete. When genuinely in doubt, declare "practical".
```

2. Replace "Stopping at the FR on a practical question is a failure, not a shortcut" with:

```
   On a practical question the tool result carries an IMPLEMENTING GUIDANCE block. Use it:
   an answer built only from the provision, when that block is non-empty, contradicts the
   material in front of you.
```

3. Pre-answer check 4 shrinks to two lines, since the mechanism now carries the obligation:

```
4. Depth. On a practical question, check that your answer cites at least one source from the
   IMPLEMENTING GUIDANCE block when that block is non-empty. On a lookup, check the opposite:
   if you have the provision, cut everything that is not it.
```

4. New pre-answer check 5, for GS-027:

```
5. Coverage. A question can carry several independent asks ("what does X stand for, and is it
   a Y?"). Before your first tool call, split it and search each part on its own terms: the
   trace of a dropped part is a first query framed only around the other one, and every later
   call inherits that framing. An answer that silently omits a part reads as a refusal the
   user did not ask for.
```

---

## STAGE B - after Stage A is green

### B1. `get_file_outline(file_id)`

**Closes**: GS-016 and GS-001. **Confirmed by trace 46d4f93a** (1.2): the Article 167 chunk was
not among the 47 candidates, so the agent could not have reached it by reformulating within the
same retrieval budget, and had no signal that its slice was partial. GS-001 is the same shape -
the DPS Launch checklist was found, point 6 was read, points 1 to 5 never were.

`outline_filter` is `file_filter_merger` verbatim; `outline_scan` is a `FilterRetriever` on the
same store; `outliner` reduces chunks to ordered, de-duplicated headers.

**Two conditions before this is worth building.** First, `return_embedding: false` must be added
to that store (a `filter_documents` over the whole FR returns 700+ pages of chunks with their
768-dim vectors); the COST note on `corpus_scan` says the parameter exists in the version
checked on 08/09/2026 but must be verified, since an unknown init parameter fails the whole
pipeline. Second, and more important: **an outline built from `header` is worthless for the FR**,
because `header` is the document title on every chunk (1.1). For the FR the outliner would have
to derive its entries from inline `## Article N ##` markers, which cover 26% of chunks. So B1
is genuinely useful for the guidance and tender documents, and only becomes useful for the FR
once the indexing fix in A3 lands. Sequence it after that, not before.

### B2. Named-instrument routing on `search_corpus`

**Closes**: GS-026. Generalise A1.2: a `named_document` parameter, and the primary layer
resolves to that document when it is non-empty, falling back to the FR when it is not. One BM25
name resolution (the `name_search` pattern proven in `list_corpus_files`), re-filtered on
`meta.file_name` in Python as the lister does, feeding `primary_filter`.

The agent then only has to report whether the user named an instrument, and if it reports
nothing the behaviour is exactly Stage A, so the change is monotone.

---

## 3. Out of scope for this YAML, in priority order

1. **FR indexing: `header` and chunk boundaries.** See A3. Highest value, blocks B1 for the FR,
   and is the root cause of the citation-label half of G1.
2. **Corpus deduplication.** A2 stops the twins reaching the panel, which is the user-visible
   half. Both copies still sit in the index, still compete in every ranking, and still consume
   retrieval slots. The `+` in the file names points at a second upload path; a listing filtered
   on `+` would size the problem.
3. **Reranker contention.** 31.6s vs 2.9s for identical work (1.5). Ten concurrent searches at
   125s. Worth a look at reranker sizing or at capping tool-call concurrency, but note that
   `parallel_tool_calls` is unverified on this gateway.
4. **The three infra errors** (GS-015, GS-020, GS-021: "pipeline is either still deploying or
   wasn't used for more than 1 day"). #UX008 / #UX017 / #UX021. A keep-alive before a campaign,
   and a harness that retries once on that exact error string instead of recording a result.
   Three scored zeros out of thirty distorts every metric in the sheet by 10%.
5. **The automatic scorer in the rerun sheet.** Anti-correlated with the metric that matters on
   the cases that matter: the three lowest `Answer Score` values (GS-008 0.337, GS-010 0.358,
   GS-029 0.364) are three answers that reproduce the expected answer verbatim, and
   `Source Score` penalises a `.docx` where a `.pdf` was expected (GS-003, same document) and a
   correct refusal with no expected source (GS-012). Do not tune 9j against it.

## 4. Header corrections to make in the YAML itself

- The **9g block** ends with "List of EUIs_04.2025.xlsx is not in the index. Next step is
  ingestion, not this YAML." GS-010 now cites that file with the correct Heraklion and Ares
  values. The ingestion landed; mark the block resolved rather than leaving a confirmed-absent
  claim that is no longer true.
- The **9c block**'s justification for keeping parallel tool calls ("four searches in 27s where
  sequential would be 50-60s") is contradicted by trace 7f6a49da: ten parallel searches, 125.5s.
  Record the measurement next to the assumption.
- The **9c block** predicted that parallel calls also break cross-tool dedup. That half was
  never fixed and is still live (1.3). A2 fixes it downstream; the note should say so.
