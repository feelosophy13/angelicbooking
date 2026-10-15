/**
 * Shared fixtures for API integration tests (needs Postgres at DATABASE_URL, the app role with RLS forced).
 * Usage: const kit = await setupKit(); ... await kit.teardown();  Each test file gets its own two businesses, so files can run in parallel.
 */
import "../../../../../packages/db/src/env";
import { eq } from "drizzle-orm";
import { db, getSql, schema, withTenant } from "@angelic/db";
import { generateKey } from "../api";

export type Handler<P = Record<string, never>> = (req: Request, ctx: { params: Promise<P> }) => Promise<Response>;

/** Call a route handler directly with a bearer key (null = no key). `params` fills dynamic segments; a fresh IP per call avoids the failed-auth throttle. */
export function call<P = Record<string, never>>(handler: Handler<P>, key: string | null, params: P = {} as P, init: RequestInit = {}, url = "http://x/api/v1/t"): Promise<Response> {
  return handler(new Request(url, { ...init, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json", "x-forwarded-for": `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...(init.headers as Record<string, string> | undefined) } }), { params: Promise.resolve(params) });
}
export const send = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/**
 * Make a key. By default it is an OLDER key (scope version 1: its scopes expand to everything they used to allow), which is what most
 * integration tests want; pass `version: 2` for a key that holds exactly the scopes given.
 */
export async function mkKey(businessId: string, scopes: string[], opts: { version?: 1 | 2; allowedIps?: string[]; rateLimitPerMin?: number } = {}): Promise<string> {
  const k = generateKey();
  await withTenant(businessId, (tx) => tx.insert(schema.apiKeys).values({ businessId, name: "test", prefix: k.prefix, keyHash: k.hash, scopes, scopeVersion: opts.version ?? 1, allowedIps: opts.allowedIps ?? [], rateLimitPerMin: opts.rateLimitPerMin ?? null }));
  return k.key;
}

export async function reachable(): Promise<boolean> {
  try {
    await getSql()`select 1 from api_keys limit 1`;
    return true;
  } catch {
    return false;
  }
}

/** Two businesses (A is the caller, B is "someone else") with a key for A holding `scopes`, and A's/B's ids in `ids`. */
export async function setupKit(scopes: string[]) {
  const tag = crypto.randomUUID().slice(0, 8);
  const A = `kit_a_${tag}`;
  const B = `kit_b_${tag}`;
  for (const id of [A, B]) {
    await db.insert(schema.organization).values({ id, name: id, slug: id });
    await db.insert(schema.businesses).values({ id, name: id, slug: id });
  }
  const key = await mkKey(A, scopes);
  return {
    A, B, key,
    mkKey,
    teardown: async () => {
      for (const id of [A, B]) await db.delete(schema.organization).where(eq(schema.organization.id, id));
    },
  };
}
