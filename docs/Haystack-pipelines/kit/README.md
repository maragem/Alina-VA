# Agent-RAG kit: one architecture, many corpora

A reusable way to build a deepset (Haystack) virtual assistant over any curated document
corpus, distilled from ALINA (procurement, `../v1-agent-9k.yaml`) and applied to SUMMA
(`../summa/`). The architecture and the engineering lessons are fixed; what differs
between use cases is a short config. The build is deterministic and checked.

```
kit/
  README.md              this file: architecture, decision guide, how to adopt
  build_pipeline.py      config -> agent (query) pipeline YAML
  build_indexing.py      the SAME config -> indexing pipeline YAML
  components/*.py        the Code components, as importable, unit-tested Python
  configs/*.yaml         one per use case (summa, procurement-authority, minimal)
  checks/verify_pipeline.py   structural checks for any built agent pipeline
  checks/verify_indexing.py   structural checks for an indexing pipeline + agreement with the config
  tests/                 pytest: components, builds, verifiers, equality with the hand-written SUMMA draft
```

One config drives both pipelines. The index name, the embedding model and the embedding
dimension are written once and read by both builders, so the query side and the index can
never disagree, which is the first thing that went wrong in the Pacioli pipelines.

Requirements for building and testing: `pip install haystack-ai pyyaml pytest`. No deepset
workspace, OpenSearch or model access is needed until deployment.

## 1. The architecture

```
files ──► converter ──► stamper ──► attachment_formatter ─┐ (seeds state.documents, rendered in turn 1)
                                                          ▼
query ─────────────────────────────────────────────────► AGENT ◄── messages ◄── history_sanitizer
filters (optional, entitlement) ───────────────────────►  │  state field, never a model argument
                                                          │
          ┌──────────────────────┬────────────────────────┼─────────────────────┐
          ▼                      ▼                        ▼                     ▼
 consult_reference_qa     list_corpus_files          search_corpus        search_in_file
 (expert Q&A, guidance    (name -> file_id,          (hybrid chain,       (same chain,
  only, never cited)       metadata per file)         corpus-wide)         file_id filter)
                                                          │                     │
                                   both search tools append NEW passages to state.documents
                                                          ▼
                      agent.messages + agent.documents ──► citation_renumberer ──► outputs
```

One `haystack.components.agents.agent.Agent` decides how many searches to run and with
which terms, bounded by `max_agent_steps` and an exit on text. Every tool is a
`PipelineTool` wrapping a small sub-pipeline, so the retrieval chain is declared once per
tool in YAML and the document stores are deserialised by deepset (a store built in Python
never receives the cluster credentials).

**The retrieval chain**, identical in both search tools: BM25 and e5-base-v2 dense
retrieval over OpenSearch, reciprocal rank fusion, a Qwen3 reranker to top 10, a
sentence-window expansion of one chunk on each side, a rescoring pass over the expanded
set, grouping by document (or by an authority field), and a formatter that renders each
passage with a stable six-character citation token derived from the document id.

**Citations.** The model cites tokens, never numbers. After the answer, the renumberer
rewrites the tokens the model actually used into `[1]`, `[2]`, `[3]` in order of first
appearance and emits exactly those passages, in that order, as `documents`, each carrying
`meta.citation_number` and `meta.citation_token`. A token the model invented is dropped
rather than numbered, so numbering can never shift onto the wrong passage.

**History.** The application sends no messages; deepset replays prior turns. The sanitizer
rebuilds them as plain user and assistant text, dropping tool-call residue and anything
content-less, because an Agent hands the list straight to the generator, which rejects an
empty message.

**Entitlement (optional).** Per-user filters arrive as a pipeline input, live in agent
state, and are ANDed into every retriever by Code components. They are never a model
argument: a state-fed parameter must be kept out of the tool's explicit `parameters`, or
PipelineTool derives a schema that asks the model to supply it.

### What the config supplies

| Section | What it decides | Example values |
|---|---|---|
| `generator` | Bedrock or OpenAI-compatible gateway, model, streaming | `bedrock` + `eu.anthropic.claude-opus-5-5`; `openai` + `gpt-5.1` + base URL + key env var |
| `store` | index name, embedding dim, extra store params | `pacioli-index`; `use_ssl: false` |
| `retrieval` | top-k values, models, window, grouping fields | `group_by: file_id` or `authority_rank` |
| `features` | the four flags below | |
| `metadata` | which metadata is shown on passages and listings, how listings sort, what attachments are stamped with | `[doc_type, version, document_date]` or `[authority_rank]` |
| `limits` | per-passage characters, passages per call, files per listing, attachment chunks, history turns | |
| `reference_qa` | the curated entries, domain stopwords, tool description | from helpdesk tickets |
| `tools` | tool descriptions and the formatter texts | |
| `prompt` | persona, routing procedure, completeness and ranking rules, domain sections, style | |

Feature flags:

