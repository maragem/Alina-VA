import { and, asc, desc, eq, ilike, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  conversationAttachments,
  conversations,
  messages,
  messageSources,
  type AttachmentSnapshot,
  type SourceSnapshot,
} from "@/db/schema";
import type { SourceItem } from "@/components/global/sourceDocuments";

export async function listUserConversations(
  userId: string,
  limit: number,
  cursor: Readonly<{ updatedAt: string; id: string }> | null,
  titleSearch?: string,
) {
  const cursorFilter = cursor
    ? or(
        lt(conversations.updatedAt, new Date(cursor.updatedAt)),
        and(
          eq(conversations.updatedAt, new Date(cursor.updatedAt)),
          lt(conversations.id, cursor.id),
        ),
      )
    : undefined;

  // ilike catches exact substrings; FTS with 'english' dictionary catches stemmed forms (e.g. "signatures" → "signature")
  const titleFilter = titleSearch
    ? or(
        ilike(conversations.title, `%${titleSearch}%`),
        sql`to_tsvector('english', ${conversations.title}) @@ websearch_to_tsquery('english', ${titleSearch})`,
      )
    : undefined;

  const filters = [
    eq(conversations.userId, userId),
    cursorFilter,
    titleFilter,
  ].filter(Boolean) as Parameters<typeof and>;

  return db
    .select({
      id: conversations.id,
      title: conversations.title,
      projectId: conversations.projectId,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(and(...filters))
    .orderBy(desc(conversations.updatedAt), desc(conversations.id))
    .limit(limit);
}

export async function createConversationWithQuestion(input: {
  userId: string;
  projectId?: string;
  title: string;
  question: string;
  haystackSearchSessionId: string;
  haystackPipelineId: string;
  attachments?: readonly AttachmentSnapshot[];
}) {
  return db.transaction(async (transaction) => {
    const [conversation] = await transaction
      .insert(conversations)
      .values({
        userId: input.userId,
        projectId: input.projectId,
        title: input.title,
        haystackSearchSessionId: input.haystackSearchSessionId,
        haystackPipelineId: input.haystackPipelineId,
      })
      .returning();
    const [message] = await transaction
      .insert(messages)
      .values({
        conversationId: conversation.id,
        role: "user",
        content: input.question,
        attachments: input.attachments?.length ? input.attachments : undefined,
      })
      .returning();
    return { conversation, message };
  });
}

export async function getOwnedConversation(userId: string, id: string) {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .limit(1);
  return conversation;
}

export async function getOwnedConversationDetail(userId: string, id: string) {
  const conversation = await getOwnedConversation(userId, id);
  if (!conversation) return null;

  const transcript = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(messages.createdAt, messages.id);
  const assistantIds = transcript
    .filter((message) => message.role === "assistant")
    .map((message) => message.id);
  const sources = assistantIds.length
    ? await db.query.messageSources.findMany({
        where: (table, { inArray }) => inArray(table.messageId, assistantIds),
        orderBy: (table, { asc }) => [asc(table.citationOrder)],
      })
    : [];

  return { conversation, messages: transcript, sources };
}

export async function addUserMessage(
  userId: string,
  conversationId: string,
  content: string,
  attachments?: readonly AttachmentSnapshot[],
) {
  return db.transaction(async (transaction) => {
    const [owned] = await transaction
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.userId, userId),
        ),
      )
      .limit(1);
    if (!owned) return null;

    const now = new Date();
    const [message] = await transaction
      .insert(messages)
      .values({
        conversationId,
        role: "user",
        content,
        attachments: attachments?.length ? attachments : undefined,
        createdAt: now,
      })
      .returning();
    await transaction
      .update(conversations)
      .set({ updatedAt: now })
      .where(eq(conversations.id, conversationId));
    return message;
  });
}

export async function renameOwnedConversation(
  userId: string,
  id: string,
  title: string,
) {
  const [conversation] = await db
    .update(conversations)
    .set({ title, updatedAt: new Date() })
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .returning();
  return conversation;
}

