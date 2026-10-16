import { createHash, randomBytes } from "node:crypto";

export const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";

export function googleEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET;
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function newState(): string {
  return randomBytes(16).toString("hex");
}

export type IdClaims = { iss?: string; aud?: string; exp?: number; email?: string; email_verified?: boolean };

/** The claims of a JWT we received straight from Google's token endpoint over TLS (no signature check needed there). */
export function decodeIdToken(idToken: string): IdClaims | null {
  const part = idToken.split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString()) as IdClaims;
  } catch {
    return null;
  }
}

/** The signed-in email when the claims are for this app, unexpired, verified and on the allow list; otherwise null. */
export function acceptedEmail(claims: IdClaims | null, opts: { clientId: string; allowed: string[]; now?: number }): string | null {
  if (!claims) return null;
  const now = opts.now ?? Date.now();
  if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") return null;
  if (claims.aud !== opts.clientId) return null;
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
  if (claims.email_verified !== true || typeof claims.email !== "string") return null;
  const email = claims.email.toLowerCase();
  return opts.allowed.includes(email) ? email : null;
}
