import type { UserRole } from "@/lib/roles";

/** Wire format of a user row on the admin API, shared by server and client. */
export type AdminUserView = Readonly<{
  id: string;
  displayName: string;
  email: string | null;
  role: UserRole;
  hasPassword: boolean;
  mustChangePassword: boolean;
  disabledAt: string | null;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export const DISPLAY_NAME_MAX_LENGTH = 100;
export const EMAIL_MAX_LENGTH = 254;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name && name.length <= DISPLAY_NAME_MAX_LENGTH ? name : null;
}

export function normalizeEmailInput(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email && email.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(email)
    ? email
    : null;
}

export function serializeAdminUser<
  T extends {
    disabledAt: Date | null;
    lockedUntil: Date | null;
    lastLoginAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  },
>(user: T): Omit<T, "disabledAt" | "lockedUntil" | "lastLoginAt" | "createdAt" | "updatedAt"> & {
  disabledAt: string | null;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
} {
  return {
    ...user,
    disabledAt: user.disabledAt?.toISOString() ?? null,
    lockedUntil: user.lockedUntil?.toISOString() ?? null,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
