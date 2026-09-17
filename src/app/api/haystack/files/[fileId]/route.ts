import { NextRequest } from "next/server";
import {
  authorityCategoryRank,
  isAuthorityCategory,
} from "@/lib/documentMetadata";
import { removeFileAssignments } from "@/db/repositories/projects";
import { requireAppUser } from "@/lib/currentUser";
import { removeManagedFile } from "@/db/repositories/filePermissions";
import { canViewHaystackFile } from "@/lib/fileAccess";
import { getHaystackApiKey, getHaystackWorkspace } from "@/lib/haystackConfig";

const API_KEY = getHaystackApiKey();
const WORKSPACE = getHaystackWorkspace();
const FILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: NextRequest,
  context: RouteContext<"/api/haystack/files/[fileId]">,
): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;

  if (!API_KEY) {
    return Response.json(
      { error: "Server is missing a Haystack API key." },
      { status: 500 },
    );
  }
  if (!WORKSPACE) {
    return Response.json(
      { error: "Server is missing Haystack workspace configuration." },
      { status: 500 },
    );
  }

  const { fileId } = await context.params;
  if (!FILE_ID_PATTERN.test(fileId)) {
    return Response.json({ error: "Invalid file ID." }, { status: 400 });
  }
  const canView = await canViewHaystackFile({
    userId: user.id,
    fileId,
    apiKey: API_KEY,
    workspace: WORKSPACE,
  });
  if (!canView) {
    return Response.json({ error: "File not found." }, { status: 404 });
  }

  try {
    const response = await fetch(
      `https://api.cloud.deepset.ai/api/v1/workspaces/${encodeURIComponent(WORKSPACE)}/files/${encodeURIComponent(fileId)}`,
      {
        headers: {
          Accept: "*/*",
          Authorization: `Bearer ${API_KEY}`,
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return Response.json(
        { error: response.status === 404 ? "File not found." : "Haystack file retrieval failed." },
        { status: response.status || 502 },
      );
    }

    const headers = new Headers();
    headers.set("Cache-Control", "private, no-store");
    headers.set("Content-Type", response.headers.get("content-type") || "application/octet-stream");
    const contentLength = response.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);

    return new Response(response.body, { status: 200, headers });
  } catch {
    return Response.json(
      { error: "Could not reach Haystack file services." },
      { status: 502 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext<"/api/haystack/files/[fileId]">,
): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;

  if (!API_KEY) {
    return Response.json(
      { error: "Server is missing a Haystack API key." },
      { status: 500 },
    );
  }
  if (!WORKSPACE) {
    return Response.json(
      { error: "Server is missing Haystack workspace configuration." },
      { status: 500 },
    );
  }

  const { fileId } = await context.params;
  if (!FILE_ID_PATTERN.test(fileId)) {
    return Response.json({ error: "Invalid file ID." }, { status: 400 });
  }
  if (user.role !== "admin") {
    return Response.json(
      { error: "You are not allowed to delete this file." },
      { status: 403 },
    );
  }

  try {
    const response = await fetch(
      `https://api.cloud.deepset.ai/api/v1/workspaces/${encodeURIComponent(WORKSPACE)}/files/${encodeURIComponent(fileId)}`,
      {
        method: "DELETE",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return Response.json(
        { error: response.status === 404 ? "File not found." : "Haystack file deletion failed." },
        { status: response.status || 502 },
      );
    }

    await removeFileAssignments(fileId);
    await removeManagedFile(fileId);
    return Response.json({ deleted: true });
  } catch {
    return Response.json(
      { error: "Could not reach Haystack file services." },
      { status: 502 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext<"/api/haystack/files/[fileId]">,
): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;

  if (!API_KEY) {
    return Response.json(
      { error: "Server is missing a Haystack API key." },
      { status: 500 },
    );
  }
  if (!WORKSPACE) {
    return Response.json(
      { error: "Server is missing Haystack workspace configuration." },
      { status: 500 },
    );
  }

  const { fileId } = await context.params;
  if (!FILE_ID_PATTERN.test(fileId)) {
    return Response.json({ error: "Invalid file ID." }, { status: 400 });
  }
  if (user.role !== "admin") {
    return Response.json(
      { error: "You are not allowed to update this file." },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null) as { authorityCategory?: unknown } | null;
  if (!body || !("authorityCategory" in body)) {
    return Response.json({ error: "authorityCategory is required." }, { status: 400 });
  }
  if (body.authorityCategory !== null && !isAuthorityCategory(body.authorityCategory)) {
    return Response.json({ error: "authorityCategory is invalid." }, { status: 400 });
  }

  const meta = body.authorityCategory === null
    ? { authority_category: null, authority_rank: null }
    : {
        authority_category: body.authorityCategory,
        authority_rank: authorityCategoryRank(body.authorityCategory),
      };

  try {
    const response = await fetch(
      `https://api.cloud.deepset.ai/api/v1/workspaces/${encodeURIComponent(WORKSPACE)}/files/${encodeURIComponent(fileId)}/meta`,
      {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(meta),
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return Response.json(
        { error: response.status === 404 ? "File not found." : "Haystack file metadata update failed." },
        { status: response.status || 502 },
      );
    }

    return Response.json({ updated: true });
  } catch {
    return Response.json(
      { error: "Could not reach Haystack file services." },
      { status: 502 },
    );
  }
}