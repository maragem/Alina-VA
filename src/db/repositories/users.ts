import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/password";
import type { UserRole } from "@/lib/roles";

export type AdminUserRow = Readonly<{
  id: string;
  displayName: string;
  email: string | null;
  role: UserRole;
  hasPassword: boolean;
  mustChangePassword: boolean;
  disabledAt: Date | null;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

const adminUserColumns = {
  id: users.id,
  displayName: users.displayName,
  email: users.email,
  role: users.role,
  hasPassword: sql<boolean>`${users.passwordHash} is not null`,
  mustChangePassword: users.mustChangePassword,
  disabledAt: users.disabledAt,
  lockedUntil: users.lockedUntil,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function isActiveAdmin(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ role: users.role, disabledAt: users.disabledAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.role === "admin" && row.disabledAt === null;
}

/** Active administrators other than `excludingUserId`. */
async function otherActiveAdminCount(
  transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  excludingUserId: string,
): Promise<number> {
  const [row] = await transaction
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(
      and(
        eq(users.role, "admin"),
        isNull(users.disabledAt),
        ne(users.id, excludingUserId),
      ),
    );
  return row?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Login path (used by src/auth.ts)
// ---------------------------------------------------------------------------

export async function findUserForLogin(email: string) {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      passwordHash: users.passwordHash,
      disabledAt: users.disabledAt,
      lockedUntil: users.lockedUntil,
    })
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizeEmail(email)}`)
    .limit(1);
  return row ?? null;
}

/** Increments the failure counter; returns true when the account is now locked. */
export async function recordFailedLogin(
  userId: string,
  options: Readonly<{ maxAttempts: number; lockoutMinutes: number }>,
): Promise<boolean> {
  const [updated] = await db
    .update(users)
    .set({
      failedLoginAttempts: sql`${users.failedLoginAttempts} + 1`,
      lockedUntil: sql`case
        when ${users.failedLoginAttempts} + 1 >= ${options.maxAttempts}
        then now() + make_interval(mins => ${options.lockoutMinutes})
        else ${users.lockedUntil}
      end`,
    })
    .where(eq(users.id, userId))
    .returning({ lockedUntil: users.lockedUntil });
  return Boolean(updated?.lockedUntil && updated.lockedUntil.getTime() > Date.now());
}

export async function recordSuccessfulLogin(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(users.id, userId));
}

// ---------------------------------------------------------------------------
// Current user
// ---------------------------------------------------------------------------

export async function getUserById(userId: string) {
  const [row] = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      role: users.role,
      mustChangePassword: users.mustChangePassword,
      disabledAt: users.disabledAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<"invalid-current" | "not-found" | true> {
  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return "not-found";
  // An account whose password was never set (legacy row) has nothing to verify.
  if (row.passwordHash && !(await verifyPassword(currentPassword, row.passwordHash))) {
    return "invalid-current";
  }
  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
  return true;
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

export async function countAdmins(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.role, "admin"));
  return row?.count ?? 0;
}

/** Bootstrap helper: creates an admin account unless the email is already taken. */
export async function createAdminIfMissing(input: {
  email: string;
  displayName: string;
  password: string;
}): Promise<"created" | "exists"> {
  try {
    await db.insert(users).values({
      email: normalizeEmail(input.email),
      displayName: input.displayName,
      role: "admin",
      passwordHash: await hashPassword(input.password),
      mustChangePassword: true,
    });
    return "created";
  } catch (error) {
    // The unique index is on lower(email), which Drizzle cannot express as a conflict target.
    if (isUniqueViolation(error)) return "exists";
    throw error;
  }
}

export async function listUsersForAdmin(
  requesterId: string,
): Promise<AdminUserRow[] | null> {
  if (!(await isActiveAdmin(requesterId))) return null;
  return db.select(adminUserColumns).from(users).orderBy(users.displayName, users.id);
}

export async function createUserAsAdmin(
  requesterId: string,
  input: {
    email: string;
    displayName: string;
    role: UserRole;
    temporaryPassword: string;
  },
): Promise<null | "email-taken" | AdminUserRow> {
  if (!(await isActiveAdmin(requesterId))) return null;
  try {
    const [inserted] = await db
      .insert(users)
      .values({
        email: normalizeEmail(input.email),
        displayName: input.displayName,
        role: input.role,
        passwordHash: await hashPassword(input.temporaryPassword),
        mustChangePassword: true,
      })
      .returning(adminUserColumns);
    return inserted;
  } catch (error) {
    if (isUniqueViolation(error)) return "email-taken";
    throw error;
  }
}

/**
 * Issues a temporary password (the user must change it at next sign-in) and clears
 * any lockout. Also used to give legacy accounts their first password; an optional
 * email fixes rows that were created without one.
 */
export async function setTemporaryPasswordAsAdmin(
  requesterId: string,
  targetUserId: string,
  input: { temporaryPassword: string; email?: string },
): Promise<null | false | "email-required" | "email-taken" | AdminUserRow> {
  if (!(await isActiveAdmin(requesterId))) return null;
  const [target] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);
  if (!target) return false;
  // A password is useless without a login identifier.
  if (!target.email && !input.email) return "email-required";
  try {
    const [updated] = await db
      .update(users)
      .set({
        passwordHash: await hashPassword(input.temporaryPassword),
        mustChangePassword: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
        updatedAt: new Date(),
        ...(input.email ? { email: normalizeEmail(input.email) } : {}),
      })
      .where(eq(users.id, targetUserId))
      .returning(adminUserColumns);
    return updated ?? false;
  } catch (error) {
    if (isUniqueViolation(error)) return "email-taken";
    throw error;
  }
}

export async function setUserDisabledAsAdmin(
  requesterId: string,
  targetUserId: string,
  disabled: boolean,
): Promise<null | false | "self" | "last-admin" | AdminUserRow> {
  if (!(await isActiveAdmin(requesterId))) return null;
  if (disabled && requesterId === targetUserId) return "self";
  return db.transaction(async (transaction) => {
    const [target] = await transaction
      .select({ role: users.role, disabledAt: users.disabledAt })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);
    if (!target) return false;
    if (
      disabled &&
      target.role === "admin" &&
      target.disabledAt === null &&
      (await otherActiveAdminCount(transaction, targetUserId)) === 0
    ) {
      return "last-admin";
    }
    const [updated] = await transaction
      .update(users)
      .set({
        disabledAt: disabled ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, targetUserId))
      .returning(adminUserColumns);
    return updated ?? false;
  });
}

export async function updateUserRoleAsAdmin(
  requesterId: string,
  targetUserId: string,
  nextRole: UserRole,
): Promise<null | false | "last-admin" | AdminUserRow> {
  if (!(await isActiveAdmin(requesterId))) return null;

  return db.transaction(async (transaction) => {
    const [target] = await transaction
      .select({ id: users.id, role: users.role, disabledAt: users.disabledAt })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);
    if (!target) return false;

    if (
      target.role === "admin" &&
      nextRole === "member" &&
      target.disabledAt === null &&
      (await otherActiveAdminCount(transaction, targetUserId)) === 0
    ) {
      return "last-admin";
    }

    const [updated] = await transaction
      .update(users)
      .set({ role: nextRole, updatedAt: new Date() })
      .where(and(eq(users.id, targetUserId), eq(users.role, target.role)))
      .returning(adminUserColumns);

    return updated ?? false;
  });
}

/** Postgres unique_violation (23505); Drizzle wraps the driver error, so walk `cause`. */
function isUniqueViolation(error: unknown): boolean {
  for (let depth = 0, current = error; depth < 5 && current; depth += 1) {
    if (typeof current !== "object") return false;
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
