import { NextRequest } from "next/server";
import { updateUserRoleAsAdmin } from "@/db/repositories/users";
import { requireAppUser } from "@/lib/currentUser";
import { isUserRole } from "@/lib/roles";

export async function PATCH(
  request: NextRequest,
  context: RouteContext<"/api/admin/users/[userId]/role">,
): Promise<Response> {
  const user = await requireAppUser();
  if (user instanceof Response) return user;

  const body = (await request.json().catch(() => null)) as { role?: unknown } | null;
  if (!isUserRole(body?.role)) {
    return Response.json(
      { error: "A valid role is required." },
      { status: 400 },
    );
  }

  const { userId } = await context.params;
  const updated = await updateUserRoleAsAdmin(user.id, userId, body.role);
  if (updated === null) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }
  if (updated === false) {
    return Response.json({ error: "User not found." }, { status: 404 });
  }
  if (updated === "last-admin") {
    return Response.json(
      { error: "At least one admin must remain." },
      { status: 409 },
    );
  }

  return Response.json({
    user: {
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
}
