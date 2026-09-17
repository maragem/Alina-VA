import { NextRequest } from "next/server";
import {
  createUserAsAdmin,
  listUsersForAdmin,
} from "@/db/repositories/users";
import {
  normalizeDisplayName,
  normalizeEmailInput,
  serializeAdminUser,
} from "@/lib/adminUsers";
import { readJsonRecord } from "@/lib/apiParsing";
import { requireAdminUser } from "@/lib/currentUser";
import {
  generateTemporaryPassword,
  passwordPolicyError,
} from "@/lib/password";
import { isUserRole } from "@/lib/roles";

export async function GET(): Promise<Response> {
  const admin = await requireAdminUser();
  if (admin instanceof Response) return admin;

  const users = await listUsersForAdmin(admin.id);
  if (users === null) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

  return Response.json({ users: users.map(serializeAdminUser) });
}

export async function POST(request: NextRequest): Promise<Response> {
  const admin = await requireAdminUser();
  if (admin instanceof Response) return admin;

  const body = await readJsonRecord(request);
  if (body instanceof Response) return body;

  const email = normalizeEmailInput(body.email);
  const displayName = normalizeDisplayName(body.displayName);
  const role = isUserRole(body.role) ? body.role : "member";
  if (!email || !displayName) {
    return Response.json(
      { error: "A valid email address and display name are required." },
      { status: 400 },
    );
  }

  const temporaryPassword =
    typeof body.temporaryPassword === "string" && body.temporaryPassword
      ? body.temporaryPassword
      : generateTemporaryPassword();
  const policyError = passwordPolicyError(temporaryPassword);
  if (policyError) return Response.json({ error: policyError }, { status: 400 });

  const created = await createUserAsAdmin(admin.id, {
    email,
    displayName,
    role,
    temporaryPassword,
  });
  if (created === null) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }
  if (created === "email-taken") {
    return Response.json(
      { error: "A user with this email address already exists." },
      { status: 409 },
    );
  }

  // The temporary password is returned once so the administrator can hand it over.
  return Response.json(
    { user: serializeAdminUser(created), temporaryPassword },
    { status: 201 },
  );
}
