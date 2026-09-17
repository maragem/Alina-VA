import { NextRequest } from "next/server";
import { setUserDisabledAsAdmin } from "@/db/repositories/users";
import { serializeAdminUser } from "@/lib/adminUsers";
import { readJsonRecord } from "@/lib/apiParsing";
import { isUuid } from "@/lib/conversations";
import { requireAdminUser } from "@/lib/currentUser";

/** Enables or disables an account. Disabled accounts cannot sign in and lose any active session. */
export async function PATCH(
  request: NextRequest,
  context: RouteContext<"/api/admin/users/[userId]">,
): Promise<Response> {
  const admin = await requireAdminUser();
  if (admin instanceof Response) return admin;

  const body = await readJsonRecord(request);
  if (body instanceof Response) return body;
  if (typeof body.disabled !== "boolean") {
    return Response.json(
      { error: "disabled must be true or false." },
      { status: 400 },
    );
  }

  const { userId } = await context.params;
  if (!isUuid(userId)) {
    return Response.json({ error: "User not found." }, { status: 404 });
  }
  const updated = await setUserDisabledAsAdmin(admin.id, userId, body.disabled);
  if (updated === null) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }
  if (updated === false) {
    return Response.json({ error: "User not found." }, { status: 404 });
  }
  if (updated === "self") {
    return Response.json(
      { error: "You cannot disable your own account." },
      { status: 409 },
    );
  }
  if (updated === "last-admin") {
    return Response.json(
      { error: "At least one active admin must remain." },
      { status: 409 },
    );
  }

  return Response.json({ user: serializeAdminUser(updated) });
}
