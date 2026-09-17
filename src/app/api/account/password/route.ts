import { NextRequest } from "next/server";
import { changeOwnPassword } from "@/db/repositories/users";
import { readJsonRecord } from "@/lib/apiParsing";
import { requireAppUser } from "@/lib/currentUser";
import { passwordPolicyError } from "@/lib/password";

export async function POST(request: NextRequest): Promise<Response> {
  const user = await requireAppUser({ allowPendingPasswordChange: true });
  if (user instanceof Response) return user;

  const body = await readJsonRecord(request);
  if (body instanceof Response) return body;

  const currentPassword =
    typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  const policyError = passwordPolicyError(newPassword);
  if (policyError) return Response.json({ error: policyError }, { status: 400 });
  if (newPassword === currentPassword) {
    return Response.json(
      { error: "The new password must differ from the current one." },
      { status: 400 },
    );
  }

  const result = await changeOwnPassword(user.id, currentPassword, newPassword);
  if (result === "not-found") {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (result === "invalid-current") {
    return Response.json(
      { error: "The current password is incorrect." },
      { status: 400 },
    );
  }
  return Response.json({ changed: true });
}
