# ALINA v1 - Agent pipeline design

Status: DESIGN, not deployed. Companion draft: `v1-agent.yaml` (to be reconciled in the deepset Builder before any deployment - see "Verification plan").

## 1. Problem

The v0.x pipeline is a fixed retrieve-then-generate chain over the whole entitled corpus. When a user targets a **specific document by name**, e.g.

> "What is the definition of DPS regarding the FR"

the user expects the answer to quote **Financial Regulation (2024).pdf**. But nothing in the pipeline can (a) detect that the question targets one document, (b) resolve the alias "the FR" to a file in the index, or (c) constrain retrieval to that file. Hybrid retrieval simply returns the best-matching DPS definitions corpus-wide (vademecum, Q&A logs, ...), so the answer is *correct but cited from the wrong source*.

A fixed pipeline cannot solve this without brittle query-classification heuristics. An **agent** can: the LLM reads the question, decides whether it targets a named document, resolves the name against the index, and searches inside that file - falling back to the normal corpus-wide search otherwise.

## 2. Contract: only the pipeline's I/O is kept

The new pipeline is a separate deepset pipeline. The application does not change: same chat-stream endpoint, same request body, same outputs. Switching is a `HAYSTACK_PIPELINE` / `HAYSTACK_PIPELINE_ID` env change.

| Socket | v0.x | v1 agent |
|---|---|---|
| in `query` | retrieval_query + chat_prompt_builder | agent `user_prompt` variable |
| in `filters` | both retrievers | agent state field `filters`, injected into every tool (entitlement - never under LLM control) |
| in `messages` | chat_prompt_builder | `history_sanitizer` -> agent native `messages` input |
| in `files` | attachment branch (v0.9 draft) | same attachment branch, feeding the agent's `documents` state |
| out `documents` | meta_field_grouping_ranker.documents | agent state `documents` (accumulated across tool calls) |
| out `messages` | LLM.messages | agent messages (see open question O2) |
| streaming | LLM streaming_callback | agent streaming_callback (same deepset callback) |

Everything between input and output is rebuilt from zero around one `haystack.components.agents.agent.Agent`.

## 3. Architecture overview

```
files ──► attachment_converter ──► attachment_metadata_stamper ─┐
                                                                ▼ (documents state, always in context)
query ──────────────────────────────────────────────────────► AGENT ◄── messages (history)
filters ────────────────────────────────────────────────────►  │  (state field, LLM never sees/sets it)
                                                               │
                 ┌─────────────────────┬───────────────────────┼─────────────────────┐
                 ▼                     ▼                       ▼                     ▼ (optional)
        list_corpus_files        search_corpus           search_in_file        get_file_outline
        (resolve names/aliases)  (= v0.x retrieval,      (v0.x retrieval +     (browse a file's
                                  corpus-wide)            file_id filter)       section headers)
                 │                     │                       │                     │
                 └───────────► every search tool appends its documents to agent state
                                                               │
                                        state.documents ──► outputs.documents (sources panel)
                                        final text (streamed) ──► outputs.messages
```

The agent loop (exit condition `text`, `max_agent_steps` ~= 8): the LLM either answers directly from what it already has, or calls tools - possibly several times (name resolution, then targeted search, then a corpus-wide check) - before producing the final grounded answer.

## 4. The tools

Tool descriptions are load-bearing: they are what makes the agent route named-document questions correctly. The descriptions below are part of the design, not placeholders.

### 4.1 `list_corpus_files` - resolve a document name or alias

The tool that unlocks the problematic case. The LLM cannot know that "the FR" is `Financial Regulation (2024).pdf`; this tool lets it find out.

