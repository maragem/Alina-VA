import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { listUserProjects, getProjectAccess } from "@/db/repositories/projects";
import {
  findWikiPageBySlug,
  getWikiPage,
  getWikiPageRow,
  listWikiTrees,
  searchWikiPages,
  type KnowledgeBaseId,
} from "@/db/repositories/wiki";
import { getRecord, getText } from "@/lib/apiParsing";
import { isUuid } from "@/lib/conversations";
import { getCurrentUser } from "@/lib/currentUser";
import type { WikiPageSummary } from "@/lib/wiki";
import { renderWikiPageForAgent } from "@/lib/wikiApi";

/**
 * Model Context Protocol server (Streamable HTTP, stateless JSON responses) that
 * exposes the LLM wiki to agents. This is how the Haystack pipeline reads the
 * consolidated knowledge base before falling back to raw chunk retrieval.
 *
 * Authentication:
 *   - `Authorization: Bearer <WIKI_MCP_TOKEN>` for server-to-server callers (the
 *     pipeline). Scope: the global knowledge base plus the optional `project_id`
 *     argument, which the pipeline takes from the request's entitlement filters.
 *   - a signed-in ALINA session, scoped to the user's own projects (used by the
 *     in-app "how ALINA reads this" preview).
 */

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "alina-llmwiki", version: "0.1.0" };

type JsonRpcId = string | number | null;
type JsonRpcRequest = Readonly<{
  jsonrpc?: unknown;
  id?: JsonRpcId;
  method?: unknown;
  params?: unknown;
}>;

type Principal =
  | Readonly<{ kind: "service" }>
  | Readonly<{ kind: "user"; id: string; role: "admin" | "member" }>;

const TOOLS = [
  {
    name: "wiki_search",
    description:
      "Search the curated ALINA knowledge base (LLM wiki): consolidated, source-tracked pages " +
      "written from the procurement corpus. Call this BEFORE searching raw document chunks; a " +
      "matching page already resolves duplicates and tells you which instrument governs. Returns " +
      "page ids, titles, governing authority rank and a snippet.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", description: "Keywords or a short question." },
        project_id: {
          type: "string",
          description: "Optional project UUID; adds that project's knowledge base to the global one.",
        },
        limit: { type: "integer", minimum: 1, maximum: 20, description: "Default 8." },
      },
      required: ["query"],
    },
  },
  {
    name: "wiki_get_page",
    description:
      "Read one knowledge-base page in full, with its numbered sources (file name, locator, page, " +
      "authority rank, verbatim quote). Cite the underlying sources, not the page. Identify the page " +
      "by page_id, or by slug plus optional project_id.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        page_id: { type: "string" },
        slug: { type: "string" },
        project_id: { type: "string" },
      },
    },
  },
  {
    name: "wiki_list_tree",
    description:
      "List the knowledge-base tree (titles, slugs, ids, status, authority rank) for the global " +
      "knowledge base and, optionally, one project. Use it to discover what has been consolidated.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { project_id: { type: "string" } },
    },
  },
] as const;

function jsonRpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function toolText(text: string, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

function serviceTokenMatches(header: string | null): boolean {
  const expected = process.env.WIKI_MCP_TOKEN?.trim();
  if (!expected) return false;
  const provided = header?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function authenticate(request: NextRequest): Promise<Principal | null> {
  if (serviceTokenMatches(request.headers.get("authorization"))) return { kind: "service" };
  const user = await getCurrentUser();
  if (user && !user.mustChangePassword) return { kind: "user", id: user.id, role: user.role };
  return null;
}

/** Knowledge bases the principal may read for a given optional project argument. */
async function knowledgeBasesFor(
  principal: Principal,
  projectIdArgument: unknown,
): Promise<KnowledgeBaseId[] | "invalid-project"> {
  const projectId = getText(projectIdArgument);
  if (projectId && !isUuid(projectId)) return "invalid-project";
  if (principal.kind === "service") return projectId ? [null, projectId] : [null];
  if (projectId) {
    const access = await getProjectAccess(principal.id, projectId);
    return access ? [null, projectId] : "invalid-project";
  }
  const projects = await listUserProjects(principal.id);
  return [null, ...projects.map((project) => project.id)];
}

function knowledgeBaseLabel(projectId: string | null): string {
  return projectId ? `project ${projectId}` : "global";
}

function formatTree(pages: readonly WikiPageSummary[]): string {
  if (pages.length === 0) return "The knowledge base is empty.";
  const byParent = new Map<string | null, WikiPageSummary[]>();
  for (const page of pages) {
    const siblings = byParent.get(page.parentId) ?? [];
    siblings.push(page);
    byParent.set(page.parentId, siblings);
  }
  const lines: string[] = [];
  function walk(parentId: string | null, depth: number, projectId: string | null): void {
    for (const page of byParent.get(parentId) ?? []) {
      if (page.projectId !== projectId) continue;
      const rank = page.authorityRank ? ` · authority ${page.authorityRank}` : "";
      lines.push(
        `${"  ".repeat(depth)}- ${page.title} (slug: ${page.slug}, id: ${page.id}, ${page.status}${rank}, ${page.sourceCount} sources)`,
      );
      walk(page.id, depth + 1, projectId);
    }
  }
  const knowledgeBases = [...new Set(pages.map((page) => page.projectId))];
  for (const projectId of knowledgeBases) {
    lines.push(`## ${knowledgeBaseLabel(projectId)} knowledge base`);
    // Pages whose parent is outside the visible set are treated as roots.
    const visible = new Set(pages.map((page) => page.id));
    for (const page of pages) {
      if (page.projectId === projectId && page.parentId && !visible.has(page.parentId)) {
        (byParent.get(null) ?? byParent.set(null, []).get(null))!.push(page);
      }
    }
    walk(null, 0, projectId);
  }
  return lines.join("\n");
}

async function callTool(principal: Principal, name: string, args: Record<string, unknown>) {
  if (name === "wiki_search") {
    const query = getText(args.query);
    if (!query) return toolText("query is required.", true);
    const knowledgeBases = await knowledgeBasesFor(principal, args.project_id);
    if (knowledgeBases === "invalid-project") return toolText("project_id is not accessible.", true);
    const limit = typeof args.limit === "number" ? args.limit : 8;
    const hits = await searchWikiPages(knowledgeBases, query, { limit });
    if (hits.length === 0) {
      return toolText(
        `No knowledge-base page matches "${query}". The topic has not been consolidated yet; fall back to corpus search.`,
      );
    }
    const text = hits
      .map((hit, index) => {
        const rank = hit.authorityRank ? ` · governing authority rank ${hit.authorityRank}` : "";
        return (
          `${index + 1}. ${hit.title} (page_id: ${hit.id}, slug: ${hit.slug}, ${knowledgeBaseLabel(hit.projectId)}${rank}, ${hit.sourceCount} sources)\n` +
          (hit.summary ? `   ${hit.summary}\n` : "") +
          `   … ${hit.snippet.replace(/<\/?b>/g, "").replace(/\s+/g, " ")} …`
        );
      })
      .join("\n");
    return toolText(`${hits.length} page(s) found. Read one with wiki_get_page.\n\n${text}`);
  }

  if (name === "wiki_get_page") {
    const knowledgeBases = await knowledgeBasesFor(principal, args.project_id);
    if (knowledgeBases === "invalid-project") return toolText("project_id is not accessible.", true);
    let pageId = getText(args.page_id);
    const slug = getText(args.slug);
    if (!pageId && slug) {
      for (const knowledgeBase of knowledgeBases) {
        const found = await findWikiPageBySlug(knowledgeBase, slug);
        if (found) {
          pageId = found;
          break;
        }
      }
    }
    if (!pageId || !isUuid(pageId)) return toolText("Provide a valid page_id or a slug.", true);
    const row = await getWikiPageRow(pageId);
    if (!row || !knowledgeBases.includes(row.projectId) || row.status !== "published") {
      return toolText("Page not found or not published.", true);
    }
    const page = await getWikiPage(pageId, false);
    return toolText(page ? renderWikiPageForAgent(page, knowledgeBaseLabel(row.projectId)) : "Page not found.", !page);
  }

  if (name === "wiki_list_tree") {
    const knowledgeBases = await knowledgeBasesFor(principal, args.project_id);
    if (knowledgeBases === "invalid-project") return toolText("project_id is not accessible.", true);
    return toolText(formatTree(await listWikiTrees(knowledgeBases)));
  }

  return toolText(`Unknown tool: ${name}`, true);
}

async function handleRequest(principal: Principal, message: JsonRpcRequest) {
  const id = message.id ?? null;
  const method = getText(message.method);
  const params = getRecord(message.params);

  if (message.jsonrpc !== "2.0" || !method) {
    return jsonRpcError(id, -32600, "Invalid JSON-RPC request.");
  }
  switch (method) {
    case "initialize":
      return jsonRpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "ALINA's curated knowledge base. Search it first; when a page answers, read it with " +
          "wiki_get_page and cite the sources it lists.",
      });
    case "ping":
      return jsonRpcResult(id, {});
    case "tools/list":
      return jsonRpcResult(id, { tools: TOOLS });
    case "tools/call": {
      const name = getText(params.name);
      try {
        return jsonRpcResult(id, await callTool(principal, name, getRecord(params.arguments)));
      } catch (error) {
        console.error("MCP tool failure:", error);
        return jsonRpcResult(id, toolText("The tool failed unexpectedly.", true));
      }
    }
    default:
      if (method.startsWith("notifications/")) return null;
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!process.env.WIKI_MCP_TOKEN?.trim()) {
    return Response.json(
      { error: "The MCP endpoint is not configured. Set WIKI_MCP_TOKEN." },
      { status: 503 },
    );
  }
  const principal = await authenticate(request);
  if (!principal) return Response.json({ error: "Unauthorized." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(jsonRpcError(null, -32700, "Parse error."), { status: 400 });
  }
  const messages = Array.isArray(body) ? body : [body];
  const responses = (
    await Promise.all(messages.map((message) => handleRequest(principal, getRecord(message))))
  ).filter((response) => response !== null);

  // Notifications only: acknowledge without a body, as the transport spec requires.
  if (responses.length === 0) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(body) ? responses : responses[0], {
    headers: { "Cache-Control": "no-store" },
  });
}

/** No server-initiated stream is offered; clients must POST. */
export function GET(): Response {
  return Response.json(
    {
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
      protocolVersion: PROTOCOL_VERSION,
      transport: "streamable-http (POST only)",
      tools: TOOLS.map((tool) => tool.name),
    },
    { status: 405, headers: { Allow: "POST" } },
  );
}
