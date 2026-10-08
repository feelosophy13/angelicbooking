import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { canClientCancel, isWithinBookingWindow, normalizePhone, onlineBookingWindow, zonedToInstant } from "@angelic/core";
import { getStaffAvailability, staffForService, timingFor } from "./availability";
import { bookAppointment, BookingError, rescheduleService, setAppointmentStatus } from "./booking";
import { appointmentContext, notifyAppointment, queueOneOff } from "@/lib/notify";
import { staffAlertEmail } from "@/lib/notify/templates";
import { appUrl } from "@/lib/stripe";
import { shiftISODate } from "@/lib/utils";

export type PublicBusiness = typeof schema.businesses.$inferSelect;

/** Unscoped lookup for the public page. Returns null if booking is off. */
export async function getPublicBusiness(slug: string): Promise<PublicBusiness | null> {
  const b = await db.query.businesses.findFirst({ where: eq(schema.businesses.slug, slug) });
  return b && b.onlineBookingEnabled ? b : null;
}

export async function getPublicLocations(businessId: string) {
  return withTenant(businessId, (tx) => tx.select().from(schema.locations).orderBy(asc(schema.locations.isDefault), asc(schema.locations.name)));
}

export async function getPublicMenu(businessId: string, locationId?: string | null) {
  return withTenant(businessId, async (tx) => {
    const [services, categories, staffAll] = await Promise.all([
      tx
        .select()
        .from(schema.services)
        .where(and(eq(schema.services.active, true), eq(schema.services.bookableOnline, true)))
        .orderBy(asc(schema.services.sortOrder), asc(schema.services.name)),
      tx.select().from(schema.serviceCategories).orderBy(asc(schema.serviceCategories.sortOrder), asc(schema.serviceCategories.name)),
      tx
        .select({ id: schema.staff.id, displayName: schema.staff.displayName, color: schema.staff.color })
        .from(schema.staff)
        .where(and(eq(schema.staff.active, true), eq(schema.staff.bookableOnline, true)))
        .orderBy(asc(schema.staff.sortOrder), asc(schema.staff.displayName)),
    ]);
    const staffLoc = locationId
      ? (await tx.select({ id: schema.staff.id, locationId: schema.staff.locationId }).from(schema.staff)).filter((x) => !x.locationId || x.locationId === locationId).map((x) => x.id)
      : null;
    const staff = staffLoc ? staffAll.filter((s) => staffLoc.includes(s.id)) : staffAll;
    return { services, categories, staff };
  });
}

/**
 * Slots for a service on a date. staffId "any" merges every eligible provider;
 * each slot carries the staff member who would take it (first available by sort order).
 */
