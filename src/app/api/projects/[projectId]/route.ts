import { NextRequest } from "next/server";
import {
  getProjectDetail,
  renameProject,
  softDeleteProject,
} from "@/db/repositories/projects";
import { isUuid } from "@/lib/conversations";
import { requireAppUser } from "@/lib/currentUser";
import { normalizeProjectName } from "@/lib/projects";
import type { RouteParams } from "@/types/routeParams";

type Context = RouteParams<"projectId">;

export async function GET(_request: NextRequest, context: Context): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;
  const { projectId } = await context.params;
  if (!isUuid(projectId)) return Response.json({ error: "Not found." }, { status: 404 });
  const detail = await getProjectDetail(user.id, projectId);
  if (!detail) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({
    project: {
      id: detail.id,
      name: detail.name,
      role: detail.role,
      createdAt: detail.createdAt.toISOString(),
      updatedAt: detail.updatedAt.toISOString(),
      fileCount: detail.files.length,
      memberCount: detail.members.length,
    },
    members: detail.members.map((member) => ({
      ...member,
      createdAt: member.createdAt.toISOString(),
    })),
    fileIds: detail.files.map((file) => file.fileId),
  });
}

export async function PATCH(request: NextRequest, context: Context): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;
  const { projectId } = await context.params;
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = normalizeProjectName(body?.name);
  if (!isUuid(projectId) || !name) {
    return Response.json({ error: "Invalid project update." }, { status: 400 });
  }
  const project = await renameProject(user.id, projectId, name);
  if (!project) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({
    project: {
      ...project,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      deletedAt: project.deletedAt?.toISOString() ?? null,
    },
  });
}

export async function DELETE(_request: NextRequest, context: Context): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;
  const { projectId } = await context.params;
  if (!isUuid(projectId)) return Response.json({ error: "Not found." }, { status: 404 });
  const deleted = await softDeleteProject(user.id, projectId);
  if (!deleted) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({
    projectId: deleted.id,
    deletedAt: deleted.deletedAt?.toISOString() ?? null,
  });
}