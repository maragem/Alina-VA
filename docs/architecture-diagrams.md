# ALINA - Architecture diagrams

Source of truth for each diagram:

| Diagram | Generated from | Version |
|---|---|---|
| 1. Indexing pipeline | `docs/Haystack-pipelines/indexing-v06.yaml` | v0.6, 02/09/2026 |
| 2. Agent pipeline (top level) | `alina-pipeline-v1-draft9-reference-qa.yaml` | v1 draft 9, 07/09/2026 |
| 3. Agent tools (internals) | same | v1 draft 9 |
| 4. AWS architecture | `docs/aws-production-runbook.md` | 04/09/2026 |

---

## 1. Indexing pipeline (Haystack v0.6)

One deepset indexing pipeline. A file is routed by MIME type into one of three
preprocessing paths, then all three converge on a single finalize-embed-write tail.

```mermaid
flowchart TB
    IN[["files"]] --> FC{"file_classifier<br/>FileTypeRouter"}

    FC -->|"application/pdf"| DPDF["ECDoclingConverter_PDF<br/>OCR on, table structure on"]
    FC -->|"docx"| DDOCX["ECDoclingConverter_DOCX"]
    FC -->|"msword"| KDOC["KreuzbergConverter_DOC"]
    FC -->|"odt"| KODT["KreuzbergConverter_ODT"]
    FC -->|"text/markdown"| MD["markdown_converter<br/>TextFileToDocument"]
    FC -->|"text/html"| HTML["html_converter<br/>HTMLToDocument"]
    FC -->|"text/plain"| TXT["text_converter<br/>TextFileToDocument"]
    FC -->|"pptx"| PPTX["pptx_converter<br/>PPTXToDocument"]
    FC -->|"xlsx"| XLSX["xlsx_converter<br/>XLSXToDocument"]
    FC -->|"text/csv"| CSV["csv_converter<br/>CSVToDocument"]

    subgraph P1["Path A - markdown-structured"]
        SP["structure_promoter<br/>Code<br/>page breaks to U+240C sentinel<br/>promote structure to MD headings"]
        DC["document_cleaner<br/>DocumentCleaner<br/>strip repeated headers and footers"]
        MHS["MarkdownHeaderSplitter<br/>header levels 1-4, keep_headers<br/>secondary split: 250 words, overlap 50"]
        SP --> DC --> MHS
    end

    subgraph P2["Path B - plain text"]
        SPL["splitter<br/>DocumentSplitter<br/>by word, 250 / 50, sentence boundary"]
    end

    subgraph P3["Path C - tabular"]
        TSPL["table_splitter<br/>DocumentSplitter<br/>by line, 40 / 4"]
    end

    DPDF --> SP
    DDOCX --> SP
    KDOC --> SP
    KODT --> SP
    MD --> SP
    HTML --> SP

    TXT --> SPL
    PPTX --> SPL

    XLSX --> TSPL
    CSV --> TSPL

    MHS --> SJ["split_joiner<br/>DocumentJoiner, concatenate"]
    SPL --> SJ
    TSPL --> SJ

    SJ --> MF["metadata_finalizer<br/>Code<br/>builds header from file_name<br/>and section title, plus chunk<br/>identity metadata"]
    MF --> EMB["document_embedder<br/>DeepsetNvidiaDocumentEmbedder<br/>intfloat/e5-base-v2, 768d, prefix 'passage: '<br/>meta_fields_to_embed: header"]
    EMB --> W["writer<br/>DocumentWriter, policy OVERWRITE"]
    W --> OS[("OpenSearch<br/>index ALINA-V0.4")]
```

**Notes**

- `structure_promoter` must run before `document_cleaner`: it swaps `\f` for a
  printable sentinel the cleaner cannot collapse, and promotes PART / TITLE /
  CHAPTER / SECTION / Article to markdown headings so `MarkdownHeaderSplitter`
  has something to cut on. Four profiles, because legal acts are only 4% of the corpus.
- `metadata_finalizer` is the single place where a chunk's queryable identity is
  decided. `header` is used on the query side both as the human label and inside
  `meta_fields_to_embed`.
- **Open point:** this pipeline writes to `ALINA-V0.4`; the v1 agent pipeline
  still reads `ALINA-V0.3`. The two must be bumped in the same deployment.

---

## 2. Agent pipeline (Haystack v1)

The pipeline contract is identical to v0.x - same sockets in, same sockets out -
so the application does not change. Everything between them is rebuilt around one
`haystack.components.agents.agent.Agent`.

