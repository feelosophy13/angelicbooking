/**
 * Finalized pay periods are closed books. Anything that would change what one of them paid (hours or an adjustment dated inside it, a pay
 * rate starting on or before its last day) is refused with a message saying where it should go instead. Refunds never touch them: they
 * are booked on the day they happen (server/payroll.ts).
 */
import { and, desc, gte, lte } from "drizzle-orm";
import { schema, type TenantDb } from "@angelic/db";

export class PayrollLockedError extends Error {}

/** The finalized period containing `date`, if there is one. */
export async function finalizedPeriodOn(tx: TenantDb, date: string) {
  return tx.query.payrollRuns.findFirst({ where: and(lte(schema.payrollRuns.periodStart, date), gte(schema.payrollRuns.periodEnd, date)), columns: { periodStart: true, periodEnd: true } });
}

/** Refuse a change to hours or adjustments dated inside a finalized period. */
export async function assertPeriodOpen(tx: TenantDb, date: string, what: string) {
  const run = await finalizedPeriodOn(tx, date);
  if (run) throw new PayrollLockedError(`${what} on ${date} falls in the pay period ${run.periodStart} to ${run.periodEnd}, which is finalized. Put the correction in the current period as an adjustment instead.`);
}

/**
 * Refuse a pay change that would reach back into a finalized period. A period is paid at the settings in force on its last day, so a
 * change starting on or before the end of any finalized period would rewrite it.
 */
export async function assertRateChangeOpen(tx: TenantDb, effectiveFrom: string) {
  const [last] = await tx.select({ end: schema.payrollRuns.periodEnd }).from(schema.payrollRuns).where(gte(schema.payrollRuns.periodEnd, effectiveFrom)).orderBy(desc(schema.payrollRuns.periodEnd)).limit(1);
  if (last) throw new PayrollLockedError(`Pay is finalized through ${last.end}, so a change can't start on ${effectiveFrom}. Start it after ${last.end}, or add an adjustment for the difference.`);
}
