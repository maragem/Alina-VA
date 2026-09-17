import { NextRequest } from "next/server";
import {
  addConversationAttachment,
  createConversationWithQuestion,
  listUserConversations,
} from "@/db/repositories/conversations";
import {
  AttachmentUploadError,
  uploadConversationAttachment,
  type UploadedAttachment,
} from "@/lib/conversationAttachmentUpload";
import {
  decodeConversationCursor,
  encodeConversationCursor,
  normalizeQuestion,
  titleFromQuestion,
} from "@/lib/conversations";
import { requireAppUser } from "@/lib/currentUser";
import { getProjectFileIdsForMember } from "@/db/repositories/projects";
import { isUuid } from "@/lib/conversations";
import {
  configuredHaystackPipelineId,
  createHaystackSearchSession,
  deleteHaystackSearchSession,
} from "@/lib/haystackSearchSessions";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export async function GET(request: NextRequest): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;

  const cursorValue = request.nextUrl.searchParams.get("cursor");
  const cursor = decodeConversationCursor(cursorValue);
  if (cursorValue && !cursor) {
    return Response.json({ error: "Invalid cursor." }, { status: 400 });
  }
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit"));
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;
  const rawQ = request.nextUrl.searchParams.get("q");
  const titleSearch = rawQ ? rawQ.trim().slice(0, 100) || undefined : undefined;
  const rows = await listUserConversations(user.id, limit + 1, cursor, titleSearch);
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map((conversation) => ({
    ...conversation,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  }));
  const last = items.at(-1);

  return Response.json({
    conversations: items,
    nextCursor:
      hasMore && last
        ? encodeConversationCursor({ id: last.id, updatedAt: last.updatedAt })
        : null,
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;

  let rawQuestion: unknown;
  let projectId: unknown;
  let files: File[] = [];
  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return Response.json(
        { error: "Upload data must use multipart form data." },
        { status: 400 },
      );
    }
    rawQuestion = formData.get("question");
    projectId = formData.get("projectId") ?? undefined;
    files = formData
      .getAll("files")
      .filter((entry): entry is File => entry instanceof File);
  } else {
    const body = (await request.json().catch(() => null)) as {
      question?: unknown;
      projectId?: unknown;
    } | null;
    rawQuestion = body?.question;
    projectId = body?.projectId;
  }
  const question = normalizeQuestion(rawQuestion);
  if (!question || (projectId !== undefined && !isUuid(projectId))) {
    return Response.json({ error: "A valid question is required." }, { status: 400 });
  }
  if (typeof projectId === "string") {
    const fileIds = await getProjectFileIdsForMember(user.id, projectId);
    if (!fileIds) return Response.json({ error: "Project not found." }, { status: 404 });
    if (fileIds.length === 0) {
      return Response.json(
        { error: "Add at least one document before asking in this project." },
        { status: 409 },
      );
    }
  }

  const uploads: UploadedAttachment[] = [];
  for (const file of files) {
    try {
      uploads.push(await uploadConversationAttachment(file));
    } catch (error) {
      if (error instanceof AttachmentUploadError) {
        return Response.json(
          { error: error.message },
          { status: error.status },
        );
      }
      return Response.json(
        { error: "Could not reach Haystack file services." },
        { status: 502 },
      );
    }
  }

  let searchSessionId: string;
  try {
    searchSessionId = await createHaystackSearchSession();
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Haystack is unavailable." },
      { status: 502 },
    );
  }

  try {
    const created = await createConversationWithQuestion({
      userId: user.id,
      projectId: typeof projectId === "string" ? projectId : undefined,
      title: titleFromQuestion(question),
      question,
      haystackSearchSessionId: searchSessionId,
      haystackPipelineId: configuredHaystackPipelineId(),
      attachments: uploads.map((upload) => ({
        fileId: upload.fileId,
        fileName: upload.fileName,
      })),
    });
    const attachments = [];
    for (const upload of uploads) {
      const attachment = await addConversationAttachment(
        user.id,
        created.conversation.id,
        {
          haystackFileId: upload.fileId,
          fileName: upload.fileName,
          sizeBytes: upload.sizeBytes,
        },
      );
      if (attachment) {
        attachments.push({
          id: attachment.id,
          fileId: attachment.haystackFileId,
          fileName: attachment.fileName,
          sizeBytes: attachment.sizeBytes,
          createdAt: attachment.createdAt.toISOString(),
        });
      }
    }
    return Response.json(
      {
        attachments,
        conversation: {
          id: created.conversation.id,
          title: created.conversation.title,
          projectId: created.conversation.projectId,
          createdAt: created.conversation.createdAt.toISOString(),
          updatedAt: created.conversation.updatedAt.toISOString(),
        },
        message: {
          id: created.message.id,
          role: created.message.role,
          content: created.message.content,
          attachments: created.message.attachments ?? [],
          createdAt: created.message.createdAt.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch {
    try {
      await deleteHaystackSearchSession(searchSessionId);
    } catch (cleanupError) {
      console.error("Could not clean up Haystack search session:", cleanupError);
    }
    return Response.json(
      { error: "Could not create the conversation." },
      { status: 500 },
    );
  }
}