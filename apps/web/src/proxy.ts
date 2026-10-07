import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const APP_HOSTS = new Set(
  [process.env.NEXT_PUBLIC_APP_URL, process.env.BETTER_AUTH_URL, "http://localhost:3001", "http://localhost:3000"]
    .filter((u): u is string => !!u)
    .map((u) => u.replace(/^https?:\/\//, "").replace(/\/.*$/, "")),
);

/**
 * 1. Custom booking domains: a request whose host is not the app host is
 *    rewritten to /book/_host/<host>/... and resolved to the business there.
 * 2. Cheap optimistic redirect for signed-out visitors on protected paths.
 */
export function proxy(request: NextRequest) {
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").toLowerCase().split(":")[0]!;
  const { pathname } = request.nextUrl;
  const isAppHost = !host || APP_HOSTS.has(host) || [...APP_HOSTS].some((h) => h.split(":")[0] === host);
  if (!isAppHost && !pathname.startsWith("/book/") && !pathname.startsWith("/api/") && !pathname.startsWith("/_next/")) {
    const url = request.nextUrl.clone();
    url.pathname = `/book/_host/${host}${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url);
  }
  const cookie = getSessionCookie(request);
  const protectedPath = pathname.startsWith("/app") || pathname.startsWith("/onboarding");
  if (protectedPath && !cookie) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if ((pathname === "/sign-in" || pathname === "/sign-up") && cookie) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  // Expose the pathname to server layouts (used for tab highlighting).
  const reqHeaders = new Headers(request.headers);
  reqHeaders.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers: reqHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
