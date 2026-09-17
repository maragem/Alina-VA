import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      isCognitoAdmin: boolean;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    cognitoSubject?: string;
    cognitoGroups?: string[];
    isCognitoAdmin?: boolean;
  }
}