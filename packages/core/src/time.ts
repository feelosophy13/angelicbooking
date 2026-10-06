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
