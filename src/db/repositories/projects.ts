import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db/client";
import {
  managedFiles,
  projectFiles,
  projectMemberships,
  projects,
  users,
} from "@/db/schema";
import { getUserRole } from "@/db/repositories/filePermissions";
import type { ProjectRole } from "@/lib/projects";

async function touchProject(
  transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  projectId: string,
): Promise<void> {
  await transaction
    .update(projects)
    .set({ updatedAt: new Date() })
    .where(eq(projects.id, projectId));
}

export async function listUserProjects(userId: string) {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      role: projectMemberships.role,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projectMemberships)
    .innerJoin(projects, eq(projects.id, projectMemberships.projectId))
    .where(
      and(
        eq(projectMemberships.userId, userId),
        isNull(projects.deletedAt),
      ),
    )
    .orderBy(desc(projects.updatedAt), desc(projects.id));

  if (rows.length === 0) return [];
  const projectIds = rows.map((row) => row.id);
  const [fileCounts, memberCounts] = await Promise.all([
    db
      .select({
        projectId: projectFiles.projectId,
        count: sql<number>`count(*)::int`,
      })
      .from(projectFiles)
      .innerJoin(managedFiles, eq(managedFiles.fileId, projectFiles.fileId))
      .where(
        and(
          inArray(projectFiles.projectId, projectIds),
          eq(managedFiles.scope, "project"),
        ),
      )
      .groupBy(projectFiles.projectId),
    db
      .select({
        projectId: projectMemberships.projectId,
        count: sql<number>`count(*)::int`,
      })
      .from(projectMemberships)
      .where(inArray(projectMemberships.projectId, projectIds))
      .groupBy(projectMemberships.projectId),
  ]);
  const filesByProject = new Map(
    fileCounts.map((row) => [row.projectId, row.count]),
  );
  const membersByProject = new Map(
    memberCounts.map((row) => [row.projectId, row.count]),
  );
  return rows.map((row) => ({
    ...row,
    fileCount: filesByProject.get(row.id) ?? 0,
    memberCount: membersByProject.get(row.id) ?? 0,
  }));
}

export async function createProject(
  userId: string,
  name: string,
) {
  return db.transaction(async (transaction) => {
    const [project] = await transaction
      .insert(projects)
      .values({ createdByUserId: userId, name })
      .returning();
    await transaction.insert(projectMemberships).values({
      projectId: project.id,
      userId,
      role: "admin",
    });
    return { ...project, role: "admin" as const, fileCount: 0, memberCount: 1 };
  });
}

