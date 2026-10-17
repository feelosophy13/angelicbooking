import { TZDate } from "@date-fns/tz";

export type LocalTime = `${number}${number}:${number}${number}` | string; // "HH:mm" or "HH:mm:ss"
export type ISODate = string; // "YYYY-MM-DD"

export function parseLocalTime(t: LocalTime): { h: number; m: number } {
  const [hh, mm] = t.split(":");
  const h = Number(hh);
  const m = Number(mm ?? 0);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 24 || m < 0 || m > 59) {
    throw new Error(`invalid local time: ${t}`);
  }
  return { h, m };
}

export function parseISODate(d: ISODate): { y: number; mo: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) throw new Error(`invalid ISO date: ${d}`);
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
}

/** Instant for a wall-clock time on a calendar date in an IANA timezone. */
export function zonedToInstant(date: ISODate, time: LocalTime, timeZone: string): Date {
  const { y, mo, d } = parseISODate(date);
  const { h, m } = parseLocalTime(time);
  return new Date(new TZDate(y, mo - 1, d, h, m, 0, 0, timeZone).getTime());
}

/** The end of a working block as an instant: "24:00" is midnight at the start of the next day. */
export function blockEndInstant(date: ISODate, end: LocalTime, timeZone: string): Date {
  if (end !== "24:00") return zonedToInstant(date, end, timeZone);
  const { y, mo, d } = parseISODate(date);
  return zonedToInstant(new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10), "00:00", timeZone);
}

/** Calendar date (YYYY-MM-DD) of an instant as seen in a timezone. */
export function instantToISODate(at: Date, timeZone: string): ISODate {
  const z = new TZDate(at.getTime(), timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${z.getFullYear()}-${pad(z.getMonth() + 1)}-${pad(z.getDate())}`;
}

/** 0 = Sunday ... 6 = Saturday for a calendar date (independent of timezone). */
export function weekdayOf(date: ISODate): number {
  const { y, mo, d } = parseISODate(date);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

export function addMinutes(at: Date, min: number): Date {
  return new Date(at.getTime() + min * 60_000);
}

export const minutesBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60_000);

/** Local wall-clock time ("HH:mm") of an instant as seen in a timezone. */
export function instantToLocalTime(at: Date, timeZone: string): string {
  const z = new TZDate(at.getTime(), timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(z.getHours())}:${pad(z.getMinutes())}`;
}

/**
 * The same wall-clock time `weeks` weeks later in a timezone (so a 10:00
 * standing appointment stays at 10:00 across a daylight-saving change).
 */
export function addWeeksSameLocalTime(at: Date, weeks: number, timeZone: string): Date {
  const z = new TZDate(at.getTime(), timeZone);
  const moved = new TZDate(z.getFullYear(), z.getMonth(), z.getDate() + weeks * 7, z.getHours(), z.getMinutes(), 0, 0, timeZone);
  return new Date(moved.getTime());
}

/** Start instants for a standing series: the first plus `occurrences - 1` repeats every `intervalWeeks`. */
export function seriesOccurrences(first: Date, intervalWeeks: number, occurrences: number, timeZone: string): Date[] {
  const n = Math.max(1, Math.min(52, Math.floor(occurrences)));
  const step = Math.max(1, Math.floor(intervalWeeks));
  return Array.from({ length: n }, (_, i) => (i === 0 ? first : addWeeksSameLocalTime(first, i * step, timeZone)));
}
