import { NextRequest } from "next/server";
import {
  createProject,
  listUserProjects,
} from "@/db/repositories/projects";
import { requireAppUser } from "@/lib/currentUser";
import { normalizeProjectName } from "@/lib/projects";

function serializeProject<T extends { createdAt: Date; updatedAt: Date }>(project: T) {
  return {
    ...project,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export async function GET(): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;
  const rows = await listUserProjects(user.id);
  return Response.json({ projects: rows.map(serializeProject) });
}

export async function POST(request: NextRequest): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = normalizeProjectName(body?.name);
  if (!name) {
    return Response.json({ error: "A valid project name is required." }, { status: 400 });
  }
  const project = await createProject(user.id, name);
  return Response.json({ project: serializeProject(project) }, { status: 201 });
}