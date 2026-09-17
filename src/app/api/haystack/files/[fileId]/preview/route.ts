import { NextRequest } from "next/server";
import { canViewHaystackFile } from "@/lib/fileAccess";
import { requireAppUser } from "@/lib/currentUser";
import { convertDocxToPdf, DocumentConversionError } from "@/lib/documentConversion";

const API_KEY = process.env.HAYSTACK_API_KEY?.trim() ?? process.env.DEEPSET_API_KEY?.trim() ?? "";
const WORKSPACE = process.env.HAYSTACK_WORKSPACE?.trim() ?? "";
const FILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PREVIEW_SIZE = 50 * 1024 * 1024;

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;

  const { fileId } = await context.params;
  if (!FILE_ID_PATTERN.test(fileId)) return Response.json({ error: "Invalid file ID." }, { status: 400 });
  if (!API_KEY || !WORKSPACE) return Response.json({ error: "Server is missing Haystack configuration." }, { status: 500 });
  const canView = await canViewHaystackFile({ userId: user.id, fileId, apiKey: API_KEY, workspace: WORKSPACE });
  if (!canView) return Response.json({ error: "File not found." }, { status: 404 });

  try {
    const response = await fetch(
      `https://api.cloud.deepset.ai/api/v1/workspaces/${encodeURIComponent(WORKSPACE)}/files/${encodeURIComponent(fileId)}`,
      {
        headers: {
          Accept: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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

    const converted = await convertDocxToPdf(
      new Uint8Array(await response.arrayBuffer()),
      `${fileId}.docx`,
      MAX_PREVIEW_SIZE,
    );
    return new Response(new Uint8Array(converted.bytes), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "application/pdf",
      },
    });
  } catch (error) {
    if (error instanceof DocumentConversionError && error.reason === "converter-unavailable") {
      return Response.json({ error: "Document preview conversion is unavailable." }, { status: 500 });
    }
    console.error("DOCX preview conversion failed:", error);
    return Response.json({ error: "The Word document could not be previewed." }, { status: 422 });
  }
}