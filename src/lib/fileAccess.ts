import { getFileViewDecision } from "@/db/repositories/filePermissions";
import { fetchHaystackAccessScope } from "@/lib/haystackAccessMetadata";

export function resolveChatFileIds({
  allFileIds,
  projectScopedFileIds,
  assignedProjectFileIds,
}: {
  allFileIds: readonly string[];
  projectScopedFileIds: ReadonlySet<string>;
  assignedProjectFileIds?: readonly string[];
}): string[] {
  const assignedIds = new Set(assignedProjectFileIds ?? []);

  return [...new Set(allFileIds)].filter(
    (fileId) => !projectScopedFileIds.has(fileId) || assignedIds.has(fileId),
  );
}

export async function canViewHaystackFile({
  userId,
  fileId,
  apiKey,
  workspace,
}: {
  userId: string;
  fileId: string;
  apiKey: string;
  workspace: string;
}): Promise<boolean> {
  const decision = await getFileViewDecision(userId, fileId);
  if (decision !== "unmanaged") return decision === "allow";

  // No local ownership row: trust the Haystack access metadata, which is what retrieval filters on.
  const scope = await fetchHaystackAccessScope({ apiKey, workspace, fileId });
  return scope !== "project";
}
