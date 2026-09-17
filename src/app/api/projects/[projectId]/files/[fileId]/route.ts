import { NextRequest } from "next/server";
import {
  getProjectAccess,
  removeProjectFile,
} from "@/db/repositories/projects";
import { getFileAccessProjection } from "@/db/repositories/filePermissions";
import { isUuid } from "@/lib/conversations";
import { requireAppUser } from "@/lib/currentUser";
import { getHaystackApiKey, getHaystackWorkspace } from "@/lib/haystackConfig";
import { updateHaystackAccessMetadata } from "@/lib/haystackAccessMetadata";
import type { RouteParams } from "@/types/routeParams";

type Context = RouteParams<"projectId" | "fileId">;

const API_KEY = getHaystackApiKey();
const WORKSPACE = getHaystackWorkspace();

async function synchronizeFile(fileId: string): Promise<void> {
  const projection = await getFileAccessProjection(fileId);
  if (!projection) throw new Error(`Managed file ${fileId} was not found.`);
  await updateHaystackAccessMetadata({
    apiKey: API_KEY,
    workspace: WORKSPACE,
    fileId,
    ...projection,
  });
}

export async function DELETE(_request: NextRequest, context: Context): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;
  if (!API_KEY || !WORKSPACE) {
    return Response.json(
      { error: "Haystack configuration is incomplete." },
      { status: 500 },
    );
  }
  const { projectId, fileId } = await context.params;
  if (!isUuid(projectId) || !isUuid(fileId)) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  const access = await getProjectAccess(user.id, projectId);
  if (access?.role !== "admin") {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  const projection = await getFileAccessProjection(fileId);
  if (!projection)
    return Response.json({ error: "Not found." }, { status: 404 });

  try {
    await updateHaystackAccessMetadata({
      apiKey: API_KEY,
      workspace: WORKSPACE,
      fileId,
      scope: projection.scope,
      projectIds: projection.projectIds.filter((id) => id !== projectId),
    });
    const removed = await removeProjectFile(user.id, projectId, fileId);
    if (removed === null) {
      await synchronizeFile(fileId);
      return Response.json({ error: "Not found." }, { status: 404 });
    }
    return Response.json({ removed });
  } catch (error) {
    await synchronizeFile(fileId).catch(() => undefined);
    console.error("Project file metadata synchronization failed:", error);
    return Response.json(
      { error: "The project file could not be synchronized with Haystack." },
      { status: 502 },
    );
  }
}