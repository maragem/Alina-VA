import { NextRequest } from "next/server";
import { setTemporaryPasswordAsAdmin } from "@/db/repositories/users";
import { normalizeEmailInput, serializeAdminUser } from "@/lib/adminUsers";
import { readJsonRecord } from "@/lib/apiParsing";
import { isUuid } from "@/lib/conversations";
import { requireAdminUser } from "@/lib/currentUser";
import {
  generateTemporaryPassword,
  passwordPolicyError,
} from "@/lib/password";

/**
 * Issues a temporary password. The user must change it at the next sign-in.
 * Also unlocks the account and, optionally, sets an email on a legacy row that has none.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/admin/users/[userId]/password">,
): Promise<Response> {
  const admin = await requireAdminUser();
  if (admin instanceof Response) return admin;

  const body = await readJsonRecord(request);
  if (body instanceof Response) return body;

  const temporaryPassword =
    typeof body.temporaryPassword === "string" && body.temporaryPassword
      ? body.temporaryPassword
      : generateTemporaryPassword();
  const policyError = passwordPolicyError(temporaryPassword);
  if (policyError) return Response.json({ error: policyError }, { status: 400 });

  let email: string | undefined;
  if (body.email !== undefined && body.email !== null && body.email !== "") {
    const normalized = normalizeEmailInput(body.email);
    if (!normalized) {
      return Response.json({ error: "The email address is invalid." }, { status: 400 });
    }
    email = normalized;
  }

  const { userId } = await context.params;
  if (!isUuid(userId)) {
    return Response.json({ error: "User not found." }, { status: 404 });
  }
  const updated = await setTemporaryPasswordAsAdmin(admin.id, userId, {
    temporaryPassword,
    email,
  });
  if (updated === null) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }
  if (updated === false) {
    return Response.json({ error: "User not found." }, { status: 404 });
  }
  if (updated === "email-required") {
    return Response.json(
      { error: "This account has no email address. Provide one so the user can sign in." },
      { status: 400 },
    );
  }
  if (updated === "email-taken") {
    return Response.json(
      { error: "A user with this email address already exists." },
      { status: 409 },
    );
  }

  return Response.json({ user: serializeAdminUser(updated), temporaryPassword });
}
