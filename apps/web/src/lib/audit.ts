import { schema, withTenant } from "@angelic/db";

/** One activity-log row for the business. */
export async function auditEvent(businessId: string, actorUserId: string | null, action: string, entity: string, entityId: string | null, diff?: unknown) {
  await withTenant(businessId, (tx) => tx.insert(schema.auditLog).values({ businessId, actorUserId, action, entity, entityId, diff: diff === undefined ? null : JSON.stringify(diff) }));
}

/** Record a settings save: only the fields that changed, as [before, after]. Nothing is written when nothing changed. */
export async function auditSettings(business: { id: string } & Record<string, unknown>, actorUserId: string, area: string, patch: Record<string, unknown>) {
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const changes = Object.fromEntries(Object.entries(patch).filter(([k, v]) => !same(business[k], v)).map(([k, v]) => [k, [business[k] ?? null, v ?? null]]));
  if (!Object.keys(changes).length) return;
  await auditEvent(business.id, actorUserId, `settings.${area}`, "business", business.id, changes);
}