export async function getPublicSlots(business: PublicBusiness, serviceId: string, staffId: string | "any", date: string, now = new Date()) {
  const service = await withTenant(business.id, (tx) => tx.query.services.findFirst({ where: and(eq(schema.services.id, serviceId), eq(schema.services.active, true), eq(schema.services.bookableOnline, true)) }));
  if (!service) return [];
  const window = onlineBookingWindow(now, business);
  const eligible = (await staffForService(business.id, serviceId)).filter((s) => s.bookableOnline);
  const chosen = staffId === "any" ? eligible : eligible.filter((s) => s.id === staffId);
  const out = new Map<number, { at: Date; staffId: string; staffName: string }>();
  for (const s of chosen) {
    const slots = await getStaffAvailability({
      businessId: business.id,
      timeZone: business.timezone,
      slotIntervalMin: business.slotIntervalMin,
      staffId: s.id,
      date,
      service: timingFor(service),
      notBefore: window.notBefore,
    });
    for (const at of slots) {
      if (at > window.notAfter) continue;
      if (!out.has(at.getTime())) out.set(at.getTime(), { at, staffId: s.id, staffName: s.displayName });
    }
  }
  return [...out.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Which dates in [from, from+days) have at least one opening. Cheap enough for a month. */
export async function getAvailableDates(business: PublicBusiness, serviceId: string, staffId: string | "any", from: string, days: number) {
  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = shiftISODate(from, i);
    const slots = await getPublicSlots(business, serviceId, staffId, d);
    if (slots.length) dates.push(d);
  }
  return dates;
}

export interface OnlineBookingInput {
  serviceId: string;
  staffId: string;
  startAt: Date;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  /** Client ticked the SMS consent box on the public form. */
  smsConsent?: boolean;
}

/** Find a client by phone or email, else create one. Runs inside the tenant tx. */
async function findOrCreateClient(businessId: string, input: OnlineBookingInput) {
  return withTenant(businessId, async (tx) => {
    const phone = normalizePhone(input.phone) ?? input.phone;
    const conds = [];
    if (phone) conds.push(eq(schema.clients.phone, phone));
    if (input.email) conds.push(sql`lower(${schema.clients.email}) = ${input.email.toLowerCase()}`);
    const existing = conds.length ? await tx.query.clients.findFirst({ where: or(...conds) }) : null;
    if (existing) {
      // Fill in gaps without overwriting what the business already has.
      await tx
        .update(schema.clients)
        .set({ email: existing.email ?? input.email, phone: existing.phone ?? phone, ...(input.smsConsent ? { smsOptIn: true } : {}) })
        .where(eq(schema.clients.id, existing.id));
      return existing.id;
    }
    const [row] = await tx
      .insert(schema.clients)
      .values({ businessId, firstName: input.firstName, lastName: input.lastName, email: input.email, phone, smsOptIn: input.smsConsent === true })
      .returning({ id: schema.clients.id });
    return row!.id;
  });
}

export async function createOnlineBooking(business: PublicBusiness, input: OnlineBookingInput, now = new Date()) {
  if (!isWithinBookingWindow(input.startAt, now, business)) throw new BookingError("That time can no longer be booked online.");
  // Re-validate the slot against live availability so stale pages can't book into a taken time.
  const slots = await getPublicSlots(business, input.serviceId, input.staffId, isoDateIn(input.startAt, business.timezone), now);
  if (!slots.some((s) => s.at.getTime() === input.startAt.getTime())) throw new BookingError("That time was just taken. Please pick another.");
  const clientId = await findOrCreateClient(business.id, input);
  const { appointmentId } = await bookAppointment({
    businessId: business.id,
    clientId,
    serviceId: input.serviceId,
    staffId: input.staffId,
    startAt: input.startAt,
    notes: input.notes,
    createdByUserId: null as unknown as string, // online bookings have no staff actor
    source: "online",
  });
  const token = await withTenant(business.id, async (tx) => (await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, appointmentId) }))!.manageToken);
  await notifyAppointment(business, appointmentId, "confirmation");
  await alertBusiness(business, appointmentId, "booked");
  return { appointmentId, token };
}

function isoDateIn(at: Date, tz: string) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  return p; // en-CA gives YYYY-MM-DD
}

/** Everything the client's self-service page needs, by secret token. */
export async function getManagedAppointment(slug: string, token: string) {
  const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.slug, slug) });
  if (!business) return null;
  return withTenant(business.id, async (tx) => {
    const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.manageToken, token) });
    if (!appt) return null;
    const items = await tx
      .select({ id: schema.appointmentItems.id, name: schema.appointmentItems.serviceName, staffId: schema.appointmentItems.staffId, staffName: schema.staff.displayName, serviceId: schema.appointmentItems.serviceId, startAt: schema.appointmentItems.startAt, endAt: schema.appointmentItems.endAt, status: schema.appointmentItems.status })
      .from(schema.appointmentItems)
      .innerJoin(schema.staff, eq(schema.staff.id, schema.appointmentItems.staffId))
      .where(eq(schema.appointmentItems.appointmentId, appt.id))
      .orderBy(asc(schema.appointmentItems.startAt));
    const client = appt.clientId ? await tx.query.clients.findFirst({ where: eq(schema.clients.id, appt.clientId) }) : null;
    const live = items.filter((i) => i.status !== "cancelled");
    const start = (live[0] ?? items[0])?.startAt ?? null;
    return { business, appt, items, live, client, start, canChange: !!start && appt.status !== "cancelled" && appt.status !== "completed" && appt.status !== "no_show" && canClientCancel(start, new Date(), business) };
  });
}

export async function cancelOnline(slug: string, token: string) {
  const m = await getManagedAppointment(slug, token);
  if (!m) throw new BookingError("Appointment not found.");
  if (!m.canChange) throw new BookingError(`Online cancellation closes ${m.business.cancelWindowHours} hours before the appointment. Please call ${m.business.phone ?? "the salon"}.`);
  await setAppointmentStatus(m.business.id, m.appt.id, "cancelled", "client", "Cancelled online by client");
  await notifyAppointment(m.business, m.appt.id, "cancellation");
  await alertBusiness(m.business, m.appt.id, "cancelled");
}

