import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema, withTenant } from "@angelic/db";
import { clientIp } from "./rate-limit";
import { sharedRateLimit, type RateResult } from "./shared-rate-limit";
import { API_KEY_PREFIX, DEFAULT_RATE_LIMIT_PER_MIN, expandScopes, hasScope, ipAllowed, type ApiScope } from "./api-scopes";

/** What every /api/v1 handler receives. `business` comes from the key and nowhere else: never from the URL, query or body. */
export type ApiContext = {
  business: typeof schema.businesses.$inferSelect;
  keyId: string;
  /** Recorded as the actor in the activity log. */
  actor: string;
  /** Exactly what this key may do (legacy keys already expanded). A handler that does more than its route scope checks `can`/`needScopes`. */
  scopes: readonly string[];
};

/** Whether the key behind `ctx` holds `scope`. */
export const can = (ctx: ApiContext, scope: ApiScope) => hasScope(ctx.scopes, scope);

/**
 * Some bodies carry fields that need a scope beyond the route's own (a price, a consent flag, a private note). Returns a 403 naming the first
 * missing scope, or null when the key holds them all.
 */
export function needScopes(ctx: ApiContext, ...scopes: ApiScope[]): NextResponse | null {
  const missing = scopes.find((s) => !hasScope(ctx.scopes, s));
  return missing ? apiError(403, "insufficient_scope", `This key does not have the "${missing}" scope, which this request needs.`) : null;
}

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

const BAD_AUTH_LIMIT = 30; // failed attempts per minute per IP
const MAX_BODY_BYTES = 100_000;

type Found = { id: string; businessId: string; scopes: string[]; scopeVersion: number; allowedIps: string[]; rateLimitPerMin: number | null; expiresAt: Date | null; revokedAt: Date | null; lastUsedAt: Date | null };

async function findKey(hash: string): Promise<Found | null> {
  // The key_lookup RLS policy exposes exactly the row whose hash is in this variable, to this transaction only.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.api_key_hash', ${hash}, true)`);
    const [row] = await tx
      .select({ id: schema.apiKeys.id, businessId: schema.apiKeys.businessId, scopes: schema.apiKeys.scopes, scopeVersion: schema.apiKeys.scopeVersion, allowedIps: schema.apiKeys.allowedIps, rateLimitPerMin: schema.apiKeys.rateLimitPerMin, expiresAt: schema.apiKeys.expiresAt, revokedAt: schema.apiKeys.revokedAt, lastUsedAt: schema.apiKeys.lastUsedAt })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.keyHash, hash))
      .limit(1);
    return row ?? null;
  });
}

/**
 * Check the bearer key and the scope it needs. Every failure to identify a key is the same 401, so a caller cannot tell a wrong key from a
 * revoked, expired or suspended one. `rate` is this key's current window, for the response headers (absent when no key was identified).
 */
export async function authenticate(req: Request, scope: ApiScope): Promise<{ ctx: ApiContext; rate: RateResult } | { error: NextResponse; rate?: RateResult }> {
  const ip = clientIp(req);
  const bad = async () => {
    const r = await sharedRateLimit(`api-bad:${ip}`, BAD_AUTH_LIMIT, 60_000);
    return { error: r.ok ? apiError(401, "invalid_api_key", "Missing or invalid API key. Send it as: Authorization: Bearer <key>", undefined, { "WWW-Authenticate": "Bearer" }) : apiError(429, "rate_limited", "Too many failed attempts. Try again shortly.", undefined, { "Retry-After": String(r.retryAfterSec) }) };
  };
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  if (!m || !m[1]!.startsWith(API_KEY_PREFIX) || m[1]!.length > 200) return bad();
  const found = await findKey(hashKey(m[1]!));
  if (!found || found.revokedAt || (found.expiresAt && found.expiresAt <= new Date())) return bad();
  const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, found.businessId) });
  if (!business || business.suspendedAt) return bad();
  // Trial over with no subscription: the API is closed like the staff app (the key itself is fine).
  const { businessAccess } = await import("@/server/access");
  if ((await businessAccess(business)).state === "expired") return { error: apiError(402, "subscription_required", "This business's free trial has ended. Add a card under Settings → Billing to use the API again.") };
  // A key restricted to certain addresses answers like any other bad key from anywhere else. The address is the one our proxy saw (the last
  // X-Forwarded-For entry): the first entry is whatever the caller wrote, so it proves nothing.
  if (!ipAllowed(found.allowedIps, clientIp(req))) return bad();
  const limit = found.rateLimitPerMin ?? DEFAULT_RATE_LIMIT_PER_MIN;
  const rate = await sharedRateLimit(`api-key:${found.id}`, limit, 60_000);
  if (!rate.ok) return { error: apiError(429, "rate_limited", `Rate limit is ${limit} requests per minute for this key.`, undefined, { "Retry-After": String(rate.retryAfterSec) }), rate };
  const scopes = expandScopes(found.scopes, found.scopeVersion);
  if (!hasScope(scopes, scope)) return { error: apiError(403, "insufficient_scope", `This key does not have the "${scope}" scope.`), rate };
  // Record use at most once a minute, inside the key's own tenant.
  if (!found.lastUsedAt || Date.now() - found.lastUsedAt.getTime() > 60_000) {
    await withTenant(business.id, (tx) => tx.update(schema.apiKeys).set({ lastUsedAt: new Date() }).where(and(eq(schema.apiKeys.id, found.id), eq(schema.apiKeys.businessId, business.id)))).catch(() => {});
  }
  return { ctx: { business, keyId: found.id, actor: `api:${found.id}`, scopes }, rate };
}

