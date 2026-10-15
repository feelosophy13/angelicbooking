import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, verifyToken } from "@/lib/session";

export function proxy(req: NextRequest) {
  // Reachable signed out: the login page, the password-reset pages and the Google sign-in round trip.
  const path = req.nextUrl.pathname;
  if (path === "/login" || path === "/forgot-password" || path === "/reset-password" || path.startsWith("/auth/google")) return NextResponse.next();
  if (verifyToken(req.cookies.get(COOKIE)?.value)) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