- `entitlement_filters`: per-user scoping through a `filters` input. Off for one shared corpus.
- `attachments`: a `files` input, converted, budgeted and seeded into state as citable passages.
- `reference_qa`: the expert Q&A tool. Ship it filled; an empty set tells the model to skip it.
- `named_document_tools`: `list_corpus_files` and `search_in_file`. Needed when users name documents.

What the config does **not** let you change, on purpose: the exit condition, the state
shape, token citations, the sanitizer, the renumberer, explicit tool schemas, and the
prompt doctrine (the "no tool result is a licence to stop", coverage, answerability,
grounding and citing rules). Those encode the measured lessons below.

## 2. Lessons encoded, and where

Each of these cost at least one deployment on ALINA. The kit makes them structural.

| Lesson | Where it lives |
|---|---|
| A tool result that reads as "no further search is needed" stops the model; the number of distinct searches was what retrieval quality depended on (9j: 7 regressions) | every `result_formatter` branch ends by naming when to search again; verifier rejects stop phrases |
| Reranker score thresholds turn a badly phrased query into "not found"; reformulation is the fix | no threshold in the chain; verifier rejects one |
| A listing that silently truncates makes the model conclude a document is absent | lister caps only unfiltered listings and says so in terms that forbid the conclusion |
| Users type names in a different word order | lister matches when every token appears in the name, in any order |
| `inputs_from_state` does not hide a parameter from the model's tool schema | explicit `parameters` on every tool; verifier checks state-fed inputs are absent from them |
| A document store built in Python never gets deepset's credentials | stores only appear as YAML `init_parameters` of real components |
| Positional citations break as soon as documents accumulate across tool calls | token citations plus the renumberer |
| Replayed history can carry content-less messages that kill the generator | history sanitizer |
| Scanning chunks hits the store's 10 000-hit cap; scan files instead | `split_id == 0` filter on the scan |
| Missing structural metadata (headers) cannot be fixed at query time | README section 4: check the indexing pipeline first |

## 3. Decision guide: do you need the agent at all?

Start from a fixed chain if you have one. Build 30 golden questions from real tickets, run
the fixed chain, and classify the failures. The agent pays for itself only on these:

- **Multi-part questions** answered by half.
- **Vocabulary misses** where one reformulation would have found the passage.
- **Named documents** ("what does the release note say") answered from another source.
- **Procedures cut across chunks**, which the sentence window alone may already fix inside a fixed chain.

If none of those appear, keep the fixed chain and only take the retrieval improvements
(window expansion, no threshold, header-aware indexing). Expect the agent to cost latency:
ALINA 9k averages 37 seconds per answer against a few seconds for a fixed chain.

## 4. Adopting the kit for a new corpus

1. **Index first.** Confirm the index carries `file_id`, `file_name`, `split_id` restarting
   at 0 per file, `page_number`, and a `header` per chunk from a header-aware splitter.
   Decide the ranking metadata (version and date, or authority) and attach it at ingestion.
   ALINA's `../indexing-v06.yaml` is the reference indexing pipeline (Docling with OCR,
   structure promoter, Markdown header splitter at 250 words with 50 overlap).
2. **Copy `configs/minimal.yaml`**, set the index and the persona, build with `--check`:
   ```
   python build_pipeline.py configs/<name>.yaml -o <out>.yaml --check
   ```
3. **Isolation test on the generator.** A throwaway pipeline with the same chat generator
   and one trivial tool, no streaming. In the trace, a `tool_invoker` span under about 20
   milliseconds means no tool ran at all. Only then import the built pipeline.
4. **Deploy unstreamed**, run two golden questions (a procedure, a named document), then
   enable `generator.streaming` and redeploy.
5. **If `entitlement_filters` is on, run the security gate** before any user sees it: a
   user scoped to one project must not be able to retrieve or list another project's files.
   Filters arriving as `None` expose the whole corpus, silently.
6. **Fill `reference_qa.entries`** from real tickets, and switch on `named_document_tools`
   only if the golden set shows named-document questions.
7. **Iterate from traces, not hunches.** Fixtures for new tests come from a trace. After any
   change: `pytest tests` and the build with `--check`.

## 4b. Indexing: what the agent pipeline needs from the index

`build_indexing.py` produces the indexing pipeline from the same config. Its shape is
ALINA's indexing-v06, generalised:

```
files -> file_classifier -> one converter per format
   md, html, pdf, docx, doc, odt, png, jpeg -> structure_promoter -> document_cleaner -> MarkdownHeaderSplitter ─┐
   txt, pptx                                -> splitter ──────────────────────────────────────────────────────────┤
   xlsx, csv                                -> table_splitter ────────────────────────────────────────────────────┤
                                                                              split_joiner <────────────────────┘
                                                              -> metadata_finalizer -> document_embedder -> writer
```

