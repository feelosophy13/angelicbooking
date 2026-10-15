import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const COOKIE = "admin_session";
export const SESSION_HOURS = 8;

function secret(): string {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("ADMIN_SESSION_SECRET must be set to a random string of at least 32 characters");
  return s;
}

function sign(payload: string, key = secret()): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function createToken(now = Date.now(), key = secret()): string {
  const payload = Buffer.from(JSON.stringify({ exp: now + SESSION_HOURS * 3600_000 })).toString("base64url");
  return `${payload}.${sign(payload, key)}`;
}

export function verifyToken(token: string | undefined, now = Date.now(), key?: string): boolean {
  if (!token) return false;
  const [payload, mac, extra] = token.split(".");
  if (!payload || !mac || extra !== undefined) return false;
  const expected = Buffer.from(sign(payload, key));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { exp?: unknown };
    return typeof exp === "number" && exp > now;
  } catch {
    return false;
  }
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
