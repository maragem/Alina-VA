import { NextRequest } from "next/server";
import {
  removeProjectMember,
  updateProjectMemberRole,
} from "@/db/repositories/projects";
import { isUuid } from "@/lib/conversations";
import { requireAppUser } from "@/lib/currentUser";
import { isProjectRole } from "@/lib/projects";
import type { RouteParams } from "@/types/routeParams";

type Context = RouteParams<"projectId" | "userId">;

function conflict(result: unknown): Response | null {
  return result === "last-admin"
    ? Response.json({ error: "A project must keep at least one admin." }, { status: 409 })
    : null;
}

export async function PATCH(request: NextRequest, context: Context): Promise<Response> {
  const currentUser = await requireAppUser();
  if (currentUser instanceof Response) return currentUser;
  const { projectId, userId } = await context.params;
  const body = (await request.json().catch(() => null)) as { role?: unknown } | null;
  if (!isUuid(projectId) || !isUuid(userId) || !isProjectRole(body?.role)) {
    return Response.json({ error: "Invalid member update." }, { status: 400 });
  }
  const updated = await updateProjectMemberRole(
    currentUser.id,
    projectId,
    userId,
    body.role,
  );
  if (updated === null || updated === false) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  return conflict(updated) ?? Response.json({ member: updated });
}

export async function DELETE(_request: NextRequest, context: Context): Promise<Response> {
  const currentUser = await requireAppUser();
  if (currentUser instanceof Response) return currentUser;
  const { projectId, userId } = await context.params;
  if (!isUuid(projectId) || !isUuid(userId)) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  const removed = await removeProjectMember(currentUser.id, projectId, userId);
  if (removed === null || removed === false) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  return conflict(removed) ?? Response.json({ removed: true });
}