- **LLM-facing parameters**: `name_pattern` (optional, case-insensitive substring/regex, e.g. `financial regulation`). Empty pattern lists everything.
- **From state (hidden from LLM)**: `filters` - the entitlement filters. Non-negotiable: the listing must never reveal files the user is not entitled to (project isolation).
- **Returns** (compact JSON, one line per file): `file_name`, `file_id`, `authority_rank` / authority label, chunk count. Bounded (e.g. 300 files max) - fine at pilot corpus size.
- **Implementation**: a `FilterRetriever` (document store declared in YAML) applying the entitlement filters, followed by a `Code` component that reduces the returned chunks to distinct files and applies the name pattern on `meta.file_name`. O(entitled chunks) per call - acceptable at pilot scale, and exhaustive/deterministic. Escalation when the corpus grows: `return_embedding: false` on the store (strips the 768-dim vectors, the bulk of the payload - verify the parameter exists first), then an OpenSearch `terms` aggregation on `file_name`, or a BM25 retriever on the name pattern if an exhaustive listing is no longer needed.
- **Hard constraint learned at first deployment**: the document store cannot be instantiated in Python inside a `Code` component. deepset injects the real cluster host and credentials through the store's `from_dict` hook, i.e. only when the store is **declared in YAML** as a component's `init_parameter`. A store built in Python keeps the library defaults and fails with `ConnectionError(HTTPConnection(host='localhost', port=9200))`. Any tool needing index access must therefore route it through a component that accepts `document_store`.
- **Description (for the LLM)**: "List the documents available in the corpus, optionally filtered by a name pattern. Use this FIRST whenever the user refers to a specific document by name, alias or abbreviation (e.g. 'the FR', 'the vademecum', 'in document X'), to resolve it to an exact file_name and file_id. Returns nothing if no accessible file matches."

### 4.2 `search_corpus` - the v0.x behaviour, wrapped as a tool

Preserves current functionality exactly. The whole v0.x retrieval chain becomes a `PipelineTool`:

`retrieval_query cap -> BM25 (top_k 30) + e5 embedder/embedding retriever (top_k 30) -> DocumentJoiner RRF -> Qwen3 reranker pass 1 (top_k 10, batch 8) -> SentenceWindowRetriever (window 1) -> window_joiner dedup -> Qwen3 reranker pass 2 scoring (top_k 30, batch 8, scale_score) -> meta_field_grouping_ranker -> result_formatter`

- **LLM-facing parameters**: `query` (a short, self-contained search query the agent formulates).
- **From state**: `filters` (entitlement), `documents` (already-collected docs, for dedup + reference numbering - see §5).
- **Returns to the LLM**: the retrieved passages rendered exactly like the v0.6 `<documents>` block (reference number, source, section, page, per-doc truncation) so all the prompt engineering about quoting/citing carries over.
- **To state**: the new unique documents, appended.
- **Description**: "Search the whole document corpus. Use for any question not targeting one specific document, or to check whether a higher-authority source also covers a rule found elsewhere."

Note: the v0.8 100-word retrieval cap is kept inside the tool as a guard, but the agent largely dissolves that problem - the LLM writes short queries instead of the app concatenating history into `query`. The v0.8 maxClauseCount and v0.7 OOM pressure both shrink.

### 4.3 `search_in_file` - the targeted search

Same retrieval sub-pipeline as 4.2 with one extra component in front: a `FileFilterMerger` (`Code`) that ANDs the entitlement filters from state with `{"field": "file_id", "operator": "in", "value": file_ids}`.

- **LLM-facing parameters**: `query`, `file_ids` (list, from `list_corpus_files`).
- **From state**: `filters`, `documents`.
- **Returns / state**: same contract as 4.2.
- **Description**: "Search INSIDE one or more specific documents, identified by file_ids obtained from list_corpus_files. Use whenever the user asks what a specific document says, defines or requires. If this returns nothing relevant, say so rather than silently substituting another source."

Design choice: two tools (4.2 / 4.3) rather than one tool with an optional `file_ids` argument. Two distinct descriptions steer the model much more reliably ("user names a document -> search_in_file"), and the filter logic stays trivial in each.

Entitlement invariant: `file_ids` chosen by the LLM are ANDed with the server-side entitlement filters - a hallucinated or non-entitled file_id yields zero documents, never a leak. Same invariant as today, enforced in the same place (filters), not by trusting the model.

### 4.4 `get_file_outline` - optional, v1.1

