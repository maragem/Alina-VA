# Diagram C — Agentic Query Flow (sequence)

> Source: `pipeline_querying_v11.yaml` (v1 agent, DRAFT 9b) + `search-stream/route.ts`. Tool names, parameters, retriever/reranker settings taken verbatim from the YAML.

```mermaid
sequenceDiagram
    autonumber
    actor U as User (browser)
    participant FE as Next.js search-stream API
    participant HP as Haystack pipeline (deepset Cloud)
    participant AG as Agent (gpt-5.1 via GPT-EC, max 10 steps)
    participant TL as Tools
    participant OS as OpenSearch (ALINA-V0.3)

    U->>FE: question + conversationId + authorityRank
    Note over FE: requireAppUser + entitlement filter
    Note over FE: alina_project_ids in global or projectId, optional authority_rank
    FE->>HP: chat-stream query + session_id + history_limit=20 + filters + files
    Note over HP: attachments seed agent.documents (authority_rank=0)
    Note over HP: history_sanitizer rebuilds last 20 turns. filters injected into agent STATE

    loop Tool-selection loop (max 10 steps, exits on text output)
        AG->>AG: decide next tool per system-prompt procedure

        opt Substantive question (always first)
            AG->>TL: consult_reference_qa(query)
            Note over TL: in-memory TF-IDF over 34 exemplar Q&A, TOP_K=3, min score 0.35x best
            TL-->>AG: matching exemplar entries (which instruments/provisions to use)
        end

        opt User named a document
            AG->>TL: list_corpus_files(name_pattern, authority_rank)
            TL->>OS: FilterRetriever (entitlement filter)
            OS-->>TL: files
            TL-->>AG: file_name + file_id + authority_rank + chunk count (sorted by authority)
        end

        alt Named doc OR general question
            AG->>TL: search_in_file(query, file_ids)
            Note over TL: file_filter_merger ANDs file_ids WITH entitlement filter
        else Any other question
            AG->>TL: search_corpus(query)
        end

        TL->>OS: BM25 (top_k=30, fuzziness=0)
        TL->>OS: e5-base-v2 embed -> dense retriever (top_k=30)
        OS-->>TL: candidates
        Note over TL: RRF join -> Qwen3-Reranker-0.6B (top_k=10) -> SentenceWindow expand
        Note over TL: -> Qwen3-Reranker rescore (top_k=30) -> group by authority_rank
        Note over TL: -> result_formatter: global (n) numbering, dedup, 12k chars/doc, max 30/call
        TL-->>AG: grounded passages with global reference numbers
        Note over AG: new docs appended to agent.documents state (citation order)
    end

    AG-->>HP: grounded answer + accumulated documents
    HP-->>FE: SSE result event + tool calls + documents
    Note over FE: answer arrives as one block. finalizeBlock/parseHaystackResultEvent. 90s watchdog
    FE->>FE: persist assistant message + message_sources (citations)
    FE-->>U: answer + clickable citations (n)
```

## Caption

A user question enters through `/api/haystack/search-stream`, which authenticates the caller, constructs the per-user/per-project entitlement filter, and forwards the query (with `search_session_id`, a 20-message history limit, and any attachment file IDs) to the Haystack agent pipeline as an SSE stream. The Haystack Agent (an `OpenAIChatGenerator` targeting `gpt-5.1` on the GPT@EC gateway, bounded to `max_agent_steps: 10`) runs a tool-selection loop following its system-prompt procedure: `consult_reference_qa` first for guidance, `list_corpus_files` to resolve any named document, then `search_in_file` or `search_corpus`, each of which executes the same hybrid pipeline — BM25 (top_k 30) plus e5-base-v2 dense retrieval (top_k 30) fused by reciprocal rank fusion, reranked by a Qwen3-Reranker-0.6B model (top_k 10), sentence-window expanded, rescored, grouped by authority rank, and formatted with global citation numbers. The request's entitlement `filters` are injected server-side into the agent's state and ANDed into every tool's retrieval, so the LLM can never widen its own access; `search_in_file`'s `file_filter_merger` ANDs any model-chosen `file_ids` with those filters. When the agent emits text (its exit condition), the accumulated grounded passages and answer stream back; the front end persists the assistant message and its `message_sources` and renders clickable `[n]` citations.

## Could not confirm from the sources

- **Token-by-token streaming** — `streaming_callback` is commented out in the agent config (DRAFT 7); the YAML says answers currently arrive as a single result block and the app's `finalizeBlock` path copes. Whether streaming has since been re-enabled in the deployed pipeline is not evidenced.
- **`reasoning_effort`** — disabled in the YAML (`generation_kwargs: {}`) as a diagnostic; the comments say to restore `medium` once green, but the deployed value is unknown.
- **Exact entitlement filter field at the boundary** — the app sends `meta.alina_project_ids`; the pipeline's `file_filter_merger` uses intrinsic `file_id`; the YAML itself flags this field-spelling as needing verification against the route. The `filters` payload's precise shape as consumed by the retrievers is therefore TBC.
- **GPT@EC latency / tool-calling reliability** — the YAML documents an extended history of empty-message / tool-call failures through the ECGPT gateway; whether the deployed pipeline is fully stable is not asserted here.
- **Index version served** — query pipeline reads `ALINA-V0.3` while indexing writes `ALINA-V0.4`; the live index behind the agent is TBC.
