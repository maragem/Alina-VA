import NextAuth from "next-auth";
import Cognito from "next-auth/providers/cognito";
import { isAllowedCognitoLogoutUrl } from "@/lib/cognitoLogout";

const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
const COGNITO_ADMIN_GROUP = process.env.COGNITO_ADMIN_GROUP?.trim() || "Admins";

type CognitoProfile = Readonly<Record<string, unknown>>;
type JwtLikePayload = Readonly<Record<string, unknown>>;

function getCognitoGroups(profile: CognitoProfile): string[] {
  const raw = profile["cognito:groups"];
  if (Array.isArray(raw)) {
    return raw
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return [];
}

function decodeJwtPayload(tokenValue: string): JwtLikePayload | null {
  const parts = tokenValue.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as unknown;
    if (
      payload !== null &&
      typeof payload === "object" &&
      !Array.isArray(payload)
    ) {
      return payload as JwtLikePayload;
    }
    return null;
  } catch {
    return null;
  }
}

function getGroupsFromPayload(payload: JwtLikePayload | null): string[] {
  if (!payload) return [];
  const cognitoGroups = payload["cognito:groups"];
  if (Array.isArray(cognitoGroups)) {
    return cognitoGroups
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  if (typeof cognitoGroups === "string") {
    return cognitoGroups
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  const groups = payload.groups;
  if (Array.isArray(groups)) {
    return groups
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  if (typeof groups === "string") {
    return groups
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return [];
}

function uniqueGroups(groups: readonly string[]): string[] {
  return [...new Set(groups.filter(Boolean))];
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  providers: [Cognito],
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  callbacks: {
    redirect({ url, baseUrl }) {
      if (isAllowedCognitoLogoutUrl(url)) return url;

      const targetUrl = new URL(url, baseUrl);
      return targetUrl.origin === baseUrl ? targetUrl.toString() : baseUrl;
    },
    jwt({ token, profile, account }) {
      if (typeof profile?.sub === "string") {
        token.cognitoSubject = profile.sub;
      }

      const hasFreshClaims =
        Boolean(profile) ||
        typeof account?.id_token === "string" ||
        typeof account?.access_token === "string";

      if (hasFreshClaims) {
        const idTokenGroups = getGroupsFromPayload(
          typeof account?.id_token === "string"
            ? decodeJwtPayload(account.id_token)
            : null,
        );
        const accessTokenGroups = getGroupsFromPayload(
          typeof account?.access_token === "string"
            ? decodeJwtPayload(account.access_token)
            : null,
        );

        const profileGroups = profile
          ? getCognitoGroups(profile as CognitoProfile)
          : [];

        const cognitoGroups = uniqueGroups([
          ...profileGroups,
          ...idTokenGroups,
          ...accessTokenGroups,
        ]);
        token.cognitoGroups = cognitoGroups;
        token.isCognitoAdmin = cognitoGroups.some(
          (group) =>
            group.localeCompare(COGNITO_ADMIN_GROUP, undefined, {
              sensitivity: "accent",
            }) === 0,
        );
      }

      if (profile) {
        const given = typeof profile.given_name === "string" ? profile.given_name.trim() : "";
        const family = typeof profile.family_name === "string" ? profile.family_name.trim() : "";
        const full = [given, family].filter(Boolean).join(" ");
        if (full) token.name = full;
      }
      return token;
    },
    session({ session, token }) {
      const userId =
        typeof token.cognitoSubject === "string"
          ? token.cognitoSubject
          : token.sub;
      if (typeof userId === "string") session.user.id = userId;
      session.user.isCognitoAdmin = token.isCognitoAdmin === true;
      return session;
    },
  },
});