/**
 * Client self check-in kiosk: a tablet at the front door opens /checkin/<token> for its location (Settings → Check-in kiosk). An
 * arriving client types their mobile number (the last four digits or all of it), sees their own visit as "Jane S. · Balayage with
 * Maria · 2:00 PM", fills in any forms due and checks in. The token can do only that: find today's visits at its location by phone,
 * check the matched visit in and take its forms. Nothing is listed before a match, lookups are rate limited per kiosk, and every
 * write re-checks the number against the visit, so an appointment id alone is worth nothing. A new token unpairs a lost tablet.
 */
import { randomBytes } from "node:crypto";
import { and, asc, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db, schema, withJobs, withTenant } from "@angelic/db";
import { instantToISODate, normalizePhone, zonedToInstant } from "@angelic/core";
import { checkinDigits, checkinTiming, kioskName, pickVisit, type CheckinTiming } from "@/lib/checkin";
import { sameClientName } from "@/lib/client-match";
import { sharedRateLimit } from "@/lib/shared-rate-limit";
import { auditEvent } from "@/lib/audit";
import { shiftISODate } from "@/lib/utils";
import { tzFor } from "./locations";
import { setAppointmentStatus, BookingError } from "./booking";
import { answersFromFormData, formsForAppointment, FormSubmitError, submitForm } from "./forms";

export class CheckinError extends Error {}

/** Per kiosk, in ten minutes: lookups of any kind, and numbers that matched nobody. */
export const LOOKUP_LIMIT = 60;
export const MISS_LIMIT = 15;
const WINDOW_MS = 10 * 60_000;

/* ---------- Settings: turn on, new link (unpair), turn off ---------- */

export async function enableCheckin(businessId: string, locationId: string): Promise<string> {
  return withTenant(businessId, async (tx) => {
    const l = await tx.query.locations.findFirst({ where: eq(schema.locations.id, locationId), columns: { checkinToken: true } });
    if (!l) throw new CheckinError("Location not found.");
    if (l.checkinToken) return l.checkinToken;
    const token = randomBytes(18).toString("base64url");
    await tx.update(schema.locations).set({ checkinToken: token }).where(eq(schema.locations.id, locationId));
    return token;
  });
}

export async function disableCheckin(businessId: string, locationId: string): Promise<void> {
  await withTenant(businessId, (tx) => tx.update(schema.locations).set({ checkinToken: null }).where(eq(schema.locations.id, locationId)));
}

/** A new address for the kiosk: the tablet holding the old one (a lost or stolen one) stops working at once. */
export async function resetCheckin(businessId: string, locationId: string): Promise<string> {
  await disableCheckin(businessId, locationId);
  return enableCheckin(businessId, locationId);
}

/** Public: the business and location a kiosk token belongs to (read with the jobs policy, no tenant yet). Null when off or unknown. */
export async function resolveCheckin(token: string) {
  if (!/^[A-Za-z0-9_-]{16,}$/.test(token)) return null;
  const location = await withJobs((tx) => tx.query.locations.findFirst({ where: eq(schema.locations.checkinToken, token) }));
  if (!location) return null;
  const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, location.businessId) });
  return business && !business.suspendedAt ? { business, location } : null;
}

/* ---------- Lookup ---------- */

export type KioskForm = { id: string; name: string; description: string | null; fields: (typeof schema.forms.$inferSelect)["fields"]; requireSignature: boolean };

/** One matched person as the kiosk may show them: no last name, no number, no notes or price. */
export type KioskVisit = {
  appointmentId: string;
  name: string;
  startAt: string;
  timeZone: string;
  /** "Balayage with Maria", one per service. */
  services: string[];
  state: CheckinTiming | "already";
  /** Forms still due for this visit; only sent while it can be checked in. */
  formsDue: KioskForm[];
};

export type Lookup = { kind: "none" } | { kind: "need_full" } | { kind: "found"; people: KioskVisit[] };