export async function rescheduleOnline(slug: string, token: string, newStartAt: Date) {
  const m = await getManagedAppointment(slug, token);
  if (!m) throw new BookingError("Appointment not found.");
  if (!m.canChange) throw new BookingError(`Online changes close ${m.business.cancelWindowHours} hours before the appointment.`);
  if (m.live.length !== 1 && new Set(m.live.map((i) => i.serviceId)).size !== 1) {
    throw new BookingError("This appointment has several services. Please call to reschedule.");
  }
  const first = m.live[0]!;
  if (!first.serviceId) throw new BookingError("Please call to reschedule.");
  if (!isWithinBookingWindow(newStartAt, new Date(), m.business)) throw new BookingError("That time can't be booked online.");
  const slots = await getPublicSlots(m.business, first.serviceId, first.staffId, isoDateIn(newStartAt, m.business.timezone));
  if (!slots.some((s) => s.at.getTime() === newStartAt.getTime())) throw new BookingError("That time was just taken. Please pick another.");
  await rescheduleService({ businessId: m.business.id, itemId: first.id, newStartAt, actorUserId: "client" });
  await notifyAppointment(m.business, m.appt.id, "rescheduled");
  await alertBusiness(m.business, m.appt.id, "rescheduled");
}

export async function joinWaitlist(business: PublicBusiness, input: { serviceId: string; staffId: string | null; date: string; firstName: string; lastName: string; email: string | null; phone: string | null; notes: string | null; smsConsent?: boolean }) {
  const clientId = await findOrCreateClient(business.id, { ...input, startAt: new Date(), staffId: input.staffId ?? "" });
  await withTenant(business.id, (tx) =>
    tx.insert(schema.waitlist).values({ businessId: business.id, clientId, serviceId: input.serviceId, staffId: input.staffId, date: input.date, notes: input.notes }),
  );
}

export async function listWaitlist(businessId: string) {
  return withTenant(businessId, (tx) =>
    tx
      .select({ id: schema.waitlist.id, date: schema.waitlist.date, notes: schema.waitlist.notes, status: schema.waitlist.status, createdAt: schema.waitlist.createdAt, clientFirst: schema.clients.firstName, clientLast: schema.clients.lastName, clientPhone: schema.clients.phone, clientId: schema.clients.id, serviceName: schema.services.name, serviceId: schema.services.id, staffName: schema.staff.displayName })
      .from(schema.waitlist)
      .leftJoin(schema.clients, eq(schema.clients.id, schema.waitlist.clientId))
      .leftJoin(schema.services, eq(schema.services.id, schema.waitlist.serviceId))
      .leftJoin(schema.staff, eq(schema.staff.id, schema.waitlist.staffId))
      .where(and(eq(schema.waitlist.status, "open"), gte(schema.waitlist.date, new Date().toISOString().slice(0, 10))))
      .orderBy(asc(schema.waitlist.date), asc(schema.waitlist.createdAt)),
  );
}

export async function setWaitlistStatus(businessId: string, id: string, status: "booked" | "closed") {
  await withTenant(businessId, (tx) => tx.update(schema.waitlist).set({ status }).where(eq(schema.waitlist.id, id)));
}

// keep imports used
void isNull; void lt; void inArray; void zonedToInstant;

/** Email the business when a client books/cancels/reschedules online (goes to the business profile email). */
async function alertBusiness(business: PublicBusiness, appointmentId: string, kind: "booked" | "cancelled" | "rescheduled") {
  if (!business.email) return;
  const built = await withTenant(business.id, (tx) => appointmentContext(tx, business, appointmentId));
  if (!built) return;
  const clientName = built.client ? `${built.client.firstName} ${built.client.lastName ?? ""}`.trim() : "A client";
  const t = staffAlertEmail(built.ctx, kind, clientName, appUrl(`/app/${business.slug}/appointments/${appointmentId}`));
  await queueOneOff(business.id, { channel: "email", template: `staff_${kind}`, recipient: business.email, subject: t.subject, body: t.html });
}
