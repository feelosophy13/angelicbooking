/**
 * Fixed-window rate limiter kept in process memory. Good for one instance, and as the fallback when the shared store is unreachable.
 * Call sites that must hold across instances use `sharedRateLimit` (lib/shared-rate-limit.ts), which counts in Postgres.
 */
type Bucket = { count: number; resetAt: number };
const store = new Map<string, Bucket>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; remaining: number; retryAfterSec: number } {
  const now = Date.now();
  const b = store.get(key);
  if (!b || b.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    if (store.size > 50_000) for (const [k, v] of store) if (v.resetAt <= now) store.delete(k);
    return { ok: true, remaining: limit - 1, retryAfterSec: Math.ceil(windowMs / 1000) };
  }
  b.count++;
  return { ok: b.count <= limit, remaining: Math.max(0, limit - b.count), retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
}

/**
 * The caller's address as our proxy saw it: the LAST X-Forwarded-For entry. Render's proxy (the only hop in front of the app;
 * app.angelicbooking.com is DNS-only on Cloudflare) appends the address it accepted the connection from; everything before it
 * was written by the caller and is ignored, so a forged header can't dodge a rate limit. "local" in development.
 */
/** Set by the proxy on every request it passes on: the client address we trust (see clientIpFrom). */
export const CLIENT_IP_HEADER = "x-angelic-client-ip";

export function clientIpFrom(h: Headers): string {
  const parts = (h.get("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return parts.at(-1) ?? h.get("x-real-ip")?.trim() ?? "local";
}

export function clientIp(req: Request): string {
  return clientIpFrom(req.headers);
}

/** The address recorded on a signed form (evidence of who signed): the trusted hop, or null in development. */
export function formIp(h: Headers): string | null {
  const ip = clientIpFrom(h);
  return ip === "local" ? null : ip;
}
