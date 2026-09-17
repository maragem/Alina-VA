import {
  listUsersForAdmin,
} from "@/db/repositories/users";
import { requireAppUser } from "@/lib/currentUser";

function serializeUser<T extends { createdAt: Date; updatedAt: Date }>(user: T) {
  return {
    ...user,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export async function GET(): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;

  const users = await listUsersForAdmin(user.id);
  if (users === null) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

  return Response.json({ users: users.map(serializeUser) });
}
