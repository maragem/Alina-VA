import type { NextAuthConfig } from "next-auth";

const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

/**
 * Provider-free configuration shared by the request proxy and the full
 * `NextAuth` instance in `src/auth.ts`. It only needs to decode the JWT
 * session cookie, so it must not import the database or the password library.
 */
export const authConfig = {
  providers: [],
  // Every deployment target (ECS behind an ALB, Railway) terminates TLS in front of
  // the container, so the forwarded host is the only host there is. Set AUTH_URL to
  // the public URL to pin it explicitly.
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  callbacks: {
    redirect({ url, baseUrl }) {
      const targetUrl = new URL(url, baseUrl);
      return targetUrl.origin === baseUrl ? targetUrl.toString() : baseUrl;
    },
    jwt({ token, user }) {
      // `user` is only present on sign-in; `authorize` returns the local users.id.
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (typeof token.sub === "string") session.user.id = token.sub;
      return session;
    },
  },
} satisfies NextAuthConfig;
