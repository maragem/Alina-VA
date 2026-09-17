import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import type { UserRole } from "@/lib/roles";

async function isAdmin(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.role === "admin";
}

export async function listUsersForAdmin(requesterId: string) {
  const requesterIsAdmin = await isAdmin(requesterId);
  if (!requesterIsAdmin) return null;

  return db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .orderBy(users.displayName, users.id);
}

export async function updateUserRoleAsAdmin(
  requesterId: string,
  targetUserId: string,
  nextRole: UserRole,
): Promise<
  | null
  | false
  | "last-admin"
  | {
      id: string;
      displayName: string;
      email: string | null;
      role: UserRole;
      createdAt: Date;
      updatedAt: Date;
    }
> {
  const requesterIsAdmin = await isAdmin(requesterId);
  if (!requesterIsAdmin) return null;

  return db.transaction(async (transaction) => {
    const [target] = await transaction
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);
    if (!target) return false;

    if (target.role === "admin" && nextRole === "member") {
      const [admins] = await transaction
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(eq(users.role, "admin"));
      if (admins.count <= 1) return "last-admin";
    }

    const [updated] = await transaction
      .update(users)
      .set({ role: nextRole, updatedAt: new Date() })
      .where(
        and(
          eq(users.id, targetUserId),
          eq(users.role, target.role),
        ),
      )
      .returning({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      });

    return updated ?? false;
  });
}
