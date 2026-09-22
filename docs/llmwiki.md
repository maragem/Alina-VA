# LLM wiki: a knowledge base built to be read by machines

Status: prototype, shipped inside ALINA (September 2026). It implements the
direction proposed in the closure report (D2 digest, slide 15): instead of
chopping documents into chunks and letting the model reconcile fragments at
question time, consolidate the corpus upfront into a curated, source-tracked
tree of pages that the agent reads first.

## What it is

| Concept in the report | In this prototype |
| --- | --- |
| Managed tree | `wiki_pages`: parent/child pages with an ordered position, one tree per knowledge base |
| Knowledge base per project | `project_id` on the page: `null` is the global knowledge base, otherwise the project's; access follows project membership |
| Full source tracking | `wiki_page_sources`: numbered sources per page with corpus file id, file name, locator (article, section), page number, authority rank and verbatim quote; `[n]` in the page content points at source n |
| Quality governed | `status` per page: `draft`, `needs_review`, `published`. Only published pages are visible to readers and to the agent. `last_reviewed_at` is set on publication |
| Legal standing | `authority_rank` on the page (governing source) and on each source, using the existing 1 to 4 scale |
| Read by ALINA through MCP | `POST /api/mcp`: a Model Context Protocol server with `wiki_search`, `wiki_get_page`, `wiki_list_tree` |

## Where content comes from

1. **Curators write pages** in the Wiki tab (application admins for the global
   knowledge base, project admins for a project's). The editor has a source
   picker that searches the corpus by file name so every source links to a
   real Haystack file, which enables preview and highlight of the quote.
2. **Grounded answers are promoted.** Every completed ALINA answer has a
   "Save to wiki" action. It creates a *draft* page with the answer text and
   the cited passages attached as sources, renumbered sequentially, and records
   the originating message for provenance. A curator reviews, edits and
   publishes it. This is how the assistant's own work feeds the knowledge
   base under human control.
3. **Demo content** for evaluation: `pnpm wiki:seed-demo` inserts eight
   illustrative pages (procedures, DPS, framework contracts,
   interinstitutional procurement, ENISA) plus one completed conversation so
   the "Save to wiki" flow can be tried without a Haystack connection. The
   pages paraphrase golden-standards material and are review fixtures, not
   validated legal content.

## How the agent uses it

Set `WIKI_MCP_TOKEN` on the service. The pipeline (or any MCP client) then
calls the endpoint with `Authorization: Bearer <token>`:

```bash
curl -s https://<alina>/api/mcp \
  -H "Authorization: Bearer $WIKI_MCP_TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"wiki_search","arguments":{"query":"dynamic purchasing system definition"}}}'
```

Tools:

- `wiki_search(query, project_id?, limit?)`: full-text search over published
  pages of the global knowledge base plus the optional project's. Returns page
  ids, titles, governing authority rank, source count and a snippet. An empty
  result tells the agent the topic is not consolidated and to fall back to
  corpus search.
- `wiki_get_page(page_id | slug, project_id?)`: the page as plain text with a
  metadata header and its numbered sources, so the model cites the underlying
  instrument, not the page.
- `wiki_list_tree(project_id?)`: the tree with ids, slugs, status and
  authority rank.

The intended wiring in the Haystack agent is a fifth tool placed **before**
`search_corpus` in the procedure: consult the wiki; if a page answers, read it
and cite its sources; otherwise proceed as today. Because the wiki is written
by humans from the corpus, the entitlement question is answered by the
knowledge-base scope: the pipeline passes the same project id it already
receives in the request filters as `project_id`, and never sees pages of other
projects. Signed-in users can also call the endpoint with their session; they
see the global knowledge base and their own projects.

## Why this addresses the residual gap

The closure report found that four of the six remaining failures share one
mechanism: the system does not know the legal standing of the documents it
reads and cites guidance in place of the primary instrument. A consolidated
page states which instrument governs, carries the authority rank of each
source, and orders sources by authority. When the agent reads the page on
"interinstitutional procurement", it learns that the Vademecum rule at section
2.4 governs the EPSO case before it opens a single tender specification.

## Limits of the prototype

- Consolidation is human-driven (curators and promoted answers). The report's
  vision of an LLM that "reads, understands and consolidates" the corpus
  automatically would be a batch job that drafts pages for review; the data
  model and the review workflow are ready for it, the job does not exist yet.
- Search is PostgreSQL full-text search, adequate for hundreds of pages. A
  dense index would be the next step if the wiki grows large.
- No page history or diff yet; `updated_by` and `updated_at` are recorded.
- The MCP server is stateless Streamable HTTP with JSON responses only; it
  does not open server-initiated streams.
- The Haystack pipeline YAML has not been changed; the MCP tool is ready to
  be wired in as a `PipelineTool` or `CodeTool` calling the endpoint.
