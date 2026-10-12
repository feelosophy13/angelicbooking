import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { schema, withTenant, type TenantDb } from "@angelic/db";
import { instantToISODate } from "@angelic/core";
import { rateAsOf, rateDiff, type PayRateRow } from "@/lib/pay-rates";

/**
 * Effective-dated pay settings. Every change is a history row; the staff record mirrors the row
 * in force today so lists and forms can read it without a lookup. Payroll resolves rates from
 * the history as of the period, so re-running an old period reproduces the old figures.
 */

export type PayRateInput = Omit<PayRateRow, "effectiveFrom">;

const RATE_COLUMNS = ["payType", "mainCommissionBps", "productCommissionBps", "ccTipFeeBps", "hourlyRateCents", "salaryPerPeriodCents", "overtimeOverride", "taxDeductionCents", "taxDeductionBps"] as const;

export async function listPayRates(businessId: string, staffId: string) {
  return withTenant(businessId, (tx) => tx.select().from(schema.staffPayRates).where(eq(schema.staffPayRates.staffId, staffId)).orderBy(asc(schema.staffPayRates.effectiveFrom), asc(schema.staffPayRates.createdAt)));
}

/** Record a change. If it starts on or before today the staff record is updated now; later ones wait for their date. */
export async function recordPayChange(input: { businessId: string; timezone: string; staffId: string; effectiveFrom: string; rates: PayRateInput; note: string | null; actorUserId: string }) {
  await withTenant(input.businessId, async (tx) => {
    const rows = await tx.select().from(schema.staffPayRates).where(eq(schema.staffPayRates.staffId, input.staffId));
    const before = rateAsOf(rows, input.effectiveFrom);
    // A second change on the same date replaces the earlier one instead of stacking.
    const same = rows.find((r) => r.effectiveFrom === input.effectiveFrom);
    if (same) await tx.delete(schema.staffPayRates).where(eq(schema.staffPayRates.id, same.id));
    await tx.insert(schema.staffPayRates).values({ businessId: input.businessId, staffId: input.staffId, effectiveFrom: input.effectiveFrom, ...input.rates, note: input.note, createdByUserId: input.actorUserId });
    await tx.insert(schema.auditLog).values({ businessId: input.businessId, actorUserId: input.actorUserId, action: "staff.pay_change", entity: "staff", entityId: input.staffId, diff: JSON.stringify({ effectiveFrom: input.effectiveFrom, note: input.note, changes: rateDiff(same && before === same ? rateAsOf(rows.filter((r) => r !== same), input.effectiveFrom) : before, { effectiveFrom: input.effectiveFrom, ...input.rates }) }) });
    await syncCurrentRates(tx, instantToISODate(new Date(), input.timezone), [input.staffId]);
  });
}

/** Copy the row in force on `today` onto each staff record (all staff when no ids are given). */
export async function syncCurrentRates(tx: TenantDb, today: string, staffIds?: string[]) {
  const rows = await tx
    .select()
    .from(schema.staffPayRates)
    .where(and(lte(schema.staffPayRates.effectiveFrom, today), staffIds?.length ? inArray(schema.staffPayRates.staffId, staffIds) : undefined));
  const byStaff = new Map<string, typeof rows>();
  for (const r of rows) byStaff.set(r.staffId, [...(byStaff.get(r.staffId) ?? []), r]);
  for (const [staffId, list] of byStaff) {
    const cur = rateAsOf(list, today);
    if (!cur) continue;
    const patch = Object.fromEntries(RATE_COLUMNS.map((k) => [k, cur[k]])) as Pick<typeof cur, (typeof RATE_COLUMNS)[number]>;
    await tx.update(schema.staff).set(patch).where(eq(schema.staff.id, staffId));
  }
}

/** Rates in force on `asOf` for each staff member, plus changes that fell inside [start, asOf]. */
export async function ratesForPeriod(tx: TenantDb, staffIds: string[], start: string, asOf: string) {
  if (!staffIds.length) return { byStaff: new Map<string, PayRateRow>(), changes: [] as { staffId: string; effectiveFrom: string }[] };
  const rows = await tx.select().from(schema.staffPayRates).where(inArray(schema.staffPayRates.staffId, staffIds));
  const byStaff = new Map<string, PayRateRow>();
  const changes: { staffId: string; effectiveFrom: string }[] = [];
  for (const id of staffIds) {
    const list = rows.filter((r) => r.staffId === id);
    const cur = rateAsOf(list, asOf);
    if (cur) byStaff.set(id, cur);
    const first = list.reduce<(typeof list)[number] | null>((m, r) => (!m || r.effectiveFrom < m.effectiveFrom ? r : m), null);
    for (const r of list) if (r !== first && r.effectiveFrom >= start && r.effectiveFrom <= asOf) changes.push({ staffId: id, effectiveFrom: r.effectiveFrom });
  }
  return { byStaff, changes };
}
