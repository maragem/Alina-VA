import { NextRequest } from "next/server";
import {
  addUserMessage,
  getOwnedConversation,
  listActiveConversationAttachments,
} from "@/db/repositories/conversations";
import { getProjectFileIdsForMember } from "@/db/repositories/projects";
import { isUuid, normalizeQuestion } from "@/lib/conversations";
import { requireAppUser } from "@/lib/currentUser";

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/conversations/[conversationId]/messages">,
): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;
  const { conversationId } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    question?: unknown;
  } | null;
  const question = normalizeQuestion(body?.question);
  if (!isUuid(conversationId) || !question) {
    return Response.json({ error: "A valid question is required." }, { status: 400 });
  }
  const conversation = await getOwnedConversation(user.id, conversationId);
  if (!conversation) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }
  if (conversation.projectId) {
    const fileIds = await getProjectFileIdsForMember(user.id, conversation.projectId);
    if (!fileIds) return Response.json({ error: "Project not found." }, { status: 404 });
    if (fileIds.length === 0) {
      return Response.json(
        { error: "Add at least one document before asking in this project." },
        { status: 409 },
      );
    }
  }
  const activeAttachments = await listActiveConversationAttachments(user.id, conversationId);
  const attachments = (activeAttachments ?? []).map((attachment) => ({
    fileId: attachment.haystackFileId,
    fileName: attachment.fileName,
  }));
  const message = await addUserMessage(user.id, conversationId, question, attachments);
  if (!message) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }
  return Response.json(
    {
      message: {
        id: message.id,
        role: message.role,
        content: message.content,
        attachments: message.attachments ?? [],
        createdAt: message.createdAt.toISOString(),
      },
    },
    { status: 201 },
  );
}