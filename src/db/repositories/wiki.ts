import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users, wikiPageSources, wikiPages } from "@/db/schema";
import { getProjectAccess } from "@/db/repositories/projects";
import type { UserRole } from "@/lib/roles";
import {
  slugify,
  type WikiBreadcrumb,
  type WikiPageSummary,
  type WikiPageView,
  type WikiSearchHit,
  type WikiSourceInput,
  type WikiSourceView,
  type WikiStatus,
} from "@/lib/wiki";

/** null = the global knowledge base; a UUID = that project's knowledge base. */
export type KnowledgeBaseId = string | null;

export type KnowledgeBaseAccess = Readonly<{
  projectId: KnowledgeBaseId;
  projectName: string | null;
  canRead: boolean;
  canEdit: boolean;
}>;

// Must match the GIN expression index created in migration 0006.
const searchVector = sql`to_tsvector('english', ${wikiPages.title} || ' ' || coalesce(${wikiPages.summary}, '') || ' ' || ${wikiPages.content})`;

function kbCondition(projectId: KnowledgeBaseId) {
  return projectId === null ? isNull(wikiPages.projectId) : eq(wikiPages.projectId, projectId);
}

function serializeSummary(row: {
  id: string;
  projectId: string | null;
  parentId: string | null;
  slug: string;
  title: string;
  summary: string | null;
  status: WikiStatus;
  authorityRank: number | null;
  sortOrder: number;
  sourceCount: number;
  updatedAt: Date;
}): WikiPageSummary {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}

/**
 * Global pages are readable by every signed-in user and editable by application
 * admins. Project pages follow project membership: members read, project admins
 * and application admins edit. Returns null when the project is not visible.
 */
export async function resolveKnowledgeBaseAccess(
  user: Readonly<{ id: string; role: UserRole }>,
  projectId: KnowledgeBaseId,
): Promise<KnowledgeBaseAccess | null> {
  if (projectId === null) {
    return { projectId: null, projectName: null, canRead: true, canEdit: user.role === "admin" };
  }
  const access = await getProjectAccess(user.id, projectId);
  if (!access) return null;
  return {
    projectId,
    projectName: access.name,
    canRead: true,
    canEdit: user.role === "admin" || access.role === "admin",
  };
}

const summaryColumns = {
  id: wikiPages.id,
  projectId: wikiPages.projectId,
  parentId: wikiPages.parentId,
  slug: wikiPages.slug,
  title: wikiPages.title,
  summary: wikiPages.summary,
  status: wikiPages.status,
  authorityRank: wikiPages.authorityRank,
  sortOrder: wikiPages.sortOrder,
  updatedAt: wikiPages.updatedAt,
  // Raw identifiers: inside a select field Drizzle renders columns unqualified, which would
  // bind `id` to wiki_page_sources and make the count always zero.
  sourceCount: sql<number>`(select count(*)::int from wiki_page_sources s where s.page_id = wiki_pages.id)`,
};

export async function listWikiTree(projectId: KnowledgeBaseId): Promise<WikiPageSummary[]> {
  const rows = await db
    .select(summaryColumns)
    .from(wikiPages)
    .where(kbCondition(projectId))
    .orderBy(asc(wikiPages.sortOrder), asc(wikiPages.title), asc(wikiPages.id));
  return rows.map(serializeSummary);
}

async function breadcrumbFor(pageId: string): Promise<WikiBreadcrumb[]> {
  const rows = await db.execute<{ id: string; slug: string; title: string; depth: number }>(sql`
    with recursive chain as (
      select id, parent_id, slug, title, 0 as depth from wiki_pages where id = ${pageId}
      union all
      select p.id, p.parent_id, p.slug, p.title, chain.depth + 1
      from wiki_pages p join chain on p.id = chain.parent_id
      where chain.depth < 20
    )
    select id, slug, title, depth from chain order by depth desc
  `);
  return rows.rows.map((row) => ({ id: row.id, slug: row.slug, title: row.title }));
}

async function sourcesFor(pageId: string): Promise<WikiSourceView[]> {
  return db
    .select({
      id: wikiPageSources.id,
      position: wikiPageSources.position,
      haystackFileId: wikiPageSources.haystackFileId,
      documentId: wikiPageSources.documentId,
      fileName: wikiPageSources.fileName,
      locator: wikiPageSources.locator,
      quote: wikiPageSources.quote,
      pageNumber: wikiPageSources.pageNumber,
      authorityRank: wikiPageSources.authorityRank,
    })
    .from(wikiPageSources)
    .where(eq(wikiPageSources.pageId, pageId))
    .orderBy(asc(wikiPageSources.position));
}

export async function getWikiPageRow(pageId: string) {
  const [row] = await db
    .select({
      ...summaryColumns,
      content: wikiPages.content,
      createdAt: wikiPages.createdAt,
      lastReviewedAt: wikiPages.lastReviewedAt,
      sourceMessageId: wikiPages.sourceMessageId,
      createdByUserId: wikiPages.createdByUserId,
      updatedByUserId: wikiPages.updatedByUserId,
    })
    .from(wikiPages)
    .where(eq(wikiPages.id, pageId))
    .limit(1);
  return row ?? null;
}