/** Every response from /api/v1 says no-store, and carries the key's rate-limit window when there is one. */
function withApiHeaders(res: Response, rate?: RateResult): Response {
  res.headers.set("Cache-Control", "no-store");
  if (rate) {
    res.headers.set("X-RateLimit-Limit", String(rate.limit));
    res.headers.set("X-RateLimit-Remaining", String(rate.remaining));
    res.headers.set("X-RateLimit-Reset", String(rate.resetAt));
  }
  return res;
}

type Handler<P> = (ctx: ApiContext, req: Request, params: P) => Promise<NextResponse | Response>;

/** A body field that needs a scope beyond the route's own, optionally only for some values (switching something ON, say). */
export type FieldRule = ApiScope | { scope: ApiScope; when: (value: unknown) => boolean };
export type RouteOptions = {
  /** Body field name (at any depth) → the extra scope sending it needs. Checked before the handler runs, so a tool that leaves the field out never needs the scope. */
  fields?: Record<string, FieldRule>;
  /** Scopes the route needs on top of its own, always. */
  also?: ApiScope[];
};

/** Fields that set what clients pay or what things cost: sending any of them needs `pricing:write`. */
export const PRICE_FIELDS: Record<string, FieldRule> = Object.fromEntries(
  ["price_cents", "price_override_cents", "cost_cents", "deposit_cents", "deposit_percent", "deposit_type", "discount_bps"].map((f) => [f, "pricing:write" as const]),
);
/** Client fields that are consent, or private notes, rather than plain details. */
export const CLIENT_FIELDS: Record<string, FieldRule> = { sms_opt_in: "clients:consent", email_opt_in: "clients:consent", notes: "client-notes:write" };

/** Every key (with its value) in a parsed JSON body, at any depth. */
function* walk(v: unknown): Generator<[string, unknown]> {
  if (Array.isArray(v)) for (const x of v) yield* walk(x);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { yield [k, x]; yield* walk(x); }
}

/** The first scope the body needs that the key lacks, or null. A body that is not JSON is left for the handler to refuse (400). */
function missingFieldScope(ctx: ApiContext, bodyText: string, rules: Record<string, FieldRule>): ApiScope | null {
  let parsed: unknown;
  try { parsed = JSON.parse(bodyText); } catch { return null; }
  for (const [key, value] of walk(parsed)) {
    const rule = rules[key];
    if (!rule || !Object.hasOwn(rules, key)) continue;
    const scope = typeof rule === "string" ? rule : rule.when(value) ? rule.scope : null;
    if (scope && !hasScope(ctx.scopes, scope)) return scope;
  }
  return null;
}

