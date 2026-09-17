import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db/client";
import { externalIdentities, users } from "@/db/schema";

const COGNITO_PROVIDER = "cognito";

export type AppUser = Readonly<{
  id: string;
  displayName: string;
  email: string | null;
  role: "admin" | "member";
}>;

export async function requireAppUser(): Promise<AppUser | Response> {
  const session = await auth();
  const providerSubject = session?.user?.id;
  if (!providerSubject) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const isCognitoAdmin = session.user.isCognitoAdmin;
  const email = session.user.email?.trim() || null;
  const displayName = session.user.name?.trim() || email || "ALINA user";
  const initialRole: AppUser["role"] = isCognitoAdmin ? "admin" : "member";

  return db.transaction(async (transaction) => {
    const [existing] = await transaction
      .select({ id: users.id, role: users.role })
      .from(externalIdentities)
      .innerJoin(users, eq(users.id, externalIdentities.userId))
      .where(
        and(
          eq(externalIdentities.provider, COGNITO_PROVIDER),
          eq(externalIdentities.providerSubject, providerSubject),
        ),
      )
      .limit(1);

    if (existing) {
      const [updated] = await transaction
        .update(users)
        .set({ displayName, email, updatedAt: new Date() })
        .where(eq(users.id, existing.id))
        .returning({ id: users.id, role: users.role });
      return { id: updated.id, displayName, email, role: updated.role };
    }

    const [candidate] = await transaction
      .insert(users)
      .values({ displayName, email, role: initialRole })
      .returning({ id: users.id, role: users.role });
    const [identity] = await transaction
      .insert(externalIdentities)
      .values({
        userId: candidate.id,
        provider: COGNITO_PROVIDER,
        providerSubject,
      })
      .onConflictDoNothing({
        target: [
          externalIdentities.provider,
          externalIdentities.providerSubject,
        ],
      })
      .returning({ userId: externalIdentities.userId });

    if (identity) {
      return {
        id: candidate.id,
        displayName,
        email,
        role: candidate.role,
      };
    }

    await transaction.delete(users).where(eq(users.id, candidate.id));
    const [winner] = await transaction
      .select({ id: externalIdentities.userId })
      .from(externalIdentities)
      .where(
        and(
          eq(externalIdentities.provider, COGNITO_PROVIDER),
          eq(externalIdentities.providerSubject, providerSubject),
        ),
      )
      .limit(1);

    if (!winner) throw new Error("Could not resolve the authenticated user.");
    await transaction
      .update(users)
      .set({ displayName, email, updatedAt: new Date() })
      .where(eq(users.id, winner.id));
    const [resolved] = await transaction
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, winner.id))
      .limit(1);
    if (!resolved) throw new Error("Could not resolve authenticated user role.");
    return { id: winner.id, displayName, email, role: resolved.role };
  });
}