export async function deleteOwnedConversation(
  userId: string,
  id: string,
): Promise<boolean> {
  const deleted = await db
    .delete(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .returning({ id: conversations.id });
  return deleted.length === 1;
}

export async function getMessageStreamContext(
  userId: string,
  conversationId: string,
  userMessageId: string,
) {
  const [context] = await db
    .select({
      conversationId: conversations.id,
      projectId: conversations.projectId,
      question: messages.content,
      searchSessionId: conversations.haystackSearchSessionId,
      pipelineId: conversations.haystackPipelineId,
    })
    .from(messages)
    .innerJoin(
      conversations,
      and(
        eq(conversations.id, messages.conversationId),
        eq(conversations.userId, userId),
      ),
    )
    .where(
      and(
        eq(messages.id, userMessageId),
        eq(messages.conversationId, conversationId),
        eq(messages.role, "user"),
      ),
    )
    .limit(1);
  if (!context) return null;

  const [response] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.replyToMessageId, userMessageId))
    .limit(1);
  const attachmentFileIds = await listActiveAttachmentFileIds(conversationId);
  return {
    ...context,
    alreadyAnswered: Boolean(response),
    attachmentFileIds,
  };
}

export async function listActiveAttachmentFileIds(
  conversationId: string,
): Promise<string[]> {
  const rows = await db
    .select({ haystackFileId: conversationAttachments.haystackFileId })
    .from(conversationAttachments)
    .where(
      and(
        eq(conversationAttachments.conversationId, conversationId),
        isNull(conversationAttachments.removedAt),
      ),
    )
    .orderBy(asc(conversationAttachments.createdAt));
  return rows.map((row) => row.haystackFileId);
}

export async function listActiveConversationAttachments(
  userId: string,
  conversationId: string,
) {
  const owned = await getOwnedConversation(userId, conversationId);
  if (!owned) return null;
  return db
    .select()
    .from(conversationAttachments)
    .where(
      and(
        eq(conversationAttachments.conversationId, conversationId),
        isNull(conversationAttachments.removedAt),
      ),
    )
    .orderBy(asc(conversationAttachments.createdAt));
}

export async function addConversationAttachment(
  userId: string,
  conversationId: string,
  input: { haystackFileId: string; fileName: string; sizeBytes: number },
) {
  const owned = await getOwnedConversation(userId, conversationId);
  if (!owned) return null;
  const [attachment] = await db
    .insert(conversationAttachments)
    .values({
      conversationId,
      haystackFileId: input.haystackFileId,
      fileName: input.fileName,
      sizeBytes: input.sizeBytes,
      addedByUserId: userId,
    })
    .returning();
  return attachment;
}

export async function removeConversationAttachment(
  userId: string,
  conversationId: string,
  attachmentId: string,
): Promise<boolean> {
  const owned = await getOwnedConversation(userId, conversationId);
  if (!owned) return false;
  const removed = await db
    .update(conversationAttachments)
    .set({ removedAt: new Date() })
    .where(
      and(
        eq(conversationAttachments.id, attachmentId),
        eq(conversationAttachments.conversationId, conversationId),
        isNull(conversationAttachments.removedAt),
      ),
    )
    .returning({ id: conversationAttachments.id });
  return removed.length === 1;
}

export async function finalizeAssistantMessage(input: {
  id: string;
  conversationId: string;
  userMessageId: string;
  content: string;
  queryId: string | null;
  resultId: string | null;
  sources: readonly Readonly<{
    documentId: string | null;
    chunkId: string | null;
    item: SourceItem;
  }>[];
}): Promise<boolean> {
  return db.transaction(async (transaction) => {
    const [inserted] = await transaction
      .insert(messages)
      .values({
        id: input.id,
        conversationId: input.conversationId,
        replyToMessageId: input.userMessageId,
        role: "assistant",
        content: input.content,
        status: "complete",
        haystackQueryId: input.queryId,
        haystackResultId: input.resultId,
      })
      .onConflictDoNothing()
      .returning({ id: messages.id });
    if (!inserted) return false;

    if (input.sources.length > 0) {
      await transaction.insert(messageSources).values(
        input.sources.map((source, citationOrder) => ({
          messageId: inserted.id,
          documentId: source.documentId,
          chunkId: source.chunkId,
          citationOrder,
          sourceMetadata: source.item as unknown as SourceSnapshot,
        })),
      );
    }
    await transaction
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, input.conversationId));
    return true;
  });
}