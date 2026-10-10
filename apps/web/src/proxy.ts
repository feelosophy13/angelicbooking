import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const APP_HOSTS = new Set(
  [process.env.NEXT_PUBLIC_APP_URL, process.env.BETTER_AUTH_URL, "http://localhost:3001", "http://localhost:3000"]
    .filter((u): u is string => !!u)
    .map((u) => u.replace(/^https?:\/\//, "").replace(/\/.*$/, "")),
);

const APP_HOST = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
// When the app lives on app.<domain>, send the bare domain and www there until a
// marketing site exists (otherwise they'd be treated as tenant booking domains).
const ROOT_REDIRECT_HOSTS = new Set(APP_HOST.startsWith("app.") ? [APP_HOST.slice(4), `www.${APP_HOST.slice(4)}`] : []);

/**
 * 1. Root domain → app subdomain redirect (see ROOT_REDIRECT_HOSTS).
 * 2. Custom booking domains: a request whose host is not the app host is
 *    rewritten to /book/_host/<host>/... and resolved to the business there.
 * 3. Cheap optimistic redirect for signed-out visitors on protected paths.
 */
export function proxy(request: NextRequest) {
  // Rate limits: sign-in/up and other auth endpoints, public booking submits, webhook/jobs.
  if (request.method === "POST") {
    const ip = clientIp(request);
    const path = request.nextUrl.pathname;
    const rule = path.startsWith("/api/auth/") ? { limit: 20, windowMs: 60_000 } : path.startsWith("/book/") ? { limit: 30, windowMs: 60_000 } : path.startsWith("/api/") ? { limit: 120, windowMs: 60_000 } : null;
    if (rule) {
      const r = rateLimit(`${path.split("/").slice(0, 3).join("/")}:${ip}`, rule.limit, rule.windowMs);
      if (!r.ok) return new NextResponse("Too many requests. Please wait a moment and try again.", { status: 429, headers: { "Retry-After": String(r.retryAfterSec) } });
    }
  }
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").toLowerCase().split(":")[0]!;
  const { pathname } = request.nextUrl;
  if (ROOT_REDIRECT_HOSTS.has(host)) {
    const url = request.nextUrl.clone();
    url.protocol = "https:";
    url.host = APP_HOST;
    url.port = "";
    return NextResponse.redirect(url, 308);
  }
  const isAppHost = !host || APP_HOSTS.has(host) || [...APP_HOSTS].some((h) => h.split(":")[0] === host);
  if (!isAppHost && !pathname.startsWith("/book/") && !pathname.startsWith("/api/") && !pathname.startsWith("/_next/")) {
    const url = request.nextUrl.clone();
    url.pathname = `/book/_host/${host}${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url);
  }
  const cookie = getSessionCookie(request);
  const protectedPath = pathname.startsWith("/app") || pathname.startsWith("/onboarding") || pathname.startsWith("/account");
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