Formats: `txt md html pdf docx pptx xlsx csv png jpeg doc odt`, chosen per config. PDF,
DOCX and images go through Docling (OCR, table structure, optional picture description,
always on for images); `.doc` and `.odt` through Kreuzberg. Each rule below is enforced
by `checks/verify_indexing.py`, and each one was a real failure in ALINA or Pacioli.

| Rule | Why |
|---|---|
| Same index name, embedding model and dimension on both sides | A 768-dimension query vector cannot search a 1024-dimension field. The Pacioli indexer embedded with multilingual-e5-large at 1024 while its query pipeline embedded with e5-base-v2 at 768. The config has one value for each; both builders read it. |
| Name the index explicitly on the writer | Without `index`, deepset writes to the workspace default and nothing proves the query pipeline reads the same index. |
| e5 models get `passage: ` on documents and `query: ` on queries | The e5 family is trained with these prefixes; without them dense scores degrade across the board. Derived from the model name in one function used by both builders. |
| Every format passes through a splitter | The file listing enumerates files by `split_id == 0`, and the sentence window walks `split_id`. A converter wired straight into the embedder (Pacioli's XLSX, CSV and images) produces chunks with no `split_id`: invisible to `list_corpus_files`, and one oversized chunk per sheet. |
| Chunks of at most 300 words, default 250 with 50 overlap | e5 models truncate at 512 tokens. At 512 words the second half of every chunk is never embedded. |
| `split_threshold` above 0 on the header splitter | A threshold of 0 emits header-only fragments, which are retrieval noise the reranker latches onto. |
| Structure promoter before the cleaner, page sentinel in the header splitter | The cleaner's whitespace collapsing swallows form feeds, so page numbers all become 1. The promoter swaps the form feed for a printable sentinel, the splitter counts it, the finalizer strips it. |
| Headers promoted from visual structure | Docling does not emit headings for visually formatted titles; the header splitter then has nothing to cut on and every chunk inherits one header. Profiles: `numbered` for manuals and guidance, `legal`, `contract` and `judgment` for law. Detection per document keeps paragraph numbering from being promoted. |
| `header` composed as `<file_name> | <section>` and embedded with the chunk | It is the label in the sources panel, the field the rerankers embed, and the context a mid-section chunk carries in its own vector. |
| Ranking or version metadata present on every chunk | File-level metadata attached at upload propagates to every chunk and always wins. `indexing.filename_rules` derive `version`, `document_date` and `doc_type` from the file name as a fallback. `indexing.meta_defaults` gives the field the agent groups on a value, so unranked files sort last instead of forming a null group. |
| Re-index after any change, under a new index name | Index-time metadata never applies retroactively. A new name keeps the old index queryable until the new one is validated; bump the config and rebuild both pipelines. |

Changing the embedding model is therefore two config lines plus a new index name:
`retrieval.embedder_model` and `store.embedding_dim`. The tests include that switch.

## 5. Checks and tests

- `checks/verify_pipeline.py <pipeline.yaml> [config.yaml]`: structural checks on any
  pipeline built to this architecture: graph integrity, compiling code, explicit schemas
  with state-fed inputs hidden, one index everywhere, chain shape, no reranker threshold,
  no stop signals, doctrine fragments in the prompt, identical citation token function.
  Pipelines that predate the kit (ALINA 9k) fail a few checks on naming and wording; that is
  expected and informational.
- `tests/test_components.py`: every Code component against real `haystack` classes,
  including the substitution paths the builder uses.
- `tests/test_build.py`: every config builds, round-trips through YAML, passes the
  verifier, and its prompts render through Haystack's `ChatPromptBuilder`. The SUMMA build
  is asserted structurally identical to the hand-written `../summa/summa-agent-draft-1.yaml`
  (everything except code bodies and prompt wording).
- `checks/verify_indexing.py <indexing.yaml> <config.yaml>`: the indexing rules of section
  4b, plus agreement with the config: index, dimension, model, prefixes, and a note when the
  agent shows a metadata field nothing derives.
- `tests/test_indexing.py`: structure promoter and metadata finalizer against real haystack
  classes, every config's indexing build, agreement between the indexing and agent builds
  of one config, and the embedding-model switch changing both sides.

## 6. Known limits of this version

- One retrieval chain shape. ALINA 9k's second retrieval layer inside `search_in_file`
  (implementing guidance alongside the legal provision) and its `question_shape` parameter
  are domain-specific and not in the kit. Add them as a feature if a second use case needs them.
- Bedrock and OpenAI-compatible generators only. Other Haystack chat generators can be
  added in `chat_generator()`.
- The attachment converter in the agent pipeline is PACIOLI's (pdfminer, docx, pptx, xlsx,
  csv), lighter than the indexing converters on purpose: it runs on every turn that carries
  a file. For scanned PDFs or `.doc`/`.odt` attachments, reuse the indexing converters.
- Comments inside the generated YAML are limited to the header; the reasoning lives here
  and in `components/*.py`.