```mermaid
flowchart LR
    subgraph IN["pipeline inputs - unchanged from v0.x"]
        direction TB
        QIN["query"]
        MIN["messages"]
        FILES["files"]
        FIN["filters<br/>entitlement, server-side only"]
    end

    MIN --> HS["history_sanitizer<br/>Code<br/>rebuild plain user/assistant turns<br/>drop content-less messages"]
    FILES --> AC["attachment_converter<br/>MultiFileConverter"]
    AC --> AMS["attachment_metadata_stamper<br/>Code"]
    AMS --> AF["attachment_formatter<br/>Code"]

    subgraph AGENT["agent - haystack.components.agents.agent.Agent"]
        direction TB
        AG["Agent loop<br/>exit_conditions: text<br/>max_agent_steps: 10<br/>raise_on_tool_invocation_failure: false"]
        GEN["chat_generator<br/>OpenAIChatGenerator, gpt-5.1<br/>api.tech.ec.europa.eu/ecgpt/v1<br/>/chat/completions"]
        ST["state<br/>documents: list[Document]<br/>filters: dict"]
        AG <--> GEN
        AG <--> ST
    end

    QIN --> AG
    HS --> AG
    AF -->|"attachments block"| AG
    AF -->|"documents - seeds refs 1..k"| ST
    FIN --> ST

    subgraph TOOLS["tools - 4 x PipelineTool"]
        direction TB
        T1["consult_reference_qa"]
        T2["list_corpus_files"]
        T3["search_corpus"]
        T4["search_in_file"]
    end

    AG <==>|"tool calls<br/>filters injected server-side"| TOOLS
    TOOLS -.->|"search_corpus and search_in_file<br/>append their documents"| ST

    subgraph OUT["pipeline outputs - unchanged from v0.x"]
        direction TB
        OUTD["documents<br/>citation order"]
        OUTM["messages"]
    end

    ST --> OUTD
    AG --> OUTM
```

**Notes**

- `filters` carries the entitlement filter. It enters the agent as a **state
  field** and is injected into every tool server-side: the LLM never sees it and
  cannot set it. This is the only mechanism isolating a user's documents.
- `history_sanitizer` exists because deepset replays chat history itself. An
  `Agent` hands that list straight to the generator, which rejects any
  content-less `ChatMessage` on outgoing serialization.
- The generator is `OpenAIChatGenerator` (`/chat/completions`) and not
  `OpenAIResponsesChatGenerator` (`/responses`): the ECGPT gateway does function
  calling on the former only, established by isolation test on 31/08/2026.
- Nominal path is `consult_reference_qa` then `search_in_file` then
  `search_corpus` then answer, which is why `max_agent_steps` is 10.

---

## 3. Agent tools - internals

All four tools are `haystack.tools.pipeline_tool.PipelineTool`. Each wraps a
nested Haystack pipeline; `outputs_to_string` selects what the LLM actually reads.

### 3.1 consult_reference_qa

```mermaid
flowchart LR
    Q(["query<br/>from LLM"]) --> QA["qa_lookup<br/>Code<br/>34 curated exemplar Q&A<br/>held in the component code"]
    QA --> R(["result -> LLM"])
```

Called first for any substantive procurement question. Returns the closest
curated entries and the instruments they rely on, which tells the agent which
document to search. The entries are **guidance, never a citable source**.

### 3.2 list_corpus_files

```mermaid
flowchart LR
    NP(["name_pattern<br/>from LLM"]) --> LS
    AR(["authority_rank<br/>from LLM, optional"]) --> LS
    F(["filters<br/>from agent state"]) --> CS["corpus_scan<br/>FilterRetriever<br/>OpenSearch ALINA-V0.3"]
    CS --> LS["lister<br/>Code<br/>one line per file, sorted by authority"]
    LS --> R(["result -> LLM<br/>file_name, file_id,<br/>authority_rank, chunk count"])
```

Resolves a document name, alias or abbreviation to an exact `file_id` before
`search_in_file`. Authority ranks: 1 legal acts, 2 internal rules and circulars,
3 guidance and vademecum, 4 tender and contract documents, 5 Q&A logs.

### 3.3 search_corpus - the v0.x retrieval chain, wrapped as a tool

```mermaid
flowchart TB
    Q(["query<br/>from LLM"]) --> RQ["retrieval_query<br/>OutputAdapter"]
    F(["filters<br/>from agent state"]) --> BM25
    F --> ER

    RQ --> BM25["bm25_retriever<br/>OpenSearchBM25Retriever<br/>top_k 30"]
    RQ --> QE["query_embedder<br/>DeepsetNvidiaTextEmbedder<br/>intfloat/e5-base-v2"]
    QE --> ER["embedding_retriever<br/>OpenSearchEmbeddingRetriever<br/>top_k 30"]

    BM25 --> DJ["document_joiner<br/>reciprocal_rank_fusion"]
    ER --> DJ
    DJ --> RK["ranker<br/>DeepsetNvidiaRanker<br/>Qwen3-Reranker-0.6B, top_k 10"]
    RK --> SW["sentence_window_retriever<br/>window_size 1"]
    SW --> WJ["window_joiner<br/>concatenate"]
    WJ --> RS["ranker_scoring<br/>DeepsetNvidiaRanker<br/>top_k 30, scale_score true"]
    RS --> MG["meta_field_grouping_ranker<br/>regroup chunks per document"]
    MG --> RF["result_formatter<br/>Code<br/>tags passages with global<br/>reference numbers"]
    RF --> R(["result -> LLM"])
    MG --> STDOC(["documents -> agent state"])
```

### 3.4 search_in_file - same chain, constrained to named files