For the stubborn cases where semantic search inside the file misses (e.g. a definition living in an annex with unusual wording): `filter_documents(file_id)` sorted by `split_id`, returning the ordered list of `header` / `parent_headers` (+ split_id ranges), so the agent can locate a "Definitions" section and then `search_in_file` with the section's own vocabulary. Cheap (metadata only), but adds a step; ship v1 without it, add if UAT shows residual misses. (A `read_file_section(file_id, split_id range)` twin is the natural follow-up but its context cost needs a budget first.)

## 5. State, citations and the sources panel

The Achilles heel of agent RAG is keeping `[n]` citations in the answer aligned with the `documents` array the frontend renders. Design:

- Agent `state_schema` declares `documents: list[Document]`. Every search tool appends its **new** documents to it; the pipeline's `documents` output is exactly this list, in accumulation order. The post-agent `meta_field_grouping_ranker` of v0.x is **dropped from the output path** (it would reorder and break numbering); grouping by authority/file/split now happens **inside each tool** before appending, so same-file chunks stay adjacent.
- Each tool's `result_formatter` (`Code`) receives the current `state.documents` via `inputs_from_state`, dedups the new batch against it (by document id), and numbers the rendered block with **global** references: first new doc gets `len(state.documents) + 1`. A re-retrieved chunk is not re-appended; the formatter re-renders it under its existing number (cross-tool-call corroboration stays citable).
- Attachments are stamped (authority_rank 0, sequential split_id, `Attached file:` header - unchanged from the v0.9 draft) and injected as the **initial** value of `state.documents`, so they occupy references 1..k and are always visible to the model without any tool call. They are rendered into the agent's first turn by the `user_prompt` template.
- The v0.6 context budget (12k chars/doc, 240k total) moves into the formatter: per-doc truncation with the `truncated="true"` marker kept verbatim; plus a per-call doc cap. `max_agent_steps` bounds total accumulation.

## 6. Prompting

