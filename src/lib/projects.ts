import { isUuid } from "@/lib/conversations";

export const PROJECT_NAME_MAX_LENGTH = 100;
export const PROJECT_MEMBER_QUERY_MAX_LENGTH = 200;

export type ProjectRole = "admin" | "member";

export function normalizeProjectName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name && name.length <= PROJECT_NAME_MAX_LENGTH ? name : null;
}

export function normalizeMemberQuery(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const query = value.trim();
  return query && query.length <= PROJECT_MEMBER_QUERY_MAX_LENGTH
    ? query
    : null;
}

export function isProjectRole(value: unknown): value is ProjectRole {
  return value === "admin" || value === "member";
}

export function normalizeFileIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const fileIds = value.filter((item): item is string => isUuid(item));
  if (fileIds.length !== value.length) return null;
  return [...new Set(fileIds)];
}