import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

// Provider-free instance: it only verifies the session cookie. Password checks,
// account status, and the forced password change are enforced per request in
// `requireAppUser` / `AppShell`, which have database access.
const { auth } = NextAuth(authConfig);

export const proxy = auth((request) => {
  if (request.auth?.user?.id) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.nextUrl.origin);
  return NextResponse.redirect(loginUrl);
});

// `api/mcp` authenticates itself (bearer token for the pipeline, or a session).
export const config = {
  matcher: [
    "/((?!api/auth|api/health|api/mcp|login|_next/static|_next/image|favicon.ico|icon.svg).*)",
  ],
};