type Kiosk = NonNullable<Awaited<ReturnType<typeof resolveCheckin>>>;

/** Today's visits at the kiosk's location whose client's phone ends in `digits`, grouped per client. */
async function visitsFor(kiosk: Kiosk, digits: string, now: Date) {
  const { business, location } = kiosk;
  const tz = tzFor(business, location);
  const today = instantToISODate(now, tz);
  const from = zonedToInstant(today, "00:00", tz);
  const to = zonedToInstant(shiftISODate(today, 1), "00:00", tz);
  const phoneDigits = sql<string>`regexp_replace(coalesce(${schema.clients.phone}, ''), '[^0-9]', '', 'g')`;
  // A visit with no location belongs to the default site (single-location businesses booked before locations existed).
  const here = location.isDefault ? or(eq(schema.appointments.locationId, location.id), isNull(schema.appointments.locationId)) : eq(schema.appointments.locationId, location.id);
  const rows = await withTenant(business.id, (tx) =>
    tx
      .select({
        appointmentId: schema.appointments.id,
        status: schema.appointments.status,
        clientId: schema.clients.id,
        firstName: schema.clients.firstName,
        lastName: schema.clients.lastName,
        startAt: schema.appointmentItems.startAt,
        endAt: schema.appointmentItems.endAt,
        serviceName: schema.appointmentItems.serviceName,
        staffName: schema.staff.displayName,
      })
      .from(schema.appointmentItems)
      .innerJoin(schema.appointments, eq(schema.appointments.id, schema.appointmentItems.appointmentId))
      .innerJoin(schema.clients, eq(schema.clients.id, schema.appointments.clientId))
      .leftJoin(schema.staff, eq(schema.staff.id, schema.appointmentItems.staffId))
      .where(
        and(
          eq(schema.appointments.kind, "visit"),
          inArray(schema.appointments.status, ["booked", "confirmed", "checked_in", "in_progress"]),
          ne(schema.appointmentItems.status, "cancelled"),
          gte(schema.appointmentItems.startAt, from),
          lt(schema.appointmentItems.startAt, to),
          here,
          sql`${phoneDigits} like ${"%" + digits}`,
        ),
      )
      .orderBy(asc(schema.appointmentItems.startAt)),
  );
  const byClient = new Map<string, { clientId: string; firstName: string; lastName: string | null; visits: Map<string, { appointmentId: string; status: string; startAt: Date; endAt: Date; services: string[] }> }>();
  for (const r of rows) {
    const c = byClient.get(r.clientId) ?? { clientId: r.clientId, firstName: r.firstName, lastName: r.lastName, visits: new Map() };
    byClient.set(r.clientId, c);
    const v = c.visits.get(r.appointmentId) ?? { appointmentId: r.appointmentId, status: r.status, startAt: r.startAt, endAt: r.endAt, services: [] };
    if (r.startAt < v.startAt) v.startAt = r.startAt;
    if (r.endAt > v.endAt) v.endAt = r.endAt;
    const staffFirst = r.staffName?.trim().split(/\s+/)[0];
    v.services.push(staffFirst ? `${r.serviceName} with ${staffFirst}` : r.serviceName);
    c.visits.set(r.appointmentId, v);
  }
  return { tz, clients: [...byClient.values()] };
}

/** What the kiosk shows for a client: the visit they are arriving for and whether it can be checked in now. */
async function shape(kiosk: Kiosk, c: Awaited<ReturnType<typeof visitsFor>>["clients"][number], tz: string, now: Date): Promise<KioskVisit | null> {
  const v = pickVisit([...c.visits.values()], now);
  if (!v) return null;
  const state: KioskVisit["state"] = v.status === "checked_in" || v.status === "in_progress" ? "already" : checkinTiming(v.startAt, v.endAt, now, kiosk.business.checkinEarlyMinutes);
  const formsDue = state === "ready" ? (await withTenant(kiosk.business.id, (tx) => formsForAppointment(tx, v.appointmentId))).filter((f) => !f.current).map(({ form }) => ({ id: form.id, name: form.name, description: form.description, fields: form.fields, requireSignature: form.requireSignature })) : [];
  return { appointmentId: v.appointmentId, name: kioskName(c.firstName, c.lastName), startAt: v.startAt.toISOString(), timeZone: tz, services: v.services, state, formsDue };
}

