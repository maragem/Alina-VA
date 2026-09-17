import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import {
  findUserForLogin,
  recordFailedLogin,
  recordSuccessfulLogin,
} from "@/db/repositories/users";
import { verifyPassword } from "@/lib/password";

export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

/** Surfaced to the login page through the `code` query parameter. */
export type LoginErrorCode = "invalid" | "locked" | "disabled";

class LoginError extends CredentialsSignin {
  constructor(readonly code: LoginErrorCode) {
    super();
  }
}

function credentialText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentialText(credentials?.email).trim().toLowerCase();
        const password = credentialText(credentials?.password);
        if (!email || !password) throw new LoginError("invalid");

        const user = await findUserForLogin(email);
        // Run the hash even for unknown accounts so timing does not reveal existence.
        const passwordMatches = await verifyPassword(
          password,
          user?.passwordHash ?? null,
        );
        if (!user) throw new LoginError("invalid");
        if (user.disabledAt) throw new LoginError("disabled");
        if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
          throw new LoginError("locked");
        }
        if (!passwordMatches) {
          const locked = await recordFailedLogin(user.id, {
            maxAttempts: MAX_FAILED_LOGIN_ATTEMPTS,
            lockoutMinutes: LOCKOUT_MINUTES,
          });
          throw new LoginError(locked ? "locked" : "invalid");
        }

        await recordSuccessfulLogin(user.id);
        return { id: user.id, email: user.email, name: user.displayName };
      },
    }),
  ],
});
