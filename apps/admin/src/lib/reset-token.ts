import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const RESET_MINUTES = 30;

/** A short digest of the current password hash, baked into the link so it stops working the moment the password changes. */
export function fingerprint(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest("hex").slice(0, 16);
}

function mac(payload: string, secret: string): string {
  return createHmac("sha256", `${secret}:password-reset`).update(payload).digest("base64url");
}

export function createResetToken(secret: string, email: string, currentHash: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ e: email, x: now + RESET_MINUTES * 60_000, f: fingerprint(currentHash) })).toString("base64url");
  return `${payload}.${mac(payload, secret)}`;
}

/** The email named in a link, before it has been verified: only to look up whose password hash to verify it against. */
export function peekEmail(token: string | undefined): string | null {
  try {
    const { e } = JSON.parse(Buffer.from((token ?? "").split(".")[0] ?? "", "base64url").toString()) as { e?: unknown };
    return typeof e === "string" ? e : null;
  } catch {
    return null;
  }
}

/** The email the link was issued for, or null when it is forged, expired, or the password has changed since. */
export function verifyResetToken(secret: string, token: string | undefined, currentHash: string, now = Date.now()): { email: string } | null {
  if (!token) return null;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  const want = Buffer.from(mac(payload, secret));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const { e, x, f } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { e?: unknown; x?: unknown; f?: unknown };
    if (typeof e !== "string" || typeof x !== "number" || typeof f !== "string") return null;
    if (x <= now || f !== fingerprint(currentHash)) return null;
    return { email: e };
  } catch {
    return null;
  }
}

// Asking for a link: 3 per IP per hour, and one per minute overall, so the inbox can't be flooded. Per instance.
const byIp = new Map<string, number[]>();
let lastSentAt = 0;

export function mayRequestReset(ip: string, now = Date.now()): boolean {
  const recent = (byIp.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  byIp.set(ip, recent);
  return recent.length < 3 && now - lastSentAt >= 60_000;
}

export function noteResetRequest(ip: string, now = Date.now()): void {
  byIp.set(ip, [...(byIp.get(ip) ?? []), now]);
  lastSentAt = now;
}
