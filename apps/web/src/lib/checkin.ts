/**
 * Rules for the client self check-in kiosk that don't need the database, so they are unit tested: what a typed number may be,
 * how a matched client is named on a shared screen, and whether a visit can be checked in now.
 */

export type CheckinTiming = "ready" | "early" | "late";

/** How many digits the client may type: the last four of their mobile number, or the whole number. */
export function checkinDigits(raw: string): { digits: string; full: boolean } | null {
  const d = raw.replace(/\D/g, "");
  if (d.length === 4) return { digits: d, full: false };
  // A full US/CA number, with or without the leading 1; matched on its last ten digits so "+1 555…" and "555…" on file both match.
  if (d.length === 10) return { digits: d, full: true };
  if (d.length === 11 && d.startsWith("1")) return { digits: d.slice(1), full: true };
  return null;
}

/** First name and last initial, the most a stranger behind the client could read off the screen ("Jane S."). */
export function kioskName(firstName: string, lastName: string | null | undefined): string {
  const first = firstName.trim() || "Guest";
  const initial = (lastName ?? "").trim().charAt(0).toUpperCase();
  return initial ? `${first} ${initial}.` : first;
}

/**
 * Whether a visit can be checked in at `now`: from `earlyMinutes` before it starts until it ends. Earlier or after the end, the
 * client is sent to the front desk instead (a wrong day, a missed visit, or someone else's number).
 */
export function checkinTiming(startAt: Date, endAt: Date, now: Date, earlyMinutes: number): CheckinTiming {
  if (now.getTime() < startAt.getTime() - Math.max(0, earlyMinutes) * 60_000) return "early";
  if (now.getTime() > endAt.getTime()) return "late";
  return "ready";
}

/** Of a client's visits today (in start order), the one they are arriving for: the first that hasn't ended, else the last. */
export function pickVisit<T extends { startAt: Date; endAt: Date }>(visits: T[], now: Date): T | null {
  const sorted = [...visits].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  return sorted.find((v) => v.endAt.getTime() > now.getTime()) ?? sorted[sorted.length - 1] ?? null;
}

/** How long the kiosk waits on a screen with nobody touching it before going back to Welcome (forms get longer). */
export const KIOSK_IDLE_MS = 60_000;
export const KIOSK_FORM_IDLE_MS = 4 * 60_000;
/** How long the "You're checked in" screen stays up. */
export const KIOSK_DONE_MS = 8_000;
