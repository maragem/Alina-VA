import { NextRequest } from "next/server";
import {
  addProjectFiles,
  getProjectFileIdsForMember,
  removeProjectFile,
} from "@/db/repositories/projects";
import { getFileAccessProjection } from "@/db/repositories/filePermissions";
import { isUuid } from "@/lib/conversations";
import { requireAppUser } from "@/lib/currentUser";
import { getHaystackApiKey, getHaystackWorkspace } from "@/lib/haystackConfig";
import { updateHaystackAccessMetadata } from "@/lib/haystackAccessMetadata";
import { normalizeFileIds } from "@/lib/projects";
import type { RouteParams } from "@/types/routeParams";

type Context = RouteParams<"projectId">;

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

export async function GET(_request: NextRequest, context: Context): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;
  const { projectId } = await context.params;
  if (!isUuid(projectId)) return Response.json({ error: "Not found." }, { status: 404 });
  const fileIds = await getProjectFileIdsForMember(user.id, projectId);
  if (!fileIds) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({ fileIds });
}

export async function POST(request: NextRequest, context: Context): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;
  if (!API_KEY || !WORKSPACE) {
    return Response.json(
      { error: "Haystack configuration is incomplete." },
      { status: 500 },
    );
  }
  const { projectId } = await context.params;
  const body = (await request.json().catch(() => null)) as { fileIds?: unknown } | null;
  const fileIds = normalizeFileIds(body?.fileIds);
  if (!isUuid(projectId) || !fileIds) {
    return Response.json({ error: "Invalid file selection." }, { status: 400 });
  }
  const inserted = await addProjectFiles(user.id, projectId, fileIds);
  if (inserted === null) return Response.json({ error: "Not found." }, { status: 404 });
  if (inserted === false) {
    return Response.json(
      { error: "Only project files you manage can be assigned." },
      { status: 403 },
    );
  }
  try {
    await Promise.all(fileIds.map(synchronizeFile));
  } catch (error) {
    await Promise.all(
      inserted.map((assignment) =>
        removeProjectFile(user.id, projectId, assignment.fileId),
      ),
    );
    await Promise.allSettled(fileIds.map(synchronizeFile));
    console.error("Project file metadata synchronization failed:", error);
    return Response.json(
      { error: "The project files could not be synchronized with Haystack." },
      { status: 502 },
    );
  }
  return Response.json({ added: inserted.length });
}