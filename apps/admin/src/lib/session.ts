import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const COOKIE = "admin_session";
export const SESSION_HOURS = 8;

/**
 * Lax, not Strict: after "Continue with Google" the browser arrives from google.com, and a Strict cookie set on that
 * chain is withheld from the very next request ("/"), which bounces back to the login page. Lax still keeps the cookie
 * off cross-site POSTs; the admin's changes are all POST server actions, which Next also checks the Origin of.
 */
export function sessionCookieOptions(production: boolean) {
  return { httpOnly: true, sameSite: "lax" as const, secure: production, path: "/", maxAge: SESSION_HOURS * 3600 };
}

function secret(): string {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("ADMIN_SESSION_SECRET must be set to a random string of at least 32 characters");
  return s;
}

function sign(payload: string, key = secret()): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/** A signed, expiring cookie value naming who is signed in (`u`, an admin_users id). */
export function createToken(userId: string, now = Date.now(), key = secret()): string {
  const payload = Buffer.from(JSON.stringify({ exp: now + SESSION_HOURS * 3600_000, u: userId })).toString("base64url");
  return `${payload}.${sign(payload, key)}`;
}

/** Who a valid token belongs to, or null when it is forged, expired, malformed or from before accounts existed (no `u`). */
export function tokenUserId(token: string | undefined, now = Date.now(), key?: string): string | null {
  if (!token) return null;
  const [payload, mac, extra] = token.split(".");
  if (!payload || !mac || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload, key));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { exp, u } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { exp?: unknown; u?: unknown };
    return typeof exp === "number" && exp > now && typeof u === "string" && u ? u : null;
  } catch {
    return null;
  }
}

/** Signature and expiry only; the database check that the admin still exists and is enabled is requireAdmin(). */
export function verifyToken(token: string | undefined, now = Date.now(), key?: string): boolean {
  return tokenUserId(token, now, key) !== null;
}

/** `hash` is `scrypt:<saltHex>:<hashHex>` as printed by scripts/hash-password.mjs. */
export function checkPassword(password: string, hash: string | undefined): boolean {
  const [scheme, saltHex, hashHex] = (hash ?? "").split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const want = Buffer.from(hashHex, "hex");
  const got = scryptSync(password, Buffer.from(saltHex, "hex"), want.length);
  return timingSafeEqual(want, got);
}

/** Same format scripts/hash-password.mjs prints, so a reset password and an env password are interchangeable. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString("hex")}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export const MIN_PASSWORD = 12;

// Login throttle: 5 failures per IP per 15 minutes (per instance; Cloudflare Access is the real gate).
const failures = new Map<string, { n: number; first: number }>();
const WINDOW_MS = 15 * 60_000;

export function throttled(ip: string, now = Date.now()): boolean {
  const f = failures.get(ip);
  if (!f) return false;
  if (now - f.first > WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return f.n >= 5;
}

export function recordFailure(ip: string, now = Date.now()): void {
  const f = failures.get(ip);
  if (!f || now - f.first > WINDOW_MS) failures.set(ip, { n: 1, first: now });
  else f.n += 1;
}

export function clearFailures(ip: string): void {
  failures.delete(ip);
}
