import { auth } from "@/auth";
import { getUserById } from "@/db/repositories/users";

export type AppUser = Readonly<{
  id: string;
  displayName: string;
  email: string | null;
  role: "admin" | "member";
  mustChangePassword: boolean;
}>;

/**
 * Resolves the signed-in user from the session cookie and the database.
 * Returns null when there is no session, the account no longer exists, or it
 * has been disabled since the cookie was issued.
 */
export async function getCurrentUser(): Promise<AppUser | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const user = await getUserById(userId);
  if (!user || user.disabledAt) return null;
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  };
}

type RequireAppUserOptions = Readonly<{
  /** Allow the request even while a password change is pending (the change-password route). */
  allowPendingPasswordChange?: boolean;
}>;

export async function requireAppUser(
  options: RequireAppUserOptions = {},
): Promise<AppUser | Response> {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (user.mustChangePassword && !options.allowPendingPasswordChange) {
    return Response.json(
      {
        error: "You must change your password before continuing.",
        code: "password_change_required",
      },
      { status: 403 },
    );
  }
  return user;
}

export async function requireAdminUser(): Promise<AppUser | Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;
  if (user.role !== "admin") {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }
  return user;
}