```mermaid
flowchart TB
    FI(["file_ids<br/>from LLM<br/>via list_corpus_files"]) --> FM["file_filter_merger<br/>Code<br/>AND of entitlement filter<br/>and file_id filter"]
    F(["filters<br/>from agent state"]) --> FM
    Q(["query<br/>from LLM"]) --> RQ["retrieval_query<br/>OutputAdapter"]

    FM -->|"filters"| BM25["bm25_retriever<br/>top_k 30"]
    FM -->|"filters"| ER["embedding_retriever<br/>top_k 30"]
    RQ --> BM25
    RQ --> QE["query_embedder"]
    QE --> ER

    BM25 --> DJ["document_joiner<br/>reciprocal_rank_fusion"]
    ER --> DJ
    DJ --> RK["ranker<br/>top_k 10"]
    RK --> SW["sentence_window_retriever<br/>window_size 1"]
    SW --> WJ["window_joiner"]
    WJ --> RS["ranker_scoring<br/>top_k 30"]
    RS --> MG["meta_field_grouping_ranker"]
    MG --> RF["result_formatter"]
    RF --> R(["result -> LLM"])
    MG --> STDOC(["documents -> agent state"])
```

**Why the two chains are duplicated rather than shared:** a `PipelineTool` owns
its nested pipeline. The only difference is `file_filter_merger`, which merges
the LLM-supplied `file_ids` into the state-supplied entitlement filter with `AND`
before either retriever sees it. The entitlement half is never under LLM control.

---

## 4. AWS architecture (production)

```mermaid
flowchart TB
    U["End users<br/>browser"]

    subgraph AWS["AWS account - one Region"]
        direction TB

        subgraph VPC["Existing VPC - referenced by ID, never created"]
            direction TB
            subgraph PUB["Public subnets - 2 AZ"]
                ALB["Application Load Balancer<br/>internet-facing, HTTPS 443, ACM cert<br/>idle timeout 300s, no stickiness<br/>SG alina-alb"]
            end
            subgraph PRIV["Private subnets - 2 AZ, NAT egress, no public IP"]
                direction TB
                TG["Target group<br/>IP mode, port 3000<br/>health check /api/health/ready"]
                subgraph ECS["ECS cluster alina-prod - Fargate"]
                    direction LR
                    T1["Task 1 - alina<br/>1 vCPU / 2 GB<br/>Next.js :3000<br/>SG alina-ecs"]
                    T2["Task 2 - alina<br/>other AZ"]
                    MIG["One-off task<br/>node scripts/migrate.mjs<br/>advisory-locked"]
                end
                RDS[("RDS PostgreSQL 17<br/>Multi-AZ, private, encrypted<br/>PITR, deletion protection<br/>SG alina-rds :5432")]
            end
            NAT["NAT gateway"]
        end

        subgraph SVC["Account-level services"]
            direction LR
            ECR["ECR<br/>private repo alina<br/>immutable tags, scan on push<br/>image tagged with Git SHA"]
            SM["Secrets Manager<br/>alina/prod/application"]
            IAM["IAM roles<br/>alina-ecs-execution<br/>alina-ecs-task"]
            CW["CloudWatch<br/>/ecs/alina-prod, migration<br/>ALB, ECS, RDS signals"]
            COG["Cognito<br/>user pool + Managed Login"]
        end
    end

    subgraph EXT["Outside AWS"]
        direction LR
        HAY["deepset / Haystack Cloud<br/>search stream, files, feedback"]
        ECGPT["ECGPT gateway<br/>gpt-5.1 + embeddings"]
    end

    U -->|"HTTPS 443"| ALB
    U -.->|"OIDC login redirect"| COG
    ALB --> TG
    TG --> T1
    TG --> T2
    T1 -->|"5432"| RDS
    T2 -->|"5432"| RDS
    MIG -->|"5432"| RDS
    SVC -.->|"image pull, secrets at startup,<br/>task roles, log streams"| ECS
    T1 -->|"443"| NAT
    T2 -->|"443"| NAT
    NAT --> EXT
    NAT --> COG
```

**Constraints and invariants**

- The landing zone does **not** allow creating VPCs or subnets. Network
  resources are referenced by ID. Security groups `alina-alb` / `alina-ecs` /
  `alina-rds` are requested from the platform team where they do not already
  exist.
- ECS tasks run in private subnets with no public IP. Outbound HTTPS through the
  NAT gateway is required: the application calls Cognito, Haystack and ECGPT.
- RDS is never publicly accessible. Only `alina-ecs` may reach port 5432. TLS is
  validated against the RDS CA bundle embedded in the image.
- Connection budget: `DB_POOL_MAX x ECS_MAX_TASKS < RDS_MAX_CONNECTIONS - 20`.
- Release sequence: push a new SHA image, register a task-definition revision,
  run that revision once as a migration task, wait for exit code 0, then update
  the service. Schema changes follow expand / migrate / contract so old and new
  tasks can run concurrently during the rolling deployment.
- No RDS Proxy, no Terraform, no CDK: the runbook is deliberately console-driven.
