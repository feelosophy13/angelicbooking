/**
 * Client (customer) sessions for the public booking site. Separate from staff
 * auth: a signed, httpOnly cookie per business holding the client id. The
 * signature uses BETTER_AUTH_SECRET so no extra configuration is needed.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const DAYS = 30;

function secret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("BETTER_AUTH_SECRET is required for client sessions");
  return s;
}

export function clientCookieName(businessId: string): string {
  return `abc_${businessId.slice(0, 12)}`;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function encodeClientSession(businessId: string, clientId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ b: businessId, c: clientId, exp: now + DAYS * 86_400_000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeClientSession(value: string | undefined, businessId: string, now = Date.now()): string | null {
  if (!value) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { b: string; c: string; exp: number };
    if (data.b !== businessId || typeof data.c !== "string" || data.exp < now) return null;
    return data.c;
  } catch {
    return null;
  }
}

export async function setClientSession(businessId: string, slug: string, clientId: string) {
  const jar = await cookies();
  jar.set(clientCookieName(businessId), encodeClientSession(businessId, clientId), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: `/book/${slug}`, maxAge: DAYS * 86_400 });
}

export async function clearClientSession(businessId: string, slug: string) {
  const jar = await cookies();
  jar.set(clientCookieName(businessId), "", { httpOnly: true, sameSite: "lax", path: `/book/${slug}`, maxAge: 0 });
}

/** The signed-in client's id for this business, or null. */
export async function getClientSessionId(businessId: string): Promise<string | null> {
  const jar = await cookies();
  return decodeClientSession(jar.get(clientCookieName(businessId))?.value, businessId);
}
