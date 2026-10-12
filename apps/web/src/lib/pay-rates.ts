/** Pure helpers for effective-dated pay settings. */

export interface PayRateRow {
  effectiveFrom: string; // YYYY-MM-DD
  payType: "commission" | "hourly" | "salary";
  mainCommissionBps: number;
  productCommissionBps: number;
  ccTipFeeBps: number;
  hourlyRateCents: number;
  salaryPerPeriodCents: number;
  overtimeOverride: boolean | null;
  taxDeductionCents: number | null;
  taxDeductionBps: number | null;
}

/** The row in force on `date`: the latest one that starts on or before it. Null when none has started yet. */
export function rateAsOf<T extends PayRateRow>(rows: T[], date: string): T | null {
  let best: T | null = null;
  for (const r of rows) if (r.effectiveFrom <= date && (!best || r.effectiveFrom > best.effectiveFrom)) best = r;
  return best;
}

/** Rows that start inside [start, end] but are not the first one ever: a change happened during the period. */
export function changesWithin<T extends PayRateRow>(rows: T[], start: string, end: string): T[] {
  const first = rows.reduce<T | null>((m, r) => (!m || r.effectiveFrom < m.effectiveFrom ? r : m), null);
  return rows.filter((r) => r !== first && r.effectiveFrom >= start && r.effectiveFrom <= end).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

/** "Commission · 45% service · 5% product · $20.00/h" for a history list. */
export function describeRate(r: PayRateRow, money: (cents: number) => string): string {
  const parts: string[] = [r.payType === "commission" ? "Commission" : r.payType === "hourly" ? "Hourly" : "Salary"];
  if (r.payType === "hourly" || r.hourlyRateCents) parts.push(`${money(r.hourlyRateCents)}/h`);
  if (r.payType === "salary" || r.salaryPerPeriodCents) parts.push(`${money(r.salaryPerPeriodCents)} per period`);
  if (r.mainCommissionBps) parts.push(`${r.mainCommissionBps / 100}% service`);
  if (r.productCommissionBps) parts.push(`${r.productCommissionBps / 100}% product`);
  if (r.ccTipFeeBps) parts.push(`${r.ccTipFeeBps / 100}% card-tip fee`);
  if (r.overtimeOverride != null) parts.push(r.overtimeOverride ? "overtime on" : "no overtime");
  if (r.taxDeductionCents != null) parts.push(`${money(r.taxDeductionCents)} withheld`);
  else if (r.taxDeductionBps != null) parts.push(`${r.taxDeductionBps / 100}% withheld`);
  return parts.join(" · ");
}

/** Fields that differ between two rows, for the activity log. */
export function rateDiff(before: PayRateRow | null, after: PayRateRow): Record<string, { from: unknown; to: unknown }> {
  const keys: (keyof PayRateRow)[] = ["payType", "mainCommissionBps", "productCommissionBps", "ccTipFeeBps", "hourlyRateCents", "salaryPerPeriodCents", "overtimeOverride", "taxDeductionCents", "taxDeductionBps"];
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of keys) if (!before || before[k] !== after[k]) out[k] = { from: before ? before[k] : null, to: after[k] };
  return out;
}