- **System prompt**: v0.6 system prompt carried over almost intact (persona, answer-only-from-documents, completeness/exceptions, authority hierarchy, verbatim quoting, citation format, style, boundaries), with two edits: "documents supplied in the user message" becomes "documents returned by your tools", and a new **Tool policy** section: resolve named documents first (`list_corpus_files` -> `search_in_file`); when the named document does not contain the answer, say so explicitly and only then offer what other sources say (citing them as such - this is the exact fix for the DPS/FR case: the answer must lead with the FR's own definition, or state that the FR does not define it); default to `search_corpus` otherwise; searches are short reformulated queries, not pasted history; stop searching once the passages answer the question.
- **User prompt**: renders `query` plus the stamped attachments block. Conversation history flows through the agent's native `messages` input, replacing the `<conversation_history>` template block. The three pre-answer checks of v0.6 (answerability, completeness, source selection) stay, moved to the system prompt.

## 7. What is preserved vs v0.x

Preserved: hybrid BM25+dense retrieval, RRF, two-pass Qwen3 reranking with the v0.7 memory settings, sentence-window context recovery with dedup and true rescoring (v0.6 fixes), authority grouping (now per tool call), the full grounding/citation prompt doctrine, entitlement filtering semantics, attachment handling (v0.9), streaming, and the app-facing contract.

Changed: no more single fixed retrieval per turn (the agent decides how many searches and with what queries); citation numbering is accumulation-ordered; `retrieval_query` cap becomes an in-tool guard; `chat_prompt_builder` disappears (its rendering logic splits between `user_prompt` and the tool formatters).

## 8. Risks and open questions

- **O1 - Latency/GPU.** A turn may now run 2-3 retrievals = up to 6 reranker passes on the shared Triton ensemble (v0.7 pressure multiplied). Mitigations: batch_size 8 kept, `max_agent_steps` low, system prompt says stop searching once answered. Watch the OOM signature during UAT; if it recurs, drop the scoring pass inside tools first.
- **O2 - `messages` shape, both directions.** Confirmed at runtime on the input side: the app sends no `messages` at all - deepset rebuilds prior turns from `search_session_id` / `chat_history_limit: 20` and injects them. Now that assistant turns carry tool calls, that replay can yield a content-less `ChatMessage`, which the generator rejects when it serializes the conversation (`A ChatMessage must contain at least one TextContent...`). Fixed by `history_sanitizer`, which rebuilds the history as plain user/assistant text turns: history is context for resolving follow-ups, never the agent's own tool trace. Output side still to check: agent `messages` includes tool-call and tool-result messages, unlike `LLM.messages`; if the app persists it verbatim, add the trailing `OutputAdapter` selecting `last_message` (commented in the draft).
- **O2b - Empty ChatMessage inside the agent loop (root cause found, fix in draft 6).** Second trace: `chat_generator` 885ms ok -> `tool_invoker` **6ms** ok -> `chat_generator` 5ms FAIL, total tokens 0, with reasoning already disabled. A `ToolInvoker` returning in 6ms is a no-op, not a fast failure: the assistant message carried **no tool call**. Haystack's streaming assembler drops a tool call whose accumulated arguments are empty or invalid JSON with only a log warning, then returns `ChatMessage.from_assistant(text=None, tool_calls=[], ...)` - an empty message that `exit_conditions: [text]` does not match either, so the loop runs again and dies serializing it. Cause of the malformed arguments: without an explicit `parameters`, `PipelineTool` derives the tool schema from `input_mapping`, which also listed `filters` and `state_documents` - the model was being asked to emit a `list[Document]` argument. **This resolves [U1'] in the negative: `inputs_from_state` does NOT hide a parameter from the LLM schema**, so state-fed inputs must be kept out of `parameters` by hand - a security requirement for `filters`, not just a correctness one. Consistent with `list_corpus_files` having worked earlier (its derived argument was a plain string). Residual suspect if the fix is insufficient: the streaming assembly itself against the EC proxy - test by removing `streaming_callback` from the agent.
- **O2c - superseded hypotheses, kept to avoid re-testing them.** Replayed history (fixed anyway by `history_sanitizer`, but not the cause - call 1 succeeded on that same list) and reasoning round-trip (disproved: reproduced identically with reasoning off). Trace: `chat_generator` 922ms ok -> `tool_invoker` 16ms ok -> `chat_generator` 15ms FAIL, in one Agent Run. 15ms = failure during outgoing serialization, before any network call. The raise fires only when a message has none of texts/tool_calls/tool_call_results/images/reasonings/files, and call 1 succeeded on the same list minus the last two entries, so the empty message is added by the loop - `history_sanitizer` does not address this. Leading hypothesis: on the Responses API a reasoning model returns a `reasoning` item next to the `function_call`; with an effort set but no summary requested it carries no text, yielding a content-less message that is fatal when replayed. Diagnostic settings in draft 5: reasoning disabled, `raise_on_tool_invocation_failure: true`. Secondary anomaly to explain either way: `tool_invoker` returned in 16ms, far too fast to have reached OpenSearch, so that tool call almost certainly threw.
- **O2d - Streaming as the structural suspect (draft 7).** The decisive re-reading of both traces: `tool_invoker` returned in 16ms and then 6ms - both no-ops. **No tool has ever executed**, so the first generator call returns an empty assistant message every time, which rules out per-tool schema problems (draft 6) as the root cause. The one structural novelty versus v0.x is sending `tools` at all: tool calls stream as different SSE events than text, and a gateway that implements text streaming but not function-call argument deltas leaves the assembler with an empty arguments string, which it drops with a warning. Draft 7 removes `streaming_callback` from the agent; answers arrive in one block and the app copes (`finalizeBlock` already handles the result event). Two checks settle it: the Logs tab warning "malformed JSON string for tool call arguments" (present = transport, absent = upstream), and a 5-minute isolation pipeline with one trivial `CodeTool` and no streaming. If tool calling turns out to be unavailable through the EC endpoint, **Plan B** is to solve the named-document problem without an agent: a `ConditionalRouter` in front of retrieval, fed by an extraction step that spots a document reference and resolves it against the file list, routing to a file-filtered branch or the normal one.
- **O3 - Streaming UX.** With the deepset streaming callback on the agent, tool-call deltas may stream interleaved with text. Verify what the Chat Stream v1 endpoint emits for agents and whether the frontend needs to skip tool-call frames.
- **O4 - YAML literal shapes.** Partially resolved by the first import (draft 2): `inputs_from_state` is `{state_key: param_name}` with string values, fan-out to internal sockets stays in `input_mapping` (lists), `outputs_to_state` is `{state_key: {source: ...}}`, and `outputs_to_string: {source: result}` selects the LLM-facing tool result. deepset's native custom-code tool is `deepset_cloud_custom_nodes.tools.code_tool.CodeTool` (`@tool` function in `code`), but `list_corpus_files` stays a `PipelineTool` because it must receive the entitlement filters from state. Still open: state-field pipeline inputs (`filters`, seeded `documents`), the `attachments` user_prompt variable, and **[U1']** whether state-fed parameters are hidden from the LLM's tool schema and win over model-supplied values (security-relevant for `filters` - test in the playground).
- **O5 - `file_id` vs `meta.file_id` in filters.** The merger must use the exact field spelling the app already sends in `filters` today. Check search-stream/route.ts before deploying.
- **O6 - Non-determinism.** The same question may take different tool paths run to run. UAT gold-standard checks (GS-001/006/011 etc.) should assert on cited sources, not on tool traces.