const TOO_MANY = "Too many tries on this kiosk. Please see the front desk.";

/** Numbers that matched nobody on this kiosk in the current window (read only; `spend` counts them). */
async function missesSoFar(token: string): Promise<number> {
  const rows = (await db.execute(sql`select count from api_rate_limits where key = ${`checkin-miss:${token}`} and reset_at > now()`)) as unknown as { count: number }[];
  return Number(rows[0]?.count ?? 0);
}

/**
 * Before a lookup: once the kiosk has used up its misses, every lookup is refused until the window passes, matches included, so
 * guessing can't carry on until a number happens to hit.
 */
async function assertNotLocked(token: string) {
  if ((await missesSoFar(token)) >= MISS_LIMIT) throw new CheckinError(TOO_MANY);
}

/** Count one more try against the kiosk; a miss also counts against the (smaller) miss allowance. */
async function spend(token: string, miss: boolean) {
  if (!(await sharedRateLimit(`checkin-lookup:${token}`, LOOKUP_LIMIT, WINDOW_MS)).ok) throw new CheckinError(TOO_MANY);
  if (miss) await sharedRateLimit(`checkin-miss:${token}`, MISS_LIMIT, WINDOW_MS);
}

/**
 * Find the client's visit today by phone. Four digits that fit more than one client ask for the full number; a full number shared by
 * a family lists each person (first name and initial only) so the right one can tap their own.
 */
export async function lookupCheckin(token: string, raw: string, now = new Date()): Promise<Lookup> {
  const kiosk = await resolveCheckin(token);
  if (!kiosk) throw new CheckinError("This kiosk is no longer set up. Please see the front desk.");
  const typed = checkinDigits(raw);
  if (!typed) throw new CheckinError("Enter the last 4 digits of your mobile number, or the whole number.");
  await assertNotLocked(token);
  const { tz, clients } = await visitsFor(kiosk, typed.digits, now);
  await spend(token, clients.length === 0);
  if (!clients.length) return { kind: "none" };
  if (clients.length > 1 && !typed.full) return { kind: "need_full" };
  const people = (await Promise.all(clients.map((c) => shape(kiosk, c, tz, now)))).filter((p): p is KioskVisit => !!p);
  return people.length ? { kind: "found", people } : { kind: "none" };
}

/** The visit as the kiosk may act on it: the number must still match it, today, here. Throws a polite message otherwise. */
async function matched(token: string, raw: string, appointmentId: string, now: Date) {
  const kiosk = await resolveCheckin(token);
  if (!kiosk) throw new CheckinError("This kiosk is no longer set up. Please see the front desk.");
  const typed = checkinDigits(raw);
  if (!typed) throw new CheckinError("Please start again.");
  await assertNotLocked(token);
  const { tz, clients } = await visitsFor(kiosk, typed.digits, now);
  const c = clients.find((x) => x.visits.has(appointmentId));
  if (!c || (clients.length > 1 && !typed.full)) {
    await spend(token, true);
    throw new CheckinError("We couldn't match that visit. Please see the front desk.");
  }
  const visit = await shape(kiosk, c, tz, now);
  if (!visit || visit.appointmentId !== appointmentId) throw new CheckinError("Please start again.");
  return { kiosk, client: c, visit };
}

export type CheckedIn = { name: string; startAt: string; timeZone: string; services: string[]; already: boolean };

/**
 * Check the matched visit in, the same as the desk's Check in button (status, its activity row, the calendar). Refuses outside the
 * business's window and when forms are still due, unless the client chose to do them at the desk (`skipForms`).
 */
export async function kioskCheckIn(token: string, raw: string, appointmentId: string, opts: { skipForms?: boolean } = {}, now = new Date()): Promise<CheckedIn> {
  const { kiosk, visit } = await matched(token, raw, appointmentId, now);
  const out = { name: visit.name, startAt: visit.startAt, timeZone: visit.timeZone, services: visit.services };
  if (visit.state === "already") return { ...out, already: true };
  if (visit.state !== "ready") throw new CheckinError("Please see the front desk to check in.");
  if (visit.formsDue.length && !opts.skipForms) throw new CheckinError("Please fill in your forms first.");
  try {
    // "client" in the log reads as "the client checked in at the kiosk" on the appointment's activity.
    const changed = await setAppointmentStatus(kiosk.business.id, appointmentId, "checked_in", "client");
    return { ...out, already: !changed };
  } catch (e) {
    if (e instanceof BookingError) throw new CheckinError("Please see the front desk to check in.");
    throw e;
  }
}

/** Store one of the visit's due forms, filled in at the kiosk. No earlier answers are prefilled: a phone number is not proof of who is typing. */
export async function kioskSubmitForm(token: string, raw: string, appointmentId: string, formId: string, formData: FormData, ipAddress: string | null, now = new Date()) {
  const { kiosk, client, visit } = await matched(token, raw, appointmentId, now);
  const form = visit.formsDue.find((f) => f.id === formId);
  if (!form) throw new FormSubmitError("This form is already on file.");
  const { answers, files } = answersFromFormData(form.fields, formData);
  const sig = formData.get("signatureName");
  const img = formData.get("signatureImage");
  await submitForm({ businessId: kiosk.business.id, formId, clientId: client.clientId, appointmentId, answers, files, signatureName: typeof sig === "string" && sig.trim() ? sig.trim().slice(0, 120) : null, signatureImage: typeof img === "string" && img ? img : null, ipAddress });
}

/* ---------- Walk-ins ---------- */

export const WALKIN_LIMIT = 10;

/**
 * "I don't have an appointment": put the visitor on today's Waitlist at this location, marked as a walk-in at the kiosk, where the desk
 * books them with one tap (Book fills in the client). Attached to an existing client only when the phone and the name both match, as
 * for online booking; otherwise a new client. Nothing about any existing client is shown back.
 */
export async function kioskWalkIn(token: string, input: { firstName: string; lastName: string; phone: string }, now = new Date()): Promise<{ firstName: string }> {
  const kiosk = await resolveCheckin(token);
  if (!kiosk) throw new CheckinError("This kiosk is no longer set up. Please see the front desk.");
  const firstName = input.firstName.trim().slice(0, 60);
  const lastName = input.lastName.trim().slice(0, 60);
  const phone = normalizePhone(input.phone);
  if (!firstName) throw new CheckinError("Please enter your first name.");
  if (!phone) throw new CheckinError("Please enter your mobile number.");
  if (!(await sharedRateLimit(`checkin-walkin:${token}`, WALKIN_LIMIT, WINDOW_MS)).ok) throw new CheckinError("Please see the front desk.");
  const { business, location } = kiosk;
  const today = instantToISODate(now, tzFor(business, location));
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tzFor(business, location) }).format(now);
  const entryId = await withTenant(business.id, async (tx) => {
    const candidates = await tx.query.clients.findMany({ where: eq(schema.clients.phone, phone), orderBy: [asc(schema.clients.createdAt)], limit: 25 });
    let clientId = candidates.find((c) => sameClientName(c, { firstName, lastName }))?.id;
    if (!clientId) {
      // A new record never opts into texts from a kiosk tap; the desk asks.
      const [row] = await tx.insert(schema.clients).values({ businessId: business.id, firstName, lastName, phone, smsOptIn: false }).returning({ id: schema.clients.id });
      clientId = row!.id;
    }
    const open = await tx.query.waitlist.findFirst({ where: and(eq(schema.waitlist.clientId, clientId), eq(schema.waitlist.status, "open"), eq(schema.waitlist.date, today), eq(schema.waitlist.locationId, location.id)) });
    if (open) return open.id;
    const [w] = await tx.insert(schema.waitlist).values({ businessId: business.id, clientId, locationId: location.id, date: today, notes: `Walk-in at the check-in kiosk, ${time}` }).returning({ id: schema.waitlist.id });
    return w!.id;
  });
  await auditEvent(business.id, "client", "kiosk.walk_in", "waitlist", entryId, { name: `${firstName} ${lastName}`.trim(), locationId: location.id });
  return { firstName };
}

/* ---------- Staff alerts ---------- */

export type KioskAlert = { id: string; at: string; message: string; href: string };

/**
 * Kiosk check-ins and walk-ins since `since`, for the staff app's live alert (polled while a tab is open). Full names here: this is
 * the staff side, for people who may see every calendar.
 */
export async function kioskAlerts(business: { id: string; slug: string; timezone: string }, since: Date, limit = 10): Promise<KioskAlert[]> {
  return withTenant(business.id, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.auditLog)
      .where(and(gte(schema.auditLog.at, since), or(and(eq(schema.auditLog.action, "appointment.checked_in"), eq(schema.auditLog.actorUserId, "client")), eq(schema.auditLog.action, "kiosk.walk_in"))))
      .orderBy(asc(schema.auditLog.at))
      .limit(limit);
    const out: KioskAlert[] = [];
    for (const r of rows) {
      if (r.action === "kiosk.walk_in") {
        let name = "Someone";
        try { name = (JSON.parse(r.diff ?? "{}") as { name?: string }).name || name; } catch { /* keep the default */ }
        out.push({ id: r.id, at: r.at.toISOString(), message: `${name} walked in without an appointment and is on the Waitlist`, href: `/app/${business.slug}/waitlist` });
        continue;
      }
      const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, r.entityId ?? ""), columns: { id: true, clientId: true, locationId: true } });
      if (!appt) continue;
      const client = appt.clientId ? await tx.query.clients.findFirst({ where: eq(schema.clients.id, appt.clientId), columns: { firstName: true, lastName: true } }) : null;
      const [item] = await tx.select({ startAt: schema.appointmentItems.startAt, serviceName: schema.appointmentItems.serviceName, staffName: schema.staff.displayName }).from(schema.appointmentItems).leftJoin(schema.staff, eq(schema.staff.id, schema.appointmentItems.staffId)).where(eq(schema.appointmentItems.appointmentId, appt.id)).orderBy(asc(schema.appointmentItems.startAt)).limit(1);
      const loc = appt.locationId ? await tx.query.locations.findFirst({ where: eq(schema.locations.id, appt.locationId), columns: { timezone: true } }) : null;
      const time = item ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: loc?.timezone ?? business.timezone }).format(item.startAt) : "";
      const who = client ? `${client.firstName} ${client.lastName ?? ""}`.trim() : "A client";
      out.push({ id: r.id, at: r.at.toISOString(), message: `${who} checked in${item ? ` for ${time} ${item.serviceName}${item.staffName ? ` with ${item.staffName}` : ""}` : ""}`, href: `/app/${business.slug}/appointments/${appt.id}` });
    }
    return out;
  });
}

/** Whether any location has the kiosk on (the staff app only polls for alerts then). */
export async function checkinKioskOn(businessId: string): Promise<boolean> {
  const l = await withTenant(businessId, (tx) => tx.query.locations.findFirst({ where: sql`${schema.locations.checkinToken} is not null`, columns: { id: true } }));
  return !!l;
}
