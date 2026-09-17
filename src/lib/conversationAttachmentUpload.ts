import {
  convertDocumentToDocx,
  DocumentConversionError,
  isConvertibleDocument,
} from "@/lib/documentConversion";
import { fileAcceptanceError, MAX_FILE_SIZE_BYTES } from "@/lib/fileValidation";
import { getHaystackApiKey, getHaystackWorkspace } from "@/lib/haystackConfig";

const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export class AttachmentUploadError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type UploadedAttachment = Readonly<{
  fileId: string;
  fileName: string;
  sizeBytes: number;
}>;

/** Uploads a chat attachment to Haystack temporary files (converting to DOCX when needed). */
export async function uploadConversationAttachment(
  file: File,
): Promise<UploadedAttachment> {
  const workspace = getHaystackWorkspace();
  const apiKey = getHaystackApiKey();
  if (!apiKey || !workspace) {
    throw new AttachmentUploadError(
      "Haystack configuration is incomplete.",
      500,
    );
  }
  const acceptanceError = fileAcceptanceError(file);
  if (acceptanceError) {
    throw new AttachmentUploadError(acceptanceError, 400);
  }

  let uploadFile: File = file;
  if (isConvertibleDocument(file.name)) {
    try {
      const converted = await convertDocumentToDocx(
        new Uint8Array(await file.arrayBuffer()),
        file.name,
        MAX_FILE_SIZE_BYTES,
      );
      uploadFile = new File(
        [new Uint8Array(converted.bytes)],
        converted.fileName,
        {
          type: DOCX_CONTENT_TYPE,
        },
      );
    } catch (conversionError) {
      throw new AttachmentUploadError(
        "The document could not be converted to DOCX.",
        conversionError instanceof DocumentConversionError ? 422 : 500,
      );
    }
  }

  const upstreamFormData = new FormData();
  upstreamFormData.append("file", uploadFile, uploadFile.name);

  let response: Response;
  try {
    response = await fetch(
      `https://api.cloud.deepset.ai/api/v1/workspaces/${encodeURIComponent(workspace)}/temporary_files`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: upstreamFormData,
        cache: "no-store",
      },
    );
  } catch {
    throw new AttachmentUploadError(
      "Could not reach Haystack file services.",
      502,
    );
  }
  if (!response.ok) {
    throw new AttachmentUploadError(
      "Haystack temporary file upload failed.",
      response.status || 502,
    );
  }
  const payload = (await response.json().catch(() => null)) as {
    file_id?: unknown;
  } | null;
  if (typeof payload?.file_id !== "string") {
    throw new AttachmentUploadError(
      "Haystack returned an invalid upload response.",
      502,
    );
  }
  return {
    fileId: payload.file_id,
    fileName: uploadFile.name,
    sizeBytes: uploadFile.size,
  };
}