export async function getProjectAccess(
  userId: string,
  projectId: string,
  options: Readonly<{ includeDeleted?: boolean }> = {},
) {
  const [row] = await db
    .select({
      id: projects.id,
      name: projects.name,
      role: projectMemberships.role,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      deletedAt: projects.deletedAt,
    })
    .from(projectMemberships)
    .innerJoin(projects, eq(projects.id, projectMemberships.projectId))
    .where(
      and(
        eq(projectMemberships.userId, userId),
        eq(projectMemberships.projectId, projectId),
        options.includeDeleted ? undefined : isNull(projects.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getProjectDetail(userId: string, projectId: string) {
  const project = await getProjectAccess(userId, projectId);
  if (!project) return null;

  const [members, files] = await Promise.all([
    db
      .select({
        id: projectMemberships.id,
        userId: users.id,
        displayName: users.displayName,
        email: users.email,
        role: projectMemberships.role,
        createdAt: projectMemberships.createdAt,
      })
      .from(projectMemberships)
      .innerJoin(users, eq(users.id, projectMemberships.userId))
      .where(eq(projectMemberships.projectId, projectId))
      .orderBy(asc(users.displayName), asc(users.id)),
    db
      .select({
        fileId: projectFiles.fileId,
        createdAt: projectFiles.createdAt,
      })
      .from(projectFiles)
      .innerJoin(managedFiles, eq(managedFiles.fileId, projectFiles.fileId))
      .where(
        and(
          eq(projectFiles.projectId, projectId),
          eq(managedFiles.scope, "project"),
        ),
      )
      .orderBy(desc(projectFiles.createdAt)),
  ]);
  return { ...project, members, files };
}

export async function renameProject(
  userId: string,
  projectId: string,
  name: string,
) {
  const [updated] = await db
    .update(projects)
    .set({ name, updatedAt: new Date() })
    .from(projectMemberships)
    .where(
      and(
        eq(projects.id, projectId),
        isNull(projects.deletedAt),
        eq(projectMemberships.projectId, projects.id),
        eq(projectMemberships.userId, userId),
        eq(projectMemberships.role, "admin"),
      ),
    )
    .returning();
  return updated ?? null;
}

export async function softDeleteProject(userId: string, projectId: string) {
  const now = new Date();
  const [updated] = await db
    .update(projects)
    .set({ deletedAt: now, updatedAt: now })
    .from(projectMemberships)
    .where(
      and(
        eq(projects.id, projectId),
        isNull(projects.deletedAt),
        eq(projectMemberships.projectId, projects.id),
        eq(projectMemberships.userId, userId),
        eq(projectMemberships.role, "admin"),
      ),
    )
    .returning({ id: projects.id, deletedAt: projects.deletedAt });
  return updated ?? null;
}

export async function restoreProject(userId: string, projectId: string) {
  const [updated] = await db
    .update(projects)
    .set({ deletedAt: null, updatedAt: new Date() })
    .from(projectMemberships)
    .where(
      and(
        eq(projects.id, projectId),
        isNotNull(projects.deletedAt),
        eq(projectMemberships.projectId, projects.id),
        eq(projectMemberships.userId, userId),
        eq(projectMemberships.role, "admin"),
      ),
    )
    .returning();
  return updated ?? null;
}

export async function searchMemberCandidates(
  userId: string,
  projectId: string,
  query: string,
) {
  const access = await getProjectAccess(userId, projectId);
  if (access?.role !== "admin") return null;
  const currentMembers = db
    .select({ userId: projectMemberships.userId })
    .from(projectMemberships)
    .where(eq(projectMemberships.projectId, projectId));
  return db
    .select({ id: users.id, displayName: users.displayName, email: users.email })
    .from(users)
    .where(
      and(
        ne(users.id, userId),
        sql`${users.id} not in ${currentMembers}`,
        or(ilike(users.email, `%${query}%`), ilike(users.displayName, `%${query}%`)),
      ),
    )
    .orderBy(asc(users.displayName))
    .limit(10);
}

export async function addProjectMember(
  userId: string,
  projectId: string,
  memberUserId: string,
  role: ProjectRole,
) {
  const access = await getProjectAccess(userId, projectId);
  if (access?.role !== "admin") return null;
  return db.transaction(async (transaction) => {
    const inserted = await transaction
      .insert(projectMemberships)
      .values({ projectId, userId: memberUserId, role })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) return false;
    await touchProject(transaction, projectId);
    return inserted[0];
  });
}

export async function updateProjectMemberRole(
  userId: string,
  projectId: string,
  memberUserId: string,
  role: ProjectRole,
) {
  const access = await getProjectAccess(userId, projectId);
  if (access?.role !== "admin") return null;
  return db.transaction(async (transaction) => {
    const [target] = await transaction
      .select({ role: projectMemberships.role })
      .from(projectMemberships)
      .where(
        and(
          eq(projectMemberships.projectId, projectId),
          eq(projectMemberships.userId, memberUserId),
        ),
      )
      .limit(1);
    if (!target) return false;
    if (target.role === "admin" && role === "member") {
      const [admins] = await transaction
        .select({ count: sql<number>`count(*)::int` })
        .from(projectMemberships)
        .where(
          and(
            eq(projectMemberships.projectId, projectId),
            eq(projectMemberships.role, "admin"),
          ),
        );
      if (admins.count <= 1) return "last-admin" as const;
    }
    const [updated] = await transaction
      .update(projectMemberships)
      .set({ role })
      .where(
        and(
          eq(projectMemberships.projectId, projectId),
          eq(projectMemberships.userId, memberUserId),
        ),
      )
      .returning();
    await touchProject(transaction, projectId);
    return updated;
  });
}

export async function removeProjectMember(
  userId: string,
  projectId: string,
  memberUserId: string,
) {
  const access = await getProjectAccess(userId, projectId);
  if (access?.role !== "admin") return null;
  return db.transaction(async (transaction) => {
    const [target] = await transaction
      .select({ role: projectMemberships.role })
      .from(projectMemberships)
      .where(
        and(
          eq(projectMemberships.projectId, projectId),
          eq(projectMemberships.userId, memberUserId),
        ),
      )
      .limit(1);
    if (!target) return false;
    if (target.role === "admin") {
      const [admins] = await transaction
        .select({ count: sql<number>`count(*)::int` })
        .from(projectMemberships)
        .where(
          and(
            eq(projectMemberships.projectId, projectId),
            eq(projectMemberships.role, "admin"),
          ),
        );
      if (admins.count <= 1) return "last-admin" as const;
    }
    await transaction
      .delete(projectMemberships)
      .where(
        and(
          eq(projectMemberships.projectId, projectId),
          eq(projectMemberships.userId, memberUserId),
        ),
      );
    await touchProject(transaction, projectId);
    return true;
  });
}

export async function addProjectFiles(
  userId: string,
  projectId: string,
  fileIds: readonly string[],
) {
  const access = await getProjectAccess(userId, projectId);
  if (access?.role !== "admin") return null;
  if (fileIds.length === 0) return [];
  const userRole = await getUserRole(userId);
  const eligibleRows = await db
    .select({ fileId: managedFiles.fileId })
    .from(managedFiles)
    .where(
      and(
        inArray(managedFiles.fileId, [...fileIds]),
        eq(managedFiles.scope, "project"),
        userRole === "admin"
          ? sql`true`
          : eq(managedFiles.createdByUserId, userId),
      ),
    );
  if (
    new Set(eligibleRows.map((row) => row.fileId)).size !==
    new Set(fileIds).size
  ) {
    return false;
  }
  return db.transaction(async (transaction) => {
    const inserted = await transaction
      .insert(projectFiles)
      .values(fileIds.map((fileId) => ({ projectId, fileId, addedByUserId: userId })))
      .onConflictDoNothing()
      .returning();
    if (inserted.length > 0) await touchProject(transaction, projectId);
    return inserted;
  });
}

export async function removeProjectFile(
  userId: string,
  projectId: string,
  fileId: string,
) {
  const access = await getProjectAccess(userId, projectId);
  if (access?.role !== "admin") return null;
  return db.transaction(async (transaction) => {
    const removed = await transaction
      .delete(projectFiles)
      .where(
        and(eq(projectFiles.projectId, projectId), eq(projectFiles.fileId, fileId)),
      )
      .returning({ id: projectFiles.id });
    if (removed.length > 0) await touchProject(transaction, projectId);
    return removed.length > 0;
  });
}

export async function getProjectFileIdsForMember(
  userId: string,
  projectId: string,
) {
  const access = await getProjectAccess(userId, projectId);
  if (!access) return null;
  const rows = await db
    .select({ fileId: projectFiles.fileId })
    .from(projectFiles)
    .innerJoin(managedFiles, eq(managedFiles.fileId, projectFiles.fileId))
    .where(
      and(
        eq(projectFiles.projectId, projectId),
        eq(managedFiles.scope, "project"),
      ),
    );
  return rows.map((row) => row.fileId);
}

export async function listFileProjectAssignments(
  userId: string,
  fileIds: readonly string[],
) {
  if (fileIds.length === 0) return [];
  return db
    .select({
      fileId: projectFiles.fileId,
      projectId: projects.id,
      projectName: projects.name,
      role: projectMemberships.role,
    })
    .from(projectFiles)
    .innerJoin(managedFiles, eq(managedFiles.fileId, projectFiles.fileId))
    .innerJoin(projects, eq(projects.id, projectFiles.projectId))
    .innerJoin(
      projectMemberships,
      and(
        eq(projectMemberships.projectId, projects.id),
        eq(projectMemberships.userId, userId),
      ),
    )
    .where(
      and(
        inArray(projectFiles.fileId, [...fileIds]),
        eq(managedFiles.scope, "project"),
        isNull(projects.deletedAt),
      ),
    );
}

export async function removeFileAssignments(fileId: string): Promise<void> {
  await db.delete(projectFiles).where(eq(projectFiles.fileId, fileId));
}