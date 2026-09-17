import { NextRequest } from "next/server";
import { restoreProject } from "@/db/repositories/projects";
import { isUuid } from "@/lib/conversations";
import { requireAppUser } from "@/lib/currentUser";
import type { RouteParams } from "@/types/routeParams";

type Context = RouteParams<"projectId">;

export async function POST(_request: NextRequest, context: Context): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;
  const { projectId } = await context.params;
  if (!isUuid(projectId)) return Response.json({ error: "Not found." }, { status: 404 });
  const project = await restoreProject(user.id, projectId);
  if (!project) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({ projectId: project.id });
}