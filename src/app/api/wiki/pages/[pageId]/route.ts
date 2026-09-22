import { NextRequest } from "next/server";
import {
  deleteWikiPage,
  getWikiPage,
  getWikiPageRow,
  updateWikiPage,
} from "@/db/repositories/wiki";
import { readJsonRecord } from "@/lib/apiParsing";
import { isUuid } from "@/lib/conversations";
import { requireAppUser, type AppUser } from "@/lib/currentUser";
import {
  isWikiStatus,
  normalizeAuthorityRankInput,
  normalizeWikiContent,
  normalizeWikiSources,
  normalizeWikiSummary,
  normalizeWikiTitle,
} from "@/lib/wiki";
import { requireKnowledgeBase } from "@/lib/wikiApi";

type Context = RouteContext<"/api/wiki/pages/[pageId]">;

async function locate(user: AppUser, pageId: string, edit: boolean) {
  if (!isUuid(pageId)) return Response.json({ error: "Page not found." }, { status: 404 });
  const row = await getWikiPageRow(pageId);
  if (!row) return Response.json({ error: "Page not found." }, { status: 404 });
  const access = await requireKnowledgeBase(user, row.projectId, { edit });
  if (access instanceof Response) {
    // Hide the existence of pages in projects the caller cannot see.
    return access.status === 404 ? Response.json({ error: "Page not found." }, { status: 404 }) : access;
  }
  if (!access.canEdit && row.status !== "published") {
    return Response.json({ error: "Page not found." }, { status: 404 });
  }
  return { row, access };
}

export async function GET(_request: NextRequest, context: Context): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;
  const { pageId } = await context.params;
  const located = await locate(user, pageId, false);
  if (located instanceof Response) return located;
  const page = await getWikiPage(pageId, located.access.canEdit);
  return Response.json({ page });
}

export async function PATCH(request: NextRequest, context: Context): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;
  const { pageId } = await context.params;
  const located = await locate(user, pageId, true);
  if (located instanceof Response) return located;
  const body = await readJsonRecord(request);
  if (body instanceof Response) return body;

  const title = body.title === undefined ? undefined : normalizeWikiTitle(body.title);
  const summary = normalizeWikiSummary(body.summary);
  const content = body.content === undefined ? undefined : normalizeWikiContent(body.content);
  const sources = body.sources === undefined ? undefined : normalizeWikiSources(body.sources);
  const authorityRank = normalizeAuthorityRankInput(body.authorityRank);
  const status = body.status;
  const parentId = body.parentId;
  const sortOrder = body.sortOrder;
  if (
    title === null ||
    summary === undefined && body.summary !== undefined ||
    content === null ||
    sources === null ||
    authorityRank === undefined && body.authorityRank !== undefined ||
    (status !== undefined && !isWikiStatus(status)) ||
    (parentId !== undefined && parentId !== null && !isUuid(parentId)) ||
    (sortOrder !== undefined && !(Number.isInteger(sortOrder) && Number(sortOrder) >= 0))
  ) {
    return Response.json({ error: "The page update is invalid." }, { status: 400 });
  }

  const result = await updateWikiPage(pageId, located.row.projectId, {
    title,
    summary,
    content,
    status,
    authorityRank,
    parentId,
    sortOrder: sortOrder as number | undefined,
    sources,
    userId: user.id,
  });
  if (result === "not-found") return Response.json({ error: "Page not found." }, { status: 404 });
  if (result === "invalid-parent") {
    return Response.json(
      { error: "A page cannot be moved under itself or into another knowledge base." },
      { status: 400 },
    );
  }
  const page = await getWikiPage(pageId, true);
  return Response.json({ page });
}

export async function DELETE(_request: NextRequest, context: Context): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;
  const { pageId } = await context.params;
  const located = await locate(user, pageId, true);
  if (located instanceof Response) return located;
  const result = await deleteWikiPage(pageId, located.row.projectId);
  if (result === "not-found") return Response.json({ error: "Page not found." }, { status: 404 });
  if (result === "has-children") {
    return Response.json(
      { error: "Move or delete the child pages first." },
      { status: 409 },
    );
  }
  return new Response(null, { status: 204 });
}
