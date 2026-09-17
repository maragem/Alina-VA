export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
export const STORED_FILE_EXTENSIONS = [".pdf", ".docx", ".xlsx", ".txt", ".md"];
export const CONVERTIBLE_FILE_EXTENSIONS = [".doc", ".odt"];
export const ACCEPTED_FILE_EXTENSIONS = [
  ...STORED_FILE_EXTENSIONS,
  ...CONVERTIBLE_FILE_EXTENSIONS,
];

export function isSupportedFileName(fileName: string): boolean {
  const normalizedName = fileName.toLowerCase();
  return ACCEPTED_FILE_EXTENSIONS.some((extension) =>
    normalizedName.endsWith(extension),
  );
}

export function getSupportedExtension(fileName: string): string | null {
  const normalizedName = fileName.toLowerCase();
  return (
    ACCEPTED_FILE_EXTENSIONS.find((extension) =>
      normalizedName.endsWith(extension),
    ) ?? null
  );
}

export function isStoredFileName(fileName: string): boolean {
  const normalizedName = fileName.toLowerCase();
  return STORED_FILE_EXTENSIONS.some((extension) =>
    normalizedName.endsWith(extension),
  );
}

export function fileAcceptanceError(file: Pick<File, "name" | "size">): string | null {
  if (!isSupportedFileName(file.name)) {
    return "Use a PDF, DOC, DOCX, ODT, XLSX, TXT, or MD file.";
  }
  if (file.size === 0) return "Empty files cannot be uploaded.";
  if (file.size > MAX_FILE_SIZE_BYTES) return "Files must not exceed 50 MB.";
  return null;
}