import { addMinutes } from "./time";

export interface BookingPolicy {
  minNoticeMin: number;
  maxAdvanceDays: number;
  cancelWindowHours: number;
}

/** Earliest and latest instants a client may book online, relative to `now`. */
export function onlineBookingWindow(now: Date, policy: BookingPolicy): { notBefore: Date; notAfter: Date } {
  return {
    notBefore: addMinutes(now, Math.max(0, policy.minNoticeMin)),
    notAfter: addMinutes(now, Math.max(1, policy.maxAdvanceDays) * 24 * 60),
  };
}

export function isWithinBookingWindow(start: Date, now: Date, policy: BookingPolicy): boolean {
  const w = onlineBookingWindow(now, policy);
  return start >= w.notBefore && start <= w.notAfter;
}

/** Clients may cancel / reschedule themselves until `cancelWindowHours` before the start. */
export function canClientCancel(start: Date, now: Date, policy: Pick<BookingPolicy, "cancelWindowHours">): boolean {
  return start.getTime() - now.getTime() >= Math.max(0, policy.cancelWindowHours) * 3_600_000;
}

/** Normalise a phone number to E.164 for the US/CA default; returns null if it can't. */
export function normalizePhone(input: string | null | undefined, defaultCountry = "1"): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return `+${defaultCountry}${digits}`;
  if (digits.length === 11 && digits.startsWith(defaultCountry)) return `+${digits}`;
  if (input.trim().startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}
