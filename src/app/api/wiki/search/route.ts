import { NextRequest } from "next/server";
import { searchWikiPages } from "@/db/repositories/wiki";
import { requireAppUser } from "@/lib/currentUser";
import { WIKI_SEARCH_QUERY_MAX_LENGTH } from "@/lib/wiki";
import { parseKnowledgeBaseId, requireKnowledgeBase } from "@/lib/wikiApi";

export async function GET(request: NextRequest): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!query || query.length > WIKI_SEARCH_QUERY_MAX_LENGTH) {
    return Response.json({ error: "q is required." }, { status: 400 });
  }
  const access = await requireKnowledgeBase(
    user,
    parseKnowledgeBaseId(request.nextUrl.searchParams.get("projectId")),
  );
  if (access instanceof Response) return access;

  const hits = await searchWikiPages([access.projectId], query, {
    limit: 20,
    includeDrafts: access.canEdit,
  });
  return Response.json({ hits });
}