/** Wrap a route: authenticate, enforce the scope (and any field-level scopes), turn thrown errors into JSON. Handlers never see an unauthenticated request. */
export function route<P = Record<string, never>>(scope: ApiScope, handler: Handler<P>, opts: RouteOptions = {}) {
  return async (req: Request, { params }: { params: Promise<P> }) => {
    const auth = await authenticate(req, scope);
    if ("error" in auth) return withApiHeaders(auth.error, auth.rate);
    try {
      const lacks = needScopes(auth.ctx, ...(opts.also ?? []));
      if (lacks) return withApiHeaders(lacks, auth.rate);
      if (opts.fields && req.method !== "GET" && req.method !== "DELETE") {
        // Read the body once, here, and hand the handler a request carrying the same text.
        const text = await readCappedText(req);
        const need = missingFieldScope(auth.ctx, text, opts.fields);
        if (need) return withApiHeaders(needScopes(auth.ctx, need)!, auth.rate);
        req = new Request(req.url, { method: req.method, headers: req.headers, body: text });
      }
      return withApiHeaders(await handler(auth.ctx, req, await params), auth.rate);
    } catch (e) {
      const rate = auth.rate;
      const { BookingError } = await import("@/server/booking");
      if (e instanceof BookingError) return withApiHeaders(apiError(409, "booking_conflict", e.message), rate);
      if (e instanceof ApiBadRequest) return withApiHeaders(apiError(400, "bad_request", e.message), rate);
      if (e instanceof ApiTooLarge) return withApiHeaders(apiError(413, "payload_too_large", `Request body is larger than ${MAX_BODY_BYTES / 1000} KB.`), rate);
      // Answered here, so Next's error hook never sees it: report it ourselves (route, key, stack).
      const { reportError } = await import("./report-error");
      await reportError(`API ${req.method} ${new URL(req.url).pathname} → ${(e as Error).message}`, e, { keyId: auth.ctx.keyId, businessId: auth.ctx.business.id });
      return withApiHeaders(apiError(500, "server_error", "Something went wrong on our side."), rate);
    }
  };
}

export class ApiBadRequest extends Error {}
export class ApiTooLarge extends Error {}

/**
 * The body as text, read at most MAX_BODY_BYTES. A declared Content-Length over the cap is refused before anything is read; otherwise the
 * stream is cut off as soon as it passes the cap, so a body without a length cannot fill memory.
 */
async function readCappedText(req: Request): Promise<string> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new ApiTooLarge();
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new ApiTooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Parse a JSON body against a schema. Throws ApiBadRequest for malformed JSON, ApiTooLarge for a body over the cap; returns a 422 response for invalid fields. */
export async function readBody<S extends z.ZodTypeAny>(req: Request, schemaDef: S): Promise<{ data: z.infer<S> } | { error: NextResponse }> {
  const text = await readCappedText(req);
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

/**
 * The same page, asking the database for one row more than the page holds. Pass this to a query whose total is not counted, so `list`
 * can tell whether a next page exists without a second query. The extra row is dropped by `list`.
 */
export function probe<T extends { limit: number }>(p: T): T {
  return { ...p, limit: p.limit + 1 };
}

/**
 * A page of results. With `total` (counted), has_more is exact from the count. Without it, pass the rows fetched with `probe(p)`: has_more
 * is true when the extra row came back, and that row is not returned.
 */
export function list<T>(data: T[], p: { limit: number; page: number }, total?: number) {
  if (total !== undefined) {
    return NextResponse.json({ data, page: p.page, limit: p.limit, total, has_more: p.page * p.limit < total });
  }
  const hasMore = data.length > p.limit;
  return NextResponse.json({ data: hasMore ? data.slice(0, p.limit) : data, page: p.page, limit: p.limit, has_more: hasMore });
}

export async function apiAudit(ctx: ApiContext, action: string, entity: string, entityId: string, diff?: unknown) {
  await withTenant(ctx.business.id, (tx) =>
    tx.insert(schema.auditLog).values({ businessId: ctx.business.id, actorUserId: ctx.actor, action, entity, entityId, diff: diff === undefined ? null : JSON.stringify(diff) }),
  );
}

/**
 * Foreign keys are not subject to row-level security, so every id a request names (a client, a service, a staff member) must be proven to
 * belong to the key's business before it is used. Pass `[table, id, label]` triples (ids that are null/undefined are skipped); the result is the
 * label of the first one that is not in this business ("client"), or null when all are. Use it inside the same withTenant transaction as the write.
 */
export async function firstForeign(
  tx: import("@angelic/db").TenantDb,
  businessId: string,
  checks: [table: Owned, id: string | null | undefined, label: string][],
): Promise<string | null> {
  for (const [table, id, label] of checks) {
    if (!id) continue;
    const [row] = await tx.select({ id: table.id }).from(table).where(and(eq(table.id, id), eq(table.businessId, businessId))).limit(1);
    if (!row) return label;
  }
  return null;
}

/** Any tenant table: it has an id and a business_id. */
export type Owned = import("drizzle-orm/pg-core").PgTable & { id: import("drizzle-orm/pg-core").PgColumn; businessId: import("drizzle-orm/pg-core").PgColumn };
