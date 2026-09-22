import { NextRequest } from "next/server";
import { createWikiPage, getWikiPage, listWikiTree } from "@/db/repositories/wiki";
import { readJsonRecord } from "@/lib/apiParsing";
import { isUuid } from "@/lib/conversations";
import { requireAppUser } from "@/lib/currentUser";
import {
  isWikiStatus,
  normalizeAuthorityRankInput,
  normalizeWikiContent,
  normalizeWikiSources,
  normalizeWikiSummary,
  normalizeWikiTitle,
} from "@/lib/wiki";
import { parseKnowledgeBaseId, requireKnowledgeBase } from "@/lib/wikiApi";

export async function GET(request: NextRequest): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;
  const access = await requireKnowledgeBase(
    user,
    parseKnowledgeBaseId(request.nextUrl.searchParams.get("projectId")),
  );
  if (access instanceof Response) return access;

  const pages = await listWikiTree(access.projectId);
  return Response.json({
    knowledgeBase: {
      projectId: access.projectId,
      name: access.projectName ?? "Global knowledge base",
      canEdit: access.canEdit,
    },
    // Readers only see published material; editors see everything.
    pages: access.canEdit ? pages : pages.filter((page) => page.status === "published"),
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;
  const body = await readJsonRecord(request);
  if (body instanceof Response) return body;

  const access = await requireKnowledgeBase(user, parseKnowledgeBaseId(body.projectId), {
    edit: true,
  });
  if (access instanceof Response) return access;

  const title = normalizeWikiTitle(body.title);
  // Absent fields mean "not set" on creation; only malformed values are rejected.
  const summary = body.summary === undefined ? null : normalizeWikiSummary(body.summary);
  const content = normalizeWikiContent(body.content ?? "");
  const sources = normalizeWikiSources(body.sources ?? []);
  const authorityRank =
    body.authorityRank === undefined ? null : normalizeAuthorityRankInput(body.authorityRank);
  const status = body.status === undefined ? "draft" : body.status;
  const parentId = body.parentId === undefined || body.parentId === null ? null : body.parentId;
  const sourceMessageId =
    body.sourceMessageId === undefined || body.sourceMessageId === null ? null : body.sourceMessageId;
  if (
    !title ||
    summary === undefined ||
    content === null ||
    sources === null ||
    authorityRank === undefined ||
    !isWikiStatus(status) ||
    (parentId !== null && !isUuid(parentId)) ||
    (sourceMessageId !== null && !isUuid(sourceMessageId))
  ) {
    return Response.json({ error: "The page payload is invalid." }, { status: 400 });
  }

  const created = await createWikiPage({
    projectId: access.projectId,
    parentId,
    title,
    summary,
    content,
    status,
    authorityRank,
    sources,
    sourceMessageId,
    userId: user.id,
  });
  if (created === "invalid-parent") {
    return Response.json(
      { error: "The parent page must belong to the same knowledge base." },
      { status: 400 },
    );
  }
  const page = await getWikiPage(created.id, access.canEdit);
  return Response.json({ page }, { status: 201 });
}
