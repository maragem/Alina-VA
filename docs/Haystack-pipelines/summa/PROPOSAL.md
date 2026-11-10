# P.A.C.I.O.L.I. v2: proposed pipelines for the SUMMA assistant

Generated from `../kit/configs/summa.yaml`. Two deployable pipelines and four tool
sub-pipelines, all in `generated/`:

| File | What it is | Deployed? |
|---|---|---|
| `generated/summa-agent.yaml` | the main (query) pipeline: one agent, four tools embedded as PipelineTools | yes, as the chat pipeline |
| `generated/pacioli-indexing.yaml` | the indexing pipeline: Docling with OCR, multilingual-e5-large at 1024 | yes, attached to the index |
| `generated/tools/consult_reference_qa.yaml` | tool 0, curated Q&A as guidance | no: review view of a sub-pipeline embedded in the main one |
| `generated/tools/list_corpus_files.yaml` | tool 1, document name to file_id | no: review view |
| `generated/tools/search_corpus.yaml` | tool 2, corpus-wide hybrid search | no: review view |
| `generated/tools/search_in_file.yaml` | tool 3, the same search inside named documents | no: review view |

The tools are sub-pipelines in the ALINA sense: each wraps a small Haystack pipeline that
the agent calls as a function. They live inside the main YAML so that one deployment
carries everything; the files under `tools/` are the same content extracted for reading
and review. Edit the config and rebuild, never the generated files.

## 1. The main pipeline

```
files ──► multi_file_converter ──► attachment_metadata_stamper ──► attachment_formatter ─┐
                                                                                          ▼ seeds state.documents
query ─────────────────────────────────────────────────────────────────────────────────► AGENT (Claude Opus 5.5, Bedrock)
messages ──► history_sanitizer ───────────────────────────────────────────────────────►   │  max 8 steps, exits on text
                                                                                          │
                     ┌────────────────────────┬────────────────────────┬──────────────────┤
                     ▼                        ▼                        ▼                  ▼
            consult_reference_qa      list_corpus_files         search_corpus       search_in_file
                                                                       │                  │
                                               new passages appended to state.documents  ◄┘
                                                                       ▼
                               agent.messages + agent.documents ──► citation_renumberer ──► outputs
```

Inputs: `query`, `messages`, `files`. Outputs: `documents`, `messages`. Each output
document carries `meta.citation_number` and `meta.citation_token`.

What happens on a turn:

1. **Attachments** (if any) are converted, split to 250 words, stamped as `doc_type:
   attachment`, budgeted to 12 000 characters per passage and 40 passages, rendered into the
   first user message with citation tokens, and seeded into the agent's `documents` state.
2. **History** replayed by deepset is rebuilt as plain user and assistant text turns, so a
   follow-up such as "and for VAT?" is resolvable and no content-less message reaches the
   model.
3. **The agent** reads the system prompt (below), decides the question shape, and calls
   tools in a loop until it answers. Every search tool appends the new passages it found to
   the shared `documents` state and shows the model each passage with a six-character
   reference token.
4. **The citation renumberer** rewrites the tokens the model actually cited into `[1]`,
   `[2]`, `[3]` in order of first appearance, drops any token that does not resolve, and
   emits exactly the cited passages as `documents`. Only the rewritten answer leaves the
   pipeline.

The system prompt, in order: the P.A.C.I.O.L.I. persona; **the system and the corpus**
(what SUMMA is, how users refer to apps and tiles, which document families exist and that
release notes supersede older guides); the tools; the **routing procedure** with SUMMA's
four question shapes, authorisation, procedure, concept, troubleshooting; the ALINA
doctrine on how far to search, coverage of multi-part questions and never refusing before
searching; **search vocabulary** including the synonym groups and the glossary; the four
pre-answer checks, answerability, completeness, version, coverage; grounding; token
citations; the SUMMA-specific sections, scope, LAM referral, not-found wording and support
options copied verbatim from the current Pacioli prompt; style.

## 2. The tools

All four are `haystack.tools.pipeline_tool.PipelineTool`. The model sees a name, a
description and an explicit JSON schema; the schema never includes state-fed inputs.

### Tool 0: `consult_reference_qa(query)`

Curated support Q&A, consulted first on any procedure, concept or troubleshooting
question. One Code component with an in-memory TF-IDF-style match over the entries in
`../kit/qa/summa.yaml`, top 3 within 35 percent of the best score. Returns the matching
entries with the documents they rely on. The result is marked guidance only; the entries
never enter agent state and so can never be cited. **Ships empty**: with no entries the tool
tells the model to go straight to the search tools.

### Tool 1: `list_corpus_files(name_pattern)`

Resolves a document name, alias or abbreviation to `file_name` and `file_id`.

```
corpus_scan (FilterRetriever, split_id == 0: one chunk per file) ─┐
                                                                   ├─► lister (Code) ─► result
name_search (BM25 on the pattern, fuzziness AUTO, top 500) ───────┘
```

The lister merges both sources, matches the pattern as a regex, a substring, or by every
token appearing in the name in any order, and prints one JSON line per file with
`doc_type`, `version` and `document_date` ("unknown" when absent). An unfiltered listing
is capped at 600 files and says so in terms that forbid concluding a document is missing.

