import { NextRequest } from "next/server";
import {
  addConversationAttachment,
  getOwnedConversation,
  listActiveConversationAttachments,
} from "@/db/repositories/conversations";
import { isUuid } from "@/lib/conversations";
import {
  AttachmentUploadError,
  uploadConversationAttachment,
} from "@/lib/conversationAttachmentUpload";
import { requireAppUser } from "@/lib/currentUser";

type Context = RouteContext<"/api/conversations/[conversationId]/attachments">;

export async function GET(
  _request: NextRequest,
  context: Context,
): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;
  const { conversationId } = await context.params;
  if (!isUuid(conversationId)) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }
  const attachments = await listActiveConversationAttachments(
    user.id,
    conversationId,
  );
  if (!attachments) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }
  return Response.json({
    attachments: attachments.map((attachment) => ({
      id: attachment.id,
      fileId: attachment.haystackFileId,
      fileName: attachment.fileName,
      sizeBytes: attachment.sizeBytes,
      createdAt: attachment.createdAt.toISOString(),
    })),
  });
}

export async function POST(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;
  const { conversationId } = await context.params;
  if (!isUuid(conversationId)) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }
  const owned = await getOwnedConversation(user.id, conversationId);
  if (!owned) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json(
      { error: "Upload data must use multipart form data." },
      { status: 400 },
    );
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json(
      { error: "Select a file to upload." },
      { status: 400 },
    );
  }

  let uploaded;
  try {
    uploaded = await uploadConversationAttachment(file);
  } catch (error) {
    if (error instanceof AttachmentUploadError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json(
      { error: "Could not reach Haystack file services." },
      { status: 502 },
    );
  }

  const attachment = await addConversationAttachment(user.id, conversationId, {
    haystackFileId: uploaded.fileId,
    fileName: uploaded.fileName,
    sizeBytes: uploaded.sizeBytes,
  });
  if (!attachment) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }
  return Response.json(
    {
      attachment: {
        id: attachment.id,
        fileId: attachment.haystackFileId,
        fileName: attachment.fileName,
        sizeBytes: attachment.sizeBytes,
        createdAt: attachment.createdAt.toISOString(),
      },
    },
    { status: 201 },
  );
}
