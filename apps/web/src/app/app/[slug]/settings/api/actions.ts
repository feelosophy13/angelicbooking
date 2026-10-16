"use server";
import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { generateKey } from "@/lib/api";
import { DEFAULT_RATE_LIMIT_PER_MIN, isApiScope, isValidIpEntry, RATE_LIMIT_CHOICES, scopesBeyond } from "@/lib/api-scopes";
import type { FormState } from "@/lib/form";

const MAX_ACTIVE_KEYS = 20;
/** Until a business has a subscription it gets a couple of keys to try the API. */
const TRIAL_MAX_KEYS = 2;

/** Create a key. The secret comes back once in `values.key`; only its hash is stored, so it can never be shown again. */
export async function createApiKey(_prev: FormState | undefined, fd: FormData): Promise<FormState> {
  const slug = String(fd.get("slug") ?? "");
  const ctx = await requireAction(slug, "business.manage");
  const name = String(fd.get("name") ?? "").trim();
  const scopes = [...new Set(fd.getAll("scopes").map(String))].filter(isApiScope);
  const days = Number(fd.get("expiresInDays") ?? 0);
  // Set when this key replaces an older one (the "Replace" button): the old key is revoked in the same transaction.
  const replaces = String(fd.get("replaces") ?? "") || null;
  // Optional limits: addresses allowed to use the key (one per line or comma-separated), and requests per minute.
  const allowedIps = [...new Set(String(fd.get("allowedIps") ?? "").split(/[\s,]+/).map((x) => x.trim()).filter(Boolean))];
  const rate = Number(fd.get("rateLimit") ?? DEFAULT_RATE_LIMIT_PER_MIN);
  const fieldErrors: Record<string, string> = {};
  const badIp = allowedIps.find((x) => !isValidIpEntry(x));
  if (badIp) fieldErrors.allowedIps = `“${badIp}” is not an IP address or a range like 203.0.113.0/24.`;
  else if (allowedIps.length > 20) fieldErrors.allowedIps = "Up to 20 addresses.";
  if (!(RATE_LIMIT_CHOICES as readonly number[]).includes(rate)) fieldErrors.rateLimit = "Pick a limit from the list.";
  if (name.length < 2 || name.length > 60) fieldErrors.name = "Give the key a short name, like \"Website\" or \"Zapier\".";
  const beyond = scopesBeyond(scopes, ctx.permissions as { has(a: string): boolean }, ctx.role === "owner");
  if (!scopes.length) fieldErrors.scopes = "Pick at least one thing the key may do.";
  else if (beyond.length) fieldErrors.scopes = `Your role can't grant ${beyond.join(", ")}. Ask an owner to create this key.`;
  if (![0, 30, 90, 365].includes(days)) fieldErrors.expiresInDays = "Pick an expiry.";
  // Echo what was typed: the form is cleared when an action finishes, so without this a typo would cost the person everything they entered.
  const echo = { name, expiresInDays: String(days), allowedIps: allowedIps.join("\n"), rateLimit: String(rate) };
  if (Object.keys(fieldErrors).length) return { fieldErrors, values: echo, error: "Please check the highlighted fields." };
  const businessId = ctx.business.id;
  const k = generateKey();
  const full = await withTenant(businessId, async (tx) => {
    const [n] = await tx.select({ n: sql<number>`count(*)` }).from(schema.apiKeys).where(and(eq(schema.apiKeys.businessId, businessId), isNull(schema.apiKeys.revokedAt)));
    if (Number(n?.n ?? 0) >= (ctx.plan.state === "trial" ? TRIAL_MAX_KEYS : MAX_ACTIVE_KEYS)) return true;
    const [row] = await tx
      .insert(schema.apiKeys)
      .values({ businessId, name, prefix: k.prefix, keyHash: k.hash, scopes, scopeVersion: 2, allowedIps, rateLimitPerMin: rate === DEFAULT_RATE_LIMIT_PER_MIN ? null : rate, createdByUserId: ctx.user.id, expiresAt: days ? new Date(Date.now() + days * 86_400_000) : null })
      .returning({ id: schema.apiKeys.id });
    await tx.insert(schema.auditLog).values({ businessId, actorUserId: ctx.user.id, action: "api_key.create", entity: "api_key", entityId: row!.id, diff: JSON.stringify({ name, scopes, replaces, allowedIps, rateLimit: rate }) });
    if (replaces) {
      const revoked = await tx.update(schema.apiKeys).set({ revokedAt: new Date() }).where(and(eq(schema.apiKeys.id, replaces), eq(schema.apiKeys.businessId, businessId), isNull(schema.apiKeys.revokedAt))).returning({ id: schema.apiKeys.id });
      if (revoked.length) await tx.insert(schema.auditLog).values({ businessId, actorUserId: ctx.user.id, action: "api_key.revoke", entity: "api_key", entityId: replaces, diff: JSON.stringify({ replacedBy: row!.id }) });
    }
    return false;
  });
  if (full) return { values: echo, error: ctx.plan.state === "trial" ? `During your free trial you can have up to ${TRIAL_MAX_KEYS} active keys. Revoke one, or subscribe for more.` : `You can have up to ${MAX_ACTIVE_KEYS} active keys. Revoke one you no longer use.` };
  revalidatePath(`/app/${slug}/settings/api`);
  return { ok: true, values: { key: k.key, name } };
}

export async function revokeApiKey(fd: FormData) {
  const slug = String(fd.get("slug") ?? "");
  const ctx = await requireAction(slug, "business.manage");
  const id = String(fd.get("id") ?? "");
  const businessId = ctx.business.id;
  await withTenant(businessId, async (tx) => {
    const rows = await tx.update(schema.apiKeys).set({ revokedAt: new Date() }).where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.businessId, businessId), isNull(schema.apiKeys.revokedAt))).returning({ id: schema.apiKeys.id });
    if (rows.length) await tx.insert(schema.auditLog).values({ businessId, actorUserId: ctx.user.id, action: "api_key.revoke", entity: "api_key", entityId: id });
  });
  revalidatePath(`/app/${slug}/settings/api`);
}