### Tool 2: `search_corpus(query)`

Corpus-wide hybrid retrieval, the same chain as in ALINA with a vocabulary expander added:

```
retrieval_query (cap at 100 words)
  ─► query_expander (appends the other forms of PO, VAT, BP, DEP, down payment, show, LAM)
     ─► bm25_retriever (top 30, fuzziness 0) ──────────────────┐
     ─► query_embedder (multilingual-e5-large, "query: ") ─► embedding_retriever (top 30) ─┤
                                              document_joiner (reciprocal rank fusion) ◄──┘
                                              ─► ranker (Qwen3-Reranker-0.6B, top 10)
                                              ─► sentence_window_retriever (1 chunk each side)
                                              ─► window_joiner ─► ranker_scoring (top 30, scaled)
                                              ─► meta_field_grouping_ranker (by file_id, in split order)
                                              ─► result_formatter (tokens, dedup against state, 30 passages max)
```

The model's own query, not the expanded one, is what both rerankers score against. The
formatter renders each passage as a `<document>` element with its reference token, source,
section, page and, when present, `doc_type`, `version` and `document_date`, and closes
with the instruction to search again if the governing document is not among the results.
An empty result is phrased as a fact about the query, not about the corpus.

### Tool 3: `search_in_file(query, file_ids)`

The same chain with a `file_filter` Code component in front that turns the model's
`file_ids` into a retriever filter for both retrievers. Used after `list_corpus_files` for
any question about a named document, and to open the governing document when
`search_corpus` has pointed at it. Its empty result forbids telling the user the document
lacks the information until a second formulation has also failed.

## 3. The indexing pipeline

```
files ─► file_classifier (raise_on_failure false)
   txt ─► text_converter ─────────────────────────────────────────► splitter (250/50/30) ─────┐
   pptx ─► pptx_converter ────────────────────────────────────────► splitter ───────────────────┤
   md ─► markdown_converter ─┐                                                                  │
   html ─► html_converter ───┤                                                                  │
   pdf ─► docling_pdf (OCR, tables, picture description) ─┤                                     │
   docx ─► docling_docx (OCR, tables, picture description) ┼─► structure_promoter ─► document_cleaner ─► MarkdownHeaderSplitter (250/50/30) ─┤
   png, jpeg ─► docling_png / docling_jpeg (OCR, description, enrichment) ─┘                   │
   xlsx ─► xlsx_converter ─┐                                                                    │
   csv ─► csv_converter ───┴─► table_splitter (40 lines, 4 overlap) ────────────────────────────┤
                                                                           split_joiner ◄──────┘
                              ─► metadata_finalizer ─► document_embedder (multilingual-e5-large, "passage: ", header embedded) ─► writer (OVERWRITE)
```

Against the current Docling indexer this adds: an explicit index name; every format
through a splitter, so spreadsheets and images are listable and the sentence window works;
250-word chunks instead of 512, which the embedder truncates; the `passage: ` prefix; the
structure promoter with the numbered profile for manuals, a cleaner for repeated headers
and footers, and a page sentinel so page numbers survive the cleaner; a composed `header`
of file name and section embedded with each chunk; `version`, `document_date` and
`doc_type` derived from the file name when upload metadata is absent; and `split_id`
guaranteed on every chunk.

## 4. What must be filled in before deployment

1. `store.index` in `../kit/configs/summa.yaml`: the real name of the index the Docling
   indexer writes to (shown in deepset Studio under Indexes). The config carries the
   placeholder `pacioli-docling`. If this pipeline re-indexes, use a new name and keep the
   old index serving until the new one is validated.
2. `../kit/qa/summa.yaml`: the curated Q&A from helpdesk tickets and the peer-exchange
   channel.
3. Optional: `prompt.system_description` in the config, written from the first SUMMA
   presentation page rather than from my summary of it.

Then rebuild:

```
cd ../kit
python build_pipeline.py configs/summa.yaml -o ../summa/generated/summa-agent.yaml --tools-dir ../summa/generated/tools --check
python build_indexing.py configs/summa.yaml -o ../summa/generated/pacioli-indexing.yaml --check
```

## 5. Deployment order

1. Thirty golden questions from real tickets, run against the current Pacioli, failures
   classified. This is the baseline everything is measured against.
2. Tool-calling isolation test on Bedrock: a throwaway pipeline with the same generator and
   one trivial tool, no streaming. A `tool_invoker` span under about 20 milliseconds in the
   trace means no tool ran.
3. Deploy `summa-agent.yaml` unstreamed against the existing Docling index. Run the golden
   questions. This measures the agent on its own.
4. Set `generator.streaming: true`, rebuild, redeploy, confirm tool calls still work.
5. Index with `pacioli-indexing.yaml` under a new index name, point the config at it,
   rebuild the agent, run the golden questions again. This measures the retrieval gains on
   their own.
6. Iterate from deepset traces, never from hunches. After any change: the kit tests and the
   build with `--check`.

Expect a latency cost: ALINA's agent averages 37 seconds per answer against a few seconds
for the fixed chain.
