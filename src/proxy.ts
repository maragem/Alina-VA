import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const proxy = auth((request) => {
  if (request.auth?.user?.id) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.nextUrl.origin);
  return NextResponse.redirect(loginUrl);
});

export const config = {
  matcher: [
    "/((?!api/auth|api/health|login|_next/static|_next/image|favicon.ico|icon.svg).*)",
  ],
};