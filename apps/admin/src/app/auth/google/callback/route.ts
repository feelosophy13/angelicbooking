import { NextResponse, type NextRequest } from "next/server";
import { baseUrl } from "@/lib/admin-session";
import { GOOGLE_TOKEN, acceptedEmail, allowedGoogleEmails, decodeIdToken, googleEnabled } from "@/lib/google";
import { COOKIE, clearFailures, createToken, recordFailure, sessionCookieOptions, throttled } from "@/lib/session";

export const dynamic = "force-dynamic";

/** One line per outcome, in the service log, so a failed sign-in can be diagnosed. Never logs codes, tokens or secrets. */
function note(event: string, detail: Record<string, unknown> = {}) {
  console.log(`[admin google] ${event} ${JSON.stringify(detail)}`);
}

function back(notice: string) {
  const res = NextResponse.redirect(new URL(`/login?notice=${notice}`, baseUrl()));
  res.cookies.delete({ name: "g_state", path: "/auth/google" });
  res.cookies.delete({ name: "g_verifier", path: "/auth/google" });
  return res;
}

/** Step 2: Google sends the person back with a code; trade it (server to server) for who they are, and let in only allowed emails. */
export async function GET(req: NextRequest) {
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (req.nextUrl.searchParams.get("error")) note("google returned an error", { error: req.nextUrl.searchParams.get("error"), description: req.nextUrl.searchParams.get("error_description") });
  if (!googleEnabled()) {
    note("not configured", { hasId: !!process.env.GOOGLE_CLIENT_ID, hasSecret: !!process.env.GOOGLE_CLIENT_SECRET });
    return back("google_failed");
  }
  if (throttled(ip)) {
    note("blocked by login throttle", { ip });
    return back("google_failed");
  }
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const wantState = req.cookies.get("g_state")?.value;
  const verifier = req.cookies.get("g_verifier")?.value;
  if (!code || !state || !wantState || state !== wantState || !verifier) {
    note("state or cookie problem", { hasCode: !!code, hasState: !!state, hasStateCookie: !!wantState, hasVerifierCookie: !!verifier, statesMatch: !!state && state === wantState });
    recordFailure(ip);
    return back("google_failed");
  }
  try {
    const res = await fetch(GOOGLE_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${baseUrl()}/auth/google/callback`,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      note("token exchange rejected", { status: res.status, body });
      throw new Error(`token endpoint ${res.status}`);
    }
    const { id_token } = (await res.json()) as { id_token?: string };
    const claims = id_token ? decodeIdToken(id_token) : null;
    const allowed = allowedGoogleEmails();
    const email = id_token ? acceptedEmail(claims, { clientId: process.env.GOOGLE_CLIENT_ID!, allowed }) : null;
    if (!email) {
      note("sign-in denied", {
        hasIdToken: !!id_token,
        email: claims?.email ?? null,
        emailVerified: claims?.email_verified ?? null,
        issuer: claims?.iss ?? null,
        audienceMatches: claims?.aud === process.env.GOOGLE_CLIENT_ID,
        expired: typeof claims?.exp === "number" ? claims.exp * 1000 <= Date.now() : null,
        allowedCount: allowed.length,
        emailIsAllowed: claims?.email ? allowed.includes(claims.email.toLowerCase()) : null,
      });
      recordFailure(ip);
      return back("google_denied");
    }
    note("signed in", { email });
    clearFailures(ip);
    const ok = NextResponse.redirect(new URL("/", baseUrl()));
    // Set on this very response (not through next/headers) so the cookie is certainly on the redirect.
    ok.cookies.set(COOKIE, createToken(), sessionCookieOptions(process.env.NODE_ENV === "production"));
    ok.cookies.delete({ name: "g_state", path: "/auth/google" });
    ok.cookies.delete({ name: "g_verifier", path: "/auth/google" });
    return ok;
  } catch (e) {
    note("failed", { error: (e as Error).message });
    return back("google_failed");
  }
}
