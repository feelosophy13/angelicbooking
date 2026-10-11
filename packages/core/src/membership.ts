/**
 * Membership billing periods. A plan is billed every `count` × `interval`
 * (weekly, every 2 weeks, monthly, quarterly, yearly…). Months are calendar
 * months so a plan sold on the 31st lands on the last day of shorter months
 * instead of drifting a day or two each cycle.
 */

export type MembershipInterval = "week" | "month" | "year";

export const MEMBERSHIP_INTERVALS: MembershipInterval[] = ["week", "month", "year"];

/** The cadences offered in the plan form, as "interval:count" keys. */
export const MEMBERSHIP_CADENCES: { key: string; interval: MembershipInterval; count: number; label: string }[] = [
  { key: "week:1", interval: "week", count: 1, label: "Every week" },
  { key: "week:2", interval: "week", count: 2, label: "Every 2 weeks" },
  { key: "week:3", interval: "week", count: 3, label: "Every 3 weeks" },
  { key: "month:1", interval: "month", count: 1, label: "Every month" },
  { key: "week:5", interval: "week", count: 5, label: "Every 5 weeks" },
  { key: "week:6", interval: "week", count: 6, label: "Every 6 weeks" },
  { key: "month:3", interval: "month", count: 3, label: "Every 3 months" },
  { key: "month:6", interval: "month", count: 6, label: "Every 6 months" },
  { key: "year:1", interval: "year", count: 1, label: "Every year" },
];

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
