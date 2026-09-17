import { NextRequest } from "next/server";
import { addProjectMember } from "@/db/repositories/projects";
import { isUuid } from "@/lib/conversations";
import { requireAppUser } from "@/lib/currentUser";
import { isProjectRole } from "@/lib/projects";
import type { RouteParams } from "@/types/routeParams";

type Context = RouteParams<"projectId">;

export async function POST(request: NextRequest, context: Context): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;
  const { projectId } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    userId?: unknown;
    role?: unknown;
  } | null;
  if (!isUuid(projectId) || !isUuid(body?.userId) || !isProjectRole(body?.role)) {
    return Response.json({ error: "Invalid member." }, { status: 400 });
  }
  const member = await addProjectMember(user.id, projectId, body.userId, body.role);
  if (member === null) return Response.json({ error: "Not found." }, { status: 404 });
  if (member === false) {
    return Response.json({ error: "This user is already a member." }, { status: 409 });
  }
  return Response.json({ member }, { status: 201 });
}