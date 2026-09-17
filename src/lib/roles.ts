export type UserRole = "admin" | "member";

export function isUserRole(value: unknown): value is UserRole {
  return value === "admin" || value === "member";
}
