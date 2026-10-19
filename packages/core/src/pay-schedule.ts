/**
 * Pay schedules: how a business cuts the calendar into pay periods, and how a salary
 * that is "per pay period" is shared out when a run does not line up with one.
 *
 *   weekly       7 days from the anchor (any period start)
 *   biweekly     14 days from the anchor
 *   semimonthly  the 1st–15th and the 16th–end of each month
 *   monthly      the 1st–end of each month
 *
 * Dates are business-local YYYY-MM-DD strings; nothing here looks at a time zone.
 */

export type PayFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly";

export interface PaySchedule {
  frequency: PayFrequency;
  /** The first day of any period, for weekly and biweekly. Ignored by the calendar frequencies. */
  anchor: string | null;
}

export interface DateRange {
  start: string;
  end: string;
}

export const PAY_FREQUENCY_LABEL: Record<PayFrequency, string> = { weekly: "Weekly", biweekly: "Every two weeks", semimonthly: "Twice a month (1st–15th, 16th–end)", monthly: "Monthly" };

const toDays = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return Math.round(Date.UTC(y!, m! - 1, day!) / 86_400_000);
};
const fromDays = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => fromDays(toDays(d) + n);
/** Inclusive length of a range in days. */
export const spanDays = (r: DateRange) => toDays(r.end) - toDays(r.start) + 1;

const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based
const ym = (d: string) => ({ y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)), day: Number(d.slice(8, 10)) });
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** The scheduled period that contains `date`. */
export function periodContaining(s: PaySchedule, date: string): DateRange {
  if (s.frequency === "monthly") {
    const { y, m } = ym(date);
    return { start: iso(y, m, 1), end: iso(y, m, lastDayOfMonth(y, m)) };
  }
  if (s.frequency === "semimonthly") {
    const { y, m, day } = ym(date);
    return day <= 15 ? { start: iso(y, m, 1), end: iso(y, m, 15) } : { start: iso(y, m, 16), end: iso(y, m, lastDayOfMonth(y, m)) };
  }
  const len = s.frequency === "weekly" ? 7 : 14;
  const anchor = toDays(s.anchor ?? date);
  const n = Math.floor((toDays(date) - anchor) / len);
  const start = anchor + n * len;
  return { start: fromDays(start), end: fromDays(start + len - 1) };
}

export function nextPeriod(s: PaySchedule, p: DateRange): DateRange {
  return periodContaining(s, addDays(p.end, 1));
}

export function previousPeriod(s: PaySchedule, p: DateRange): DateRange {
  return periodContaining(s, addDays(p.start, -1));
}

/** True when `r` is exactly one scheduled period. */
export function isScheduledPeriod(s: PaySchedule, r: DateRange): boolean {
  const p = periodContaining(s, r.start);
  return p.start === r.start && p.end === r.end;
}

/**
 * How much of a "per pay period" salary a run covers: for each scheduled period the run touches, the share of that
 * period's days inside the run, added up. A run that is exactly one period pays 1; the first half of a 14-day period
 * pays 0.5; two whole periods pay 2. Also returns the pieces, for the "prorated" note on the page.
 */
export function salaryShare(s: PaySchedule, r: DateRange): { share: number; pieces: { period: DateRange; coveredDays: number; periodDays: number }[] } {
  const pieces: { period: DateRange; coveredDays: number; periodDays: number }[] = [];
  let p = periodContaining(s, r.start);
  let guard = 0;
  while (p.start <= r.end && guard++ < 400) {
    const from = p.start > r.start ? p.start : r.start;
    const to = p.end < r.end ? p.end : r.end;
    pieces.push({ period: p, coveredDays: spanDays({ start: from, end: to }), periodDays: spanDays(p) });
    p = nextPeriod(s, p);
  }
  return { share: pieces.reduce((n, x) => n + x.coveredDays / x.periodDays, 0), pieces };
}

/** Salary for a run: the per-period amount times the share of scheduled periods it covers, rounded to the cent. */
export function proratedSalary(perPeriodCents: number, share: number): number {
  return Math.round(perPeriodCents * share);
}

/** Two inclusive ranges share at least one day. */
export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.start <= b.end && b.start <= a.end;
}

/** "July 12 2026 - July 25 2026", the owner's period label. */
export function payPeriodLabel(r: DateRange): string {
  const f = (d: string) => {
    const { y, m, day } = ym(d);
    return `${new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, day)))} ${day} ${y}`;
  };
  return `${f(r.start)} - ${f(r.end)}`;
}
