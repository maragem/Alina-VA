import { NextRequest } from "next/server";
import { removeConversationAttachment } from "@/db/repositories/conversations";
import { isUuid } from "@/lib/conversations";
import { requireAppUser } from "@/lib/currentUser";

export async function DELETE(
  _request: NextRequest,
  context: RouteContext<"/api/conversations/[conversationId]/attachments/[attachmentId]">,
): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;
  const { conversationId, attachmentId } = await context.params;
  if (!isUuid(conversationId) || !isUuid(attachmentId)) {
    return Response.json({ error: "Attachment not found." }, { status: 404 });
  }
  const removed = await removeConversationAttachment(
    user.id,
    conversationId,
    attachmentId,
  );
  if (!removed) {
    return Response.json({ error: "Attachment not found." }, { status: 404 });
  }
  return new Response(null, { status: 204 });
}