export async function getWikiPage(
  pageId: string,
  canEdit: boolean,
): Promise<WikiPageView | null> {
  const row = await getWikiPageRow(pageId);
  if (!row) return null;
  const [sources, breadcrumb, authors] = await Promise.all([
    sourcesFor(pageId),
    breadcrumbFor(pageId),
    db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, [row.createdByUserId, row.updatedByUserId])),
  ]);
  const nameOf = (id: string) => authors.find((author) => author.id === id)?.displayName ?? "Unknown";
  return {
    ...serializeSummary(row),
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    lastReviewedAt: row.lastReviewedAt?.toISOString() ?? null,
    createdBy: nameOf(row.createdByUserId),
    updatedBy: nameOf(row.updatedByUserId),
    sourceMessageId: row.sourceMessageId,
    sources,
    breadcrumb,
    canEdit,
  };
}

export async function findWikiPageBySlug(
  projectId: KnowledgeBaseId,
  slug: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: wikiPages.id })
    .from(wikiPages)
    .where(and(kbCondition(projectId), eq(wikiPages.slug, slug)))
    .limit(1);
  return row?.id ?? null;
}

async function uniqueSlug(
  transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  projectId: KnowledgeBaseId,
  base: string,
  excludePageId?: string,
): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const [existing] = await transaction
      .select({ id: wikiPages.id })
      .from(wikiPages)
      .where(and(kbCondition(projectId), eq(wikiPages.slug, candidate)))
      .limit(1);
    if (!existing || existing.id === excludePageId) return candidate;
  }
  return `${base}-${Date.now()}`;
}

async function parentIsValid(
  transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  projectId: KnowledgeBaseId,
  parentId: string,
  pageId?: string,
): Promise<boolean> {
  // Same knowledge base, and not the page itself or one of its descendants.
  let current: string | null = parentId;
  for (let depth = 0; current && depth < 50; depth += 1) {
    if (current === pageId) return false;
    const [row] = await transaction
      .select({ parentId: wikiPages.parentId, projectId: wikiPages.projectId })
      .from(wikiPages)
      .where(eq(wikiPages.id, current))
      .limit(1);
    if (!row) return false;
    if (depth === 0 && row.projectId !== projectId) return false;
    current = row.parentId;
  }
  return true;
}

async function replaceSources(
  transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  pageId: string,
  sources: readonly WikiSourceInput[],
): Promise<void> {
  await transaction.delete(wikiPageSources).where(eq(wikiPageSources.pageId, pageId));
  if (sources.length === 0) return;
  await transaction.insert(wikiPageSources).values(
    sources.map((source, index) => ({ ...source, pageId, position: index + 1 })),
  );
}

export type CreateWikiPageInput = Readonly<{
  projectId: KnowledgeBaseId;
  parentId: string | null;
  title: string;
  summary: string | null;
  content: string;
  status: WikiStatus;
  authorityRank: number | null;
  sources: readonly WikiSourceInput[];
  sourceMessageId: string | null;
  userId: string;
}>;

export async function createWikiPage(
  input: CreateWikiPageInput,
): Promise<{ id: string } | "invalid-parent"> {
  return db.transaction(async (transaction) => {
    if (input.parentId && !(await parentIsValid(transaction, input.projectId, input.parentId))) {
      return "invalid-parent";
    }
    const slug = await uniqueSlug(transaction, input.projectId, slugify(input.title));
    const [{ next }] = await transaction
      .select({ next: sql<number>`coalesce(max(${wikiPages.sortOrder}), 0)::int + 1` })
      .from(wikiPages)
      .where(
        and(
          kbCondition(input.projectId),
          input.parentId ? eq(wikiPages.parentId, input.parentId) : isNull(wikiPages.parentId),
        ),
      );
    const [page] = await transaction
      .insert(wikiPages)
      .values({
        projectId: input.projectId,
        parentId: input.parentId,
        slug,
        title: input.title,
        summary: input.summary,
        content: input.content,
        status: input.status,
        authorityRank: input.authorityRank,
        sortOrder: next,
        createdByUserId: input.userId,
        updatedByUserId: input.userId,
        lastReviewedAt: input.status === "published" ? new Date() : null,
        sourceMessageId: input.sourceMessageId,
      })
      .returning({ id: wikiPages.id });
    await replaceSources(transaction, page.id, input.sources);
    return { id: page.id };
  });
}

export type UpdateWikiPageInput = Readonly<{
  title?: string;
  summary?: string | null;
  content?: string;
  status?: WikiStatus;
  authorityRank?: number | null;
  parentId?: string | null;
  sortOrder?: number;
  sources?: readonly WikiSourceInput[];
  userId: string;
}>;

export async function updateWikiPage(
  pageId: string,
  projectId: KnowledgeBaseId,
  patch: UpdateWikiPageInput,
): Promise<true | "not-found" | "invalid-parent"> {
  return db.transaction(async (transaction) => {
    const [existing] = await transaction
      .select({ id: wikiPages.id, title: wikiPages.title, status: wikiPages.status })
      .from(wikiPages)
      .where(and(eq(wikiPages.id, pageId), kbCondition(projectId)))
      .limit(1);
    if (!existing) return "not-found";
    if (
      patch.parentId &&
      !(await parentIsValid(transaction, projectId, patch.parentId, pageId))
    ) {
      return "invalid-parent";
    }
    const nextStatus = patch.status ?? existing.status;
    await transaction
      .update(wikiPages)
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.title !== undefined && patch.title !== existing.title
          ? { slug: await uniqueSlug(transaction, projectId, slugify(patch.title), pageId) }
          : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        ...(patch.content !== undefined ? { content: patch.content } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.authorityRank !== undefined ? { authorityRank: patch.authorityRank } : {}),
        ...(patch.parentId !== undefined ? { parentId: patch.parentId } : {}),
        ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
        ...(nextStatus === "published" && existing.status !== "published"
          ? { lastReviewedAt: new Date() }
          : {}),
        updatedByUserId: patch.userId,
        updatedAt: new Date(),
      })
      .where(eq(wikiPages.id, pageId));
    if (patch.sources !== undefined) await replaceSources(transaction, pageId, patch.sources);
    return true;
  });
}

export async function deleteWikiPage(
  pageId: string,
  projectId: KnowledgeBaseId,
): Promise<true | "not-found" | "has-children"> {
  return db.transaction(async (transaction) => {
    const [existing] = await transaction
      .select({ id: wikiPages.id })
      .from(wikiPages)
      .where(and(eq(wikiPages.id, pageId), kbCondition(projectId)))
      .limit(1);
    if (!existing) return "not-found";
    const [child] = await transaction
      .select({ id: wikiPages.id })
      .from(wikiPages)
      .where(eq(wikiPages.parentId, pageId))
      .limit(1);
    if (child) return "has-children";
    await transaction.delete(wikiPages).where(eq(wikiPages.id, pageId));
    return true;
  });
}

/**
 * Full-text search across one or more knowledge bases (null = global).
 * Draft pages are excluded unless `includeDrafts` is set (editors browsing their KB).
 */
export async function searchWikiPages(
  knowledgeBases: readonly KnowledgeBaseId[],
  query: string,
  options: Readonly<{ limit?: number; includeDrafts?: boolean }> = {},
): Promise<WikiSearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed || knowledgeBases.length === 0) return [];
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  const projectIds = knowledgeBases.filter((id): id is string => id !== null);
  const kbFilter = or(
    ...(knowledgeBases.includes(null) ? [isNull(wikiPages.projectId)] : []),
    ...(projectIds.length ? [inArray(wikiPages.projectId, projectIds)] : []),
  );
  const tsQuery = sql`websearch_to_tsquery('english', ${trimmed})`;
  const rows = await db
    .select({
      ...summaryColumns,
      rank: sql<number>`ts_rank_cd(${searchVector}, ${tsQuery})`,
      snippet: sql<string>`ts_headline('english', ${wikiPages.content}, ${tsQuery}, 'MaxWords=45, MinWords=20, MaxFragments=2, FragmentDelimiter=" … "')`,
    })
    .from(wikiPages)
    .where(
      and(
        kbFilter,
        options.includeDrafts ? undefined : eq(wikiPages.status, "published"),
        or(sql`${searchVector} @@ ${tsQuery}`, sql`${wikiPages.title} ilike ${`%${trimmed}%`}`),
      ),
    )
    .orderBy(desc(sql`ts_rank_cd(${searchVector}, ${tsQuery})`), asc(wikiPages.title))
    .limit(limit);
  return rows.map((row) => ({ ...serializeSummary(row), rank: Number(row.rank), snippet: row.snippet }));
}

/** Compact listing for the machine-readable endpoint. */
export async function listWikiTrees(
  knowledgeBases: readonly KnowledgeBaseId[],
  includeDrafts = false,
): Promise<WikiPageSummary[]> {
  if (knowledgeBases.length === 0) return [];
  const projectIds = knowledgeBases.filter((id): id is string => id !== null);
  const rows = await db
    .select(summaryColumns)
    .from(wikiPages)
    .where(
      and(
        or(
          ...(knowledgeBases.includes(null) ? [isNull(wikiPages.projectId)] : []),
          ...(projectIds.length ? [inArray(wikiPages.projectId, projectIds)] : []),
        ),
        includeDrafts ? undefined : eq(wikiPages.status, "published"),
      ),
    )
    .orderBy(asc(wikiPages.projectId), asc(wikiPages.sortOrder), asc(wikiPages.title));
  return rows.map(serializeSummary);
}
