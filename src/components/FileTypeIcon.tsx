import {
  File,
  FileSpreadsheet,
  FileText,
  type LucideIcon,
} from "lucide-react";

const ICON_BY_EXTENSION: Record<string, LucideIcon> = {
  pdf: FileText,
  doc: FileText,
  docx: FileText,
  odt: FileText,
  txt: FileText,
  md: FileText,
  xlsx: FileSpreadsheet,
  xls: FileSpreadsheet,
  csv: FileSpreadsheet,
};

function extensionOf(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex === -1 ? "" : fileName.slice(dotIndex + 1).toLowerCase();
}

type FileTypeIconProps = {
  fileName: string;
  className?: string;
};

/** Renders a lucide icon guessed from the file's extension, falling back to a generic file icon. */
export function FileTypeIcon({ fileName, className }: FileTypeIconProps) {
  const Icon = ICON_BY_EXTENSION[extensionOf(fileName)] ?? File;
  return <Icon className={className} aria-hidden="true" />;
}
