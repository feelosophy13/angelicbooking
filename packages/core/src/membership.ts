/**
 * Membership billing periods. A plan is billed every `count` × `interval`
 * (weekly, every 2 weeks, monthly, quarterly, yearly…). Months are calendar
 * months so a plan sold on the 31st lands on the last day of shorter months
 * instead of drifting a day or two each cycle.
 */

export type MembershipInterval = "week" | "month" | "year";

export const MEMBERSHIP_INTERVALS: MembershipInterval[] = ["week", "month", "year"];

/** Stripe bills at most once a year apart, so the count is capped per unit. */
export const MAX_INTERVAL_COUNT: Record<MembershipInterval, number> = { week: 52, month: 12, year: 1 };

/** Check an "every N units" cadence; returns a message when it is not billable. */
export function cadenceError(interval: unknown, count: number): string | null {
  if (!isMembershipInterval(interval)) return "Pick weeks, months or years";
  if (!Number.isInteger(count) || count < 1) return "Enter how many";
  if (count > MAX_INTERVAL_COUNT[interval]) return interval === "year" ? "Yearly plans bill once a year" : `At most ${MAX_INTERVAL_COUNT[interval]} ${interval}s apart`;
  return null;
}

export function isMembershipInterval(x: unknown): x is MembershipInterval {
  return x === "week" || x === "month" || x === "year";
}

/** `from` plus one billing period. */
export function addMembershipPeriod(from: Date, interval: MembershipInterval, count = 1, periods = 1): Date {
  const n = Math.max(1, count) * Math.max(1, periods);
  const d = new Date(from.getTime());
  if (interval === "week") {
    d.setUTCDate(d.getUTCDate() + 7 * n);
    return d;
  }
  const months = interval === "year" ? 12 * n : n;
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** `from` minus one billing period (taking back a refunded renewal). */
export function subtractMembershipPeriod(from: Date, interval: MembershipInterval, count = 1): Date {
  const n = Math.max(1, count);
  const d = new Date(from.getTime());
  if (interval === "week") {
    d.setUTCDate(d.getUTCDate() - 7 * n);
    return d;
  }
  const months = interval === "year" ? 12 * n : n;
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** "month", "2 weeks", "year" — for "$99 / month". */
export function periodNoun(interval: MembershipInterval, count = 1): string {
  return count > 1 ? `${count} ${interval}s` : interval;
}

/** "per month", "every 2 weeks", "per year" — for "2 fills per month". */
export function periodLabel(interval: MembershipInterval, count = 1): string {
  if (count > 1) return `every ${count} ${interval}s`;
  return interval === "week" ? "per week" : interval === "month" ? "per month" : "per year";
}

/** Credits after a renewal: the new period's sessions plus whatever may carry over. */
export function renewedCredits(remaining: number, included: number, rolloverCap: number): number {
  return included + Math.min(Math.max(0, remaining), Math.max(0, rolloverCap));
}
