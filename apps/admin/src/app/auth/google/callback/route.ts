import { NextResponse, type NextRequest } from "next/server";
import { baseUrl, startSession } from "@/lib/admin-session";
import { GOOGLE_TOKEN, acceptedEmail, allowedGoogleEmails, decodeIdToken, googleEnabled } from "@/lib/google";
import { clearFailures, recordFailure, throttled } from "@/lib/session";

export const dynamic = "force-dynamic";

function back(notice: string) {
  const res = NextResponse.redirect(new URL(`/login?notice=${notice}`, baseUrl()));
  res.cookies.delete({ name: "g_state", path: "/auth/google" });
  res.cookies.delete({ name: "g_verifier", path: "/auth/google" });
  return res;
}

/** Step 2: Google sends the person back with a code; trade it (server to server) for who they are, and let in only allowed emails. */
export async function GET(req: NextRequest) {
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!googleEnabled() || throttled(ip)) return back("google_failed");
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const wantState = req.cookies.get("g_state")?.value;
  const verifier = req.cookies.get("g_verifier")?.value;
  if (!code || !state || !wantState || state !== wantState || !verifier) {
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
    if (!res.ok) throw new Error(`token endpoint ${res.status}`);
    const { id_token } = (await res.json()) as { id_token?: string };
    const email = id_token ? acceptedEmail(decodeIdToken(id_token), { clientId: process.env.GOOGLE_CLIENT_ID!, allowed: allowedGoogleEmails() }) : null;
    if (!email) {
      recordFailure(ip);
      return back("google_denied");
    }
    clearFailures(ip);
    await startSession();
    const ok = NextResponse.redirect(new URL("/", baseUrl()));
    ok.cookies.delete({ name: "g_state", path: "/auth/google" });
    ok.cookies.delete({ name: "g_verifier", path: "/auth/google" });
    return ok;
  } catch (e) {
    console.error("[admin] google sign-in failed:", (e as Error).message);
    return back("google_failed");
  }
}
