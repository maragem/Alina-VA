import { NextRequest } from "next/server";
import { searchMemberCandidates } from "@/db/repositories/projects";
import { isUuid } from "@/lib/conversations";
import { requireAppUser } from "@/lib/currentUser";
import { normalizeMemberQuery } from "@/lib/projects";
import type { RouteParams } from "@/types/routeParams";

type Context = RouteParams<"projectId">;

export async function GET(request: NextRequest, context: Context): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;
  const { projectId } = await context.params;
  const query = normalizeMemberQuery(request.nextUrl.searchParams.get("query"));
  if (!isUuid(projectId) || !query) {
    return Response.json({ error: "A search query is required." }, { status: 400 });
  }
  const candidates = await searchMemberCandidates(user.id, projectId, query);
  if (!candidates) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({ candidates });
}