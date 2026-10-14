"use server";
import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { generateKey } from "@/lib/api";
import { isApiScope } from "@/lib/api-scopes";
import type { FormState } from "@/lib/form";

const MAX_ACTIVE_KEYS = 20;

/** Create a key. The secret comes back once in `values.key`; only its hash is stored, so it can never be shown again. */
export async function createApiKey(_prev: FormState | undefined, fd: FormData): Promise<FormState> {
  const slug = String(fd.get("slug") ?? "");
  const ctx = await requireAction(slug, "business.manage");
  const name = String(fd.get("name") ?? "").trim();
  const scopes = [...new Set(fd.getAll("scopes").map(String))].filter(isApiScope);
  const days = Number(fd.get("expiresInDays") ?? 0);
  const fieldErrors: Record<string, string> = {};
  if (name.length < 2 || name.length > 60) fieldErrors.name = "Give the key a short name, like \"Website\" or \"Zapier\".";
  if (!scopes.length) fieldErrors.scopes = "Pick at least one thing the key may do.";
  if (![0, 30, 90, 365].includes(days)) fieldErrors.expiresInDays = "Pick an expiry.";
  if (Object.keys(fieldErrors).length) return { fieldErrors, error: "Please check the highlighted fields." };
  const businessId = ctx.business.id;
  const k = generateKey();
  const full = await withTenant(businessId, async (tx) => {
    const [n] = await tx.select({ n: sql<number>`count(*)` }).from(schema.apiKeys).where(and(eq(schema.apiKeys.businessId, businessId), isNull(schema.apiKeys.revokedAt)));
    if (Number(n?.n ?? 0) >= MAX_ACTIVE_KEYS) return true;
    const [row] = await tx
      .insert(schema.apiKeys)
      .values({ businessId, name, prefix: k.prefix, keyHash: k.hash, scopes, createdByUserId: ctx.user.id, expiresAt: days ? new Date(Date.now() + days * 86_400_000) : null })
      .returning({ id: schema.apiKeys.id });
    await tx.insert(schema.auditLog).values({ businessId, actorUserId: ctx.user.id, action: "api_key.create", entity: "api_key", entityId: row!.id, diff: JSON.stringify({ name, scopes }) });
    return false;
  });
  if (full) return { error: `You can have up to ${MAX_ACTIVE_KEYS} active keys. Revoke one you no longer use.` };
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
