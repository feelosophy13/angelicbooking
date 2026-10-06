import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Cheap optimistic redirect for signed-out visitors. Real authorization happens
// server-side in requireSession / requireBusiness.
export function proxy(request: NextRequest) {
  const cookie = getSessionCookie(request);
  const { pathname } = request.nextUrl;
  const protectedPath = pathname.startsWith("/app") || pathname.startsWith("/onboarding");
  if (protectedPath && !cookie) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if ((pathname === "/sign-in" || pathname === "/sign-up") && cookie) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/onboarding", "/sign-in", "/sign-up"],
};
