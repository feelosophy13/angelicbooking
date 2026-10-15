import { NextResponse } from "next/server";
import { baseUrl } from "@/lib/admin-session";
import { GOOGLE_AUTH, googleEnabled, newState, pkcePair } from "@/lib/google";

export const dynamic = "force-dynamic";

/** Step 1: send the browser to Google. State and the PKCE verifier ride in short-lived cookies for the callback. */
export async function GET() {
  if (!googleEnabled()) {
    console.log("[admin google] start: not configured");
    return NextResponse.redirect(new URL("/login", baseUrl()));
  }
  const state = newState();
  const { verifier, challenge } = pkcePair();
  const url = new URL(GOOGLE_AUTH);
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${baseUrl()}/auth/google/callback`,
    response_type: "code",
    scope: "openid email",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  console.log(`[admin google] start: redirecting to Google with redirect_uri ${baseUrl()}/auth/google/callback`);
  const res = NextResponse.redirect(url);
  // Lax, not strict: the callback is a cross-site navigation back from Google and must carry these.
  const opts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/auth/google", maxAge: 600 };
  res.cookies.set("g_state", state, opts);
  res.cookies.set("g_verifier", verifier, opts);
  return res;
}