## 8b. Root cause of the empty-ChatMessage saga, and what it cost

Established 31/08/2026 by isolation test: **the ECGPT gateway does function calling on `/chat/completions`, not on `/responses`.** With `OpenAIResponsesChatGenerator` and `tools`, the endpoint returns HTTP 200 with output that maps to no tool call; Haystack builds an empty assistant message, `exit_conditions: [text]` does not match it, and the next loop iteration dies serializing it. v0.x never hit this because it never sent `tools`.

Fast identification next time: a `tool_invoker` span under ~20ms is a **no-op**, not a fast failure, and no tool component appears in the deployment logs at all; `Total tokens 0` despite a real 200 response confirms it.

Four hypotheses were tested and are wrong - do not re-test them: replayed chat history, the reasoning round-trip, tool schemas derived from `input_mapping`, and the streaming assembly. Each cost a deployment. Two of the resulting changes are worth keeping on their own merits (`history_sanitizer`, explicit tool `parameters`); the reasoning and streaming settings are to be restored.

## 9. Verification plan

Deployment order, one variable at a time:

1. **Deploy as-is** (Chat Completions, streaming off, reasoning off) and run the two golden questions: (a) "What is the definition of DPS regarding the FR" must cite Financial Regulation (2024).pdf or explicitly say the FR does not define it; (b) a corpus-wide question must behave like v0.x. Confirm in the trace that tool spans actually execute (a `tool_invoker` under ~20ms means they did not).
2. **SECURITY GATE - do not skip, do not defer past this point.** Draft 6 established that `inputs_from_state` does NOT hide a parameter from the LLM schema, which is why `filters` is now excluded from every tool's explicit `parameters`. That fix must not have broken the state injection itself: verify in the trace that the retrievers inside the tools received the entitlement filters. Concretely: ask a question as a user scoped to one project and confirm no document from another project can be retrieved or listed, and that `list_corpus_files` with an empty pattern shows only entitled files. If filters arrive as `None`, the whole corpus is exposed - that is a worse outcome than the bug we just fixed, and it fails silently.
3. **Restore streaming**: uncomment `streaming_callback` on the agent, redeploy, verify tool calls still work and the answer streams. If the empty message returns here, keep the agent unstreamed - the app copes via `finalizeBlock`.
4. **Restore reasoning** if wanted: `reasoning_effort` is a Responses-API parameter; on Chat Completions put it in `generation_kwargs` and check the gateway accepts it - an unknown parameter is a 400 here, not a silent ignore.
5. Unit-test the two `Code` components (formatter numbering/dedup; filter merger incl. empty base filters - the access-control warning from v0.8 applies verbatim).
6. Remaining playground checks: a named file outside the user's project must yield "no accessible document"; multi-turn follow-ups; an attachment turn; citation numbers `[n]` matching the sources panel order.
7. Only then point a test deployment's `HAYSTACK_PIPELINE` at it.
