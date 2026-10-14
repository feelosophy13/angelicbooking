/**
 * Clock-in kiosk: a QR code printed at each location opens /clock/<token>; a
 * staff member types their PIN to clock in or out. No login needed, so front
 * desk staff and providers without an app account can use a shared phone or
 * tablet. PINs are stored hashed per business; the kiosk is rate limited.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema, withJobs, withTenant, type TenantDb } from "@angelic/db";
import { instantToISODate } from "@angelic/core";
import { tzFor } from "./locations";

export class ClockError extends Error {}

export function hashPin(businessId: string, pin: string): string {
  return createHash("sha256").update(`${businessId}:${pin.trim()}`).digest("hex");
}

export const PIN_RE = /^\d{4,6}$/;

/** Set (or clear) a staff member's kiosk PIN. Refuses a PIN another colleague already uses. */
export async function setClockPin(businessId: string, staffId: string, pin: string | null): Promise<void> {
  if (pin !== null && !PIN_RE.test(pin)) throw new ClockError("PIN must be 4 to 6 digits.");
  const hash = pin === null ? null : hashPin(businessId, pin);
  await withTenant(businessId, async (tx) => {
    if (hash) {
      const clash = await tx.query.staff.findFirst({ where: and(eq(schema.staff.clockPinHash, hash), eq(schema.staff.active, true)) });
      if (clash && clash.id !== staffId) throw new ClockError("That PIN is already in use by someone else. Pick another.");
    }
    await tx.update(schema.staff).set({ clockPinHash: hash }).where(eq(schema.staff.id, staffId));
  });
}

export function randomPin(): string {
  return String(1000 + (randomBytes(2).readUInt16BE(0) % 9000));
}

/** The kiosk token for a location, created on first use. */
export async function ensureClockToken(businessId: string, locationId: string): Promise<string> {
  return withTenant(businessId, async (tx) => {
    const l = await tx.query.locations.findFirst({ where: eq(schema.locations.id, locationId), columns: { clockToken: true } });
    if (l?.clockToken) return l.clockToken;
    const token = randomBytes(18).toString("base64url");
    await tx.update(schema.locations).set({ clockToken: token }).where(eq(schema.locations.id, locationId));
    return token;
  });
}

export async function resetClockToken(businessId: string, locationId: string): Promise<string> {
  await withTenant(businessId, (tx) => tx.update(schema.locations).set({ clockToken: null }).where(eq(schema.locations.id, locationId)));
  return ensureClockToken(businessId, locationId);
}

/** Public: which business/location a kiosk token belongs to (read with the jobs policy, no tenant yet). */
export async function resolveClock(token: string) {
  if (!/^[A-Za-z0-9_-]{16,}$/.test(token)) return null;
  const location = await withJobs((tx) => tx.query.locations.findFirst({ where: eq(schema.locations.clockToken, token) }));
  if (!location) return null;
  const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, location.businessId) });
  return business && !business.suspendedAt ? { business, location } : null;
}

export type Punch = { staffName: string; action: "in" | "out"; at: Date; minutes: number | null; timeZone: string };

/** Longest shift a single clock-in can record. Anything longer was a forgotten clock-out. */
export const MAX_SHIFT_MIN = 14 * 60;

/**
 * The staff member's open entry, if any. An entry left open longer than a full
 * shift is closed at the cap and marked, so the next punch starts fresh instead
 * of booking days of hours.
 */
export async function openEntryFor(tx: TenantDb, staffId: string, now: Date) {
  const open = await tx.query.timeEntries.findFirst({ where: and(eq(schema.timeEntries.staffId, staffId), isNull(schema.timeEntries.clockOutAt), eq(schema.timeEntries.minutes, 0)) });
  if (!open?.clockInAt) return null;
  const elapsed = (now.getTime() - open.clockInAt.getTime()) / 60_000;
  if (elapsed <= MAX_SHIFT_MIN) return open;
  await tx
    .update(schema.timeEntries)
    .set({ clockOutAt: new Date(open.clockInAt.getTime() + MAX_SHIFT_MIN * 60_000), minutes: MAX_SHIFT_MIN, note: [open.note, "Auto clock-out: forgot to clock out"].filter(Boolean).join(" · ") })
    .where(eq(schema.timeEntries.id, open.id));
  return null;
}

/** Clock the PIN's owner in (no open entry) or out (closes the open entry). */
export async function punchWithPin(token: string, pin: string): Promise<Punch> {
  const kiosk = await resolveClock(token);
  if (!kiosk) throw new ClockError("This clock-in code is no longer valid. Ask a manager for the current one.");
  if (!PIN_RE.test(pin)) throw new ClockError("Enter your 4 to 6 digit PIN.");
  const { business, location } = kiosk;
  const hash = hashPin(business.id, pin);
  const now = new Date();
  const tz = tzFor(business, location);
  return withTenant(business.id, async (tx) => {
    const person = await tx.query.staff.findFirst({ where: and(eq(schema.staff.clockPinHash, hash), eq(schema.staff.active, true)) });
    if (!person) throw new ClockError("PIN not recognised.");
    const open = await openEntryFor(tx, person.id, now);
    if (open?.clockInAt) {
      const minutes = Math.max(1, Math.round((now.getTime() - open.clockInAt.getTime()) / 60_000));
      await tx.update(schema.timeEntries).set({ clockOutAt: now, minutes }).where(eq(schema.timeEntries.id, open.id));
      return { staffName: person.displayName, action: "out", at: now, minutes, timeZone: tz };
    }
    await tx.insert(schema.timeEntries).values({ businessId: business.id, staffId: person.id, date: instantToISODate(now, tz), minutes: 0, clockInAt: now, locationId: location.id, note: "Kiosk" });
    return { staffName: person.displayName, action: "in", at: now, minutes: null, timeZone: tz };
  });
}
