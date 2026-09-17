import { apiError } from "@/lib/apiError";

export type ProjectRole = "admin" | "member";

export type ProjectSummary = Readonly<{
  id: string;
  name: string;
  role: ProjectRole;
  fileCount: number;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}>;

export type ProjectMember = Readonly<{
  id: string;
  userId: string;
  displayName: string;
  email: string | null;
  role: ProjectRole;
  createdAt: string;
}>;

export async function projectApiError(response: Response, fallback: string): Promise<Error> {
  return apiError(response, fallback);
}