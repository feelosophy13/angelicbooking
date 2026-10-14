import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema, withTenant } from "@angelic/db";
import { clientIp, rateLimit } from "./rate-limit";
import { API_KEY_PREFIX, hasScope, type ApiScope } from "./api-scopes";

/** What every /api/v1 handler receives. `business` comes from the key and nowhere else: never from the URL, query or body. */
export type ApiContext = {
  business: typeof schema.businesses.$inferSelect;
  keyId: string;
  /** Recorded as the actor in the activity log. */
  actor: string;
};

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** A new secret: 256 bits of randomness, so a plain SHA-256 is enough to store (nothing to brute-force). */
export function generateKey(): { key: string; prefix: string; hash: string } {
  const key = API_KEY_PREFIX + randomBytes(32).toString("base64url");
  return { key, prefix: key.slice(0, API_KEY_PREFIX.length + 4), hash: hashKey(key) };
}

export function apiError(status: number, code: string, message: string, extra?: Record<string, unknown>, headers?: Record<string, string>) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export const ApiErrors = {
  notFound: (what = "resource") => apiError(404, "not_found", `That ${what} was not found.`),
  invalid: (message: string, issues?: unknown) => apiError(422, "validation_failed", message, issues ? { issues } : undefined),
  conflict: (message: string) => apiError(409, "conflict", message),
};

const PER_KEY_LIMIT = 120; // requests per minute per key
const BAD_AUTH_LIMIT = 30; // failed attempts per minute per IP

type Found = { id: string; businessId: string; scopes: string[]; expiresAt: Date | null; revokedAt: Date | null; lastUsedAt: Date | null };

async function findKey(hash: string): Promise<Found | null> {
  // The key_lookup RLS policy exposes exactly the row whose hash is in this variable, to this transaction only.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.api_key_hash', ${hash}, true)`);
    const [row] = await tx
      .select({ id: schema.apiKeys.id, businessId: schema.apiKeys.businessId, scopes: schema.apiKeys.scopes, expiresAt: schema.apiKeys.expiresAt, revokedAt: schema.apiKeys.revokedAt, lastUsedAt: schema.apiKeys.lastUsedAt })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.keyHash, hash))
      .limit(1);
    return row ?? null;
  });
}

/**
 * Check the bearer key and the scope it needs. Every failure to identify a key is the same 401, so a caller cannot tell a wrong key from a
 * revoked, expired or suspended one.
 */
export async function authenticate(req: Request, scope: ApiScope): Promise<{ ctx: ApiContext } | { error: NextResponse }> {
  const ip = clientIp(req);
  const bad = () => {
    const r = rateLimit(`api-bad:${ip}`, BAD_AUTH_LIMIT, 60_000);
    return { error: r.ok ? apiError(401, "invalid_api_key", "Missing or invalid API key. Send it as: Authorization: Bearer <key>", undefined, { "WWW-Authenticate": "Bearer" }) : apiError(429, "rate_limited", "Too many failed attempts. Try again shortly.", undefined, { "Retry-After": String(r.retryAfterSec) }) };
  };
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  if (!m || !m[1]!.startsWith(API_KEY_PREFIX) || m[1]!.length > 200) return bad();
  const found = await findKey(hashKey(m[1]!));
  if (!found || found.revokedAt || (found.expiresAt && found.expiresAt <= new Date())) return bad();
  const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, found.businessId) });
  if (!business || business.suspendedAt) return bad();
  const limited = rateLimit(`api-key:${found.id}`, PER_KEY_LIMIT, 60_000);
  if (!limited.ok) return { error: apiError(429, "rate_limited", `Rate limit is ${PER_KEY_LIMIT} requests per minute per key.`, undefined, { "Retry-After": String(limited.retryAfterSec) }) };
  if (!hasScope(found.scopes, scope)) return { error: apiError(403, "insufficient_scope", `This key does not have the "${scope}" scope.`) };
  // Record use at most once a minute, inside the key's own tenant.
  if (!found.lastUsedAt || Date.now() - found.lastUsedAt.getTime() > 60_000) {
    await withTenant(business.id, (tx) => tx.update(schema.apiKeys).set({ lastUsedAt: new Date() }).where(and(eq(schema.apiKeys.id, found.id), eq(schema.apiKeys.businessId, business.id)))).catch(() => {});
  }
  return { ctx: { business, keyId: found.id, actor: `api:${found.id}` } };
}

type Handler<P> = (ctx: ApiContext, req: Request, params: P) => Promise<NextResponse | Response>;

/** Wrap a route: authenticate, enforce the scope, turn thrown errors into JSON. Handlers never see an unauthenticated request. */
export function route<P = Record<string, never>>(scope: ApiScope, handler: Handler<P>) {
  return async (req: Request, { params }: { params: Promise<P> }) => {
    const auth = await authenticate(req, scope);
    if ("error" in auth) return auth.error;
    try {
      const res = await handler(auth.ctx, req, await params);
      res.headers.set("Cache-Control", "no-store");
      return res;
    } catch (e) {
      const { BookingError } = await import("@/server/booking");
      if (e instanceof BookingError) return apiError(409, "booking_conflict", e.message);
      if (e instanceof ApiBadRequest) return apiError(400, "bad_request", e.message);
      console.error("[api/v1]", (e as Error).message);
      return apiError(500, "server_error", "Something went wrong on our side.");
    }
  };
}

export class ApiBadRequest extends Error {}

/** Parse a JSON body against a schema. Throws ApiBadRequest for malformed JSON; returns a 422 response for invalid fields. */
export async function readBody<S extends z.ZodTypeAny>(req: Request, schemaDef: S): Promise<{ data: z.infer<S> } | { error: NextResponse }> {
  const text = await req.text();
  if (text.length > 100_000) throw new ApiBadRequest("Request body too large.");
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiBadRequest("Body must be valid JSON.");
  }
  const parsed = schemaDef.safeParse(raw);
  if (!parsed.success) return { error: ApiErrors.invalid("Some fields are invalid.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))) };
  return { data: parsed.data };
}

export function pageParams(url: URL) {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  return { limit, page, offset: (page - 1) * limit };
}

export function list<T>(data: T[], p: { limit: number; page: number }, total?: number) {
  return NextResponse.json({ data, page: p.page, limit: p.limit, ...(total !== undefined ? { total } : {}), has_more: total !== undefined ? p.page * p.limit < total : data.length === p.limit });
}

export async function apiAudit(ctx: ApiContext, action: string, entity: string, entityId: string, diff?: unknown) {
  await withTenant(ctx.business.id, (tx) =>
    tx.insert(schema.auditLog).values({ businessId: ctx.business.id, actorUserId: ctx.actor, action, entity, entityId, diff: diff === undefined ? null : JSON.stringify(diff) }),
  );
}
