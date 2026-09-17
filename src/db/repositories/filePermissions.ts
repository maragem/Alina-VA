import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  managedFiles,
  projectFiles,
  projectMemberships,
  users,
} from "@/db/schema";
import type { UserRole } from "@/lib/roles";

export type FileScope = "global" | "project";

export async function ensureFileOwner(
  fileId: string,
  userId: string,
  scope: FileScope = "global",
): Promise<void> {
  await db
    .insert(managedFiles)
    .values({ fileId, createdByUserId: userId, scope })
    .onConflictDoNothing({ target: managedFiles.fileId });
}

export async function listFileScopes(
  fileIds: readonly string[],
): Promise<Map<string, FileScope>> {
  if (fileIds.length === 0) return new Map();

  const rows = await db
    .select({ fileId: managedFiles.fileId, scope: managedFiles.scope })
    .from(managedFiles)
    .where(inArray(managedFiles.fileId, [...fileIds]));
  return new Map(rows.map((row) => [row.fileId, row.scope]));
}

export async function listAllProjectScopedFileIds(): Promise<string[]> {
  const rows = await db
    .select({ fileId: managedFiles.fileId })
    .from(managedFiles)
    .where(eq(managedFiles.scope, "project"));
  return rows.map((row) => row.fileId);
}

export async function getFileAccessProjection(
  fileId: string,
): Promise<{ scope: FileScope; projectIds: string[] } | null> {
  const [file] = await db
    .select({ scope: managedFiles.scope })
    .from(managedFiles)
    .where(eq(managedFiles.fileId, fileId))
    .limit(1);
  if (!file) return null;

  const assignments = await db
    .select({ projectId: projectFiles.projectId })
    .from(projectFiles)
    .where(eq(projectFiles.fileId, fileId));
  return {
    scope: file.scope,
    projectIds: assignments.map((assignment) => assignment.projectId).sort(),
  };
}

export async function removeManagedFile(fileId: string): Promise<void> {
  await db.delete(managedFiles).where(eq(managedFiles.fileId, fileId));
}

export async function getUserRole(userId: string): Promise<UserRole | null> {
  const [row] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.role ?? null;
}

export async function canMutateFile(
  userId: string,
  fileId: string,
): Promise<boolean> {
  const role = await getUserRole(userId);
  if (role === "admin") return true;

  const [ownership] = await db
    .select({ fileId: managedFiles.fileId })
    .from(managedFiles)
    .where(
      and(
        eq(managedFiles.fileId, fileId),
        eq(managedFiles.createdByUserId, userId),
      ),
    )
    .limit(1);
  return Boolean(ownership);
}

/**
 * "unmanaged" means the file exists in Haystack but has no local `managed_files` row
 * (e.g. uploaded from another environment sharing the same workspace); the caller must
 * fall back to the Haystack access metadata instead of assuming the file is global.
 */
export type FileViewDecision = "allow" | "deny" | "unmanaged";

export async function getFileViewDecision(
  userId: string,
  fileId: string,
): Promise<FileViewDecision> {
  const role = await getUserRole(userId);
  if (role === "admin") return "allow";

  const [file] = await db
    .select({
      ownerId: managedFiles.createdByUserId,
      scope: managedFiles.scope,
    })
    .from(managedFiles)
    .where(eq(managedFiles.fileId, fileId))
    .limit(1);
  if (!file) return "unmanaged";
  if (file.scope === "global" || file.ownerId === userId) return "allow";

  const [assignment] = await db
    .select({ fileId: projectFiles.fileId })
    .from(projectFiles)
    .innerJoin(
      projectMemberships,
      and(
        eq(projectMemberships.projectId, projectFiles.projectId),
        eq(projectMemberships.userId, userId),
      ),
    )
    .where(eq(projectFiles.fileId, fileId))
    .limit(1);
  return assignment ? "allow" : "deny";
}

export async function listFileMutationPermissions(
  userId: string,
  fileIds: readonly string[],
): Promise<Map<string, boolean>> {
  if (fileIds.length === 0) return new Map();

  const role = await getUserRole(userId);
  if (role === "admin") {
    return new Map(fileIds.map((fileId) => [fileId, true]));
  }

  const ownedRows = await db
    .select({ fileId: managedFiles.fileId })
    .from(managedFiles)
    .where(
      and(
        eq(managedFiles.createdByUserId, userId),
        inArray(managedFiles.fileId, [...fileIds]),
      ),
    );
  const ownedIds = new Set(ownedRows.map((row) => row.fileId));
  return new Map(fileIds.map((fileId) => [fileId, ownedIds.has(fileId)]));
}
