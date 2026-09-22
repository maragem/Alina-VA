import "server-only";

import {
  resolveKnowledgeBaseAccess,
  type KnowledgeBaseAccess,
  type KnowledgeBaseId,
} from "@/db/repositories/wiki";
import { isUuid } from "@/lib/conversations";
import type { AppUser } from "@/lib/currentUser";
import type { WikiPageView, WikiSourceView } from "@/lib/wiki";

/** `projectId` query/body value → knowledge base id; `undefined` means malformed. */
export function parseKnowledgeBaseId(value: unknown): KnowledgeBaseId | undefined {
  if (value === undefined || value === null || value === "" || value === "global") return null;
  return isUuid(value) ? value : undefined;
}

export async function requireKnowledgeBase(
  user: AppUser,
  projectId: KnowledgeBaseId | undefined,
  options: Readonly<{ edit?: boolean }> = {},
): Promise<KnowledgeBaseAccess | Response> {
  if (projectId === undefined) {
    return Response.json({ error: "projectId is invalid." }, { status: 400 });
  }
  const access = await resolveKnowledgeBaseAccess(user, projectId);
  if (!access) return Response.json({ error: "Knowledge base not found." }, { status: 404 });
  if (options.edit && !access.canEdit) {
    return Response.json(
      { error: "You are not allowed to edit this knowledge base." },
      { status: 403 },
    );
  }
  return access;
}

function sourceLine(source: WikiSourceView): string {
  const parts = [`[${source.position}] ${source.fileName}`];
  if (source.locator) parts.push(source.locator);
  if (source.pageNumber) parts.push(`p. ${source.pageNumber}`);
  if (source.authorityRank) parts.push(`authority ${source.authorityRank}`);
  if (source.haystackFileId) parts.push(`file_id ${source.haystackFileId}`);
  const head = parts.join(" — ");
  return source.quote ? `${head}\n    "${source.quote.replace(/\s+/g, " ").trim()}"` : head;
}

/**
 * Plain-text rendering handed to the agent through MCP. Sources are appended so
 * the model can cite the underlying instrument rather than the wiki page.
 */
export function renderWikiPageForAgent(page: WikiPageView, knowledgeBaseLabel: string): string {
  const header = [
    `# ${page.title}`,
    `knowledge_base: ${knowledgeBaseLabel}`,
    `page_id: ${page.id}`,
    `slug: ${page.slug}`,
    `status: ${page.status}`,
    page.authorityRank ? `governing_authority_rank: ${page.authorityRank}` : null,
    page.breadcrumb.length > 1
      ? `path: ${page.breadcrumb.map((crumb) => crumb.title).join(" > ")}`
      : null,
    `last_updated: ${page.updatedAt}`,
    page.summary ? `\n${page.summary}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
  const sources = page.sources.length
    ? `\n\n## Sources\n${page.sources.map(sourceLine).join("\n")}`
    : "\n\n## Sources\n(none recorded)";
  return `${header}\n\n${page.content.trim()}${sources}`;
}
