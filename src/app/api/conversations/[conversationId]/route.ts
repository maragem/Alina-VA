import { NextRequest } from "next/server";
import {
  deleteOwnedConversation,
  getOwnedConversation,
  getOwnedConversationDetail,
  renameOwnedConversation,
} from "@/db/repositories/conversations";
import { isUuid, normalizeTitle } from "@/lib/conversations";
import { requireAppUser } from "@/lib/currentUser";
import { deleteHaystackSearchSession } from "@/lib/haystackSearchSessions";

type Context = RouteContext<"/api/conversations/[conversationId]">;

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
  const detail = await getOwnedConversationDetail(user.id, conversationId);
  if (!detail) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }
  return Response.json({
    conversation: {
      id: detail.conversation.id,
      title: detail.conversation.title,
      projectId: detail.conversation.projectId,
      createdAt: detail.conversation.createdAt.toISOString(),
      updatedAt: detail.conversation.updatedAt.toISOString(),
    },
    messages: detail.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      status: message.status,
      replyToMessageId: message.replyToMessageId,
      queryId: message.haystackQueryId,
      resultId: message.haystackResultId,
      attachments: message.attachments ?? [],
      createdAt: message.createdAt.toISOString(),
    })),
    sources: detail.sources.map((source) => ({
      messageId: source.messageId,
      citationOrder: source.citationOrder,
      sourceMetadata: source.sourceMetadata,
    })),
  });
}

export async function PATCH(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;
  const { conversationId } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    title?: unknown;
  } | null;
  const title = normalizeTitle(body?.title);
  if (!isUuid(conversationId) || !title) {
    return Response.json({ error: "A valid title is required." }, { status: 400 });
  }
  const conversation = await renameOwnedConversation(
    user.id,
    conversationId,
    title,
  );
  if (!conversation) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }
  return Response.json({
    conversation: {
      id: conversation.id,
      title: conversation.title,
      projectId: conversation.projectId,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    },
  });
}

export async function DELETE(
  _request: NextRequest,
  context: Context,
): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;
  const { conversationId } = await context.params;
  if (!isUuid(conversationId)) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }
  const conversation = await getOwnedConversation(user.id, conversationId);
  if (!conversation) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }
  try {
    await deleteHaystackSearchSession(conversation.haystackSearchSessionId);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not delete the Haystack chat session.",
      },
      { status: 502 },
    );
  }
  await deleteOwnedConversation(user.id, conversationId);
  return new Response(null, { status: 204 });
}