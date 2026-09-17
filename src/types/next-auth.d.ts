import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      /** Local `users.id`. Role and account status are read from the database per request. */
      id: string;
    };
  }
}
