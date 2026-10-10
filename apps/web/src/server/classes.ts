/**
 * Classes and group bookings. A service with capacity > 1 is run as scheduled
 * sessions; each client who joins gets an ordinary appointment whose single
 * item points at the session, so check-in, checkout, reminders and reports
 * all work unchanged. Capacity is enforced inside the enrolment transaction
 * with a row lock on the session.
 */
import { and, asc, count, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { schema, withTenant, type TenantDb } from "@angelic/db";
import { onlineBookingWindow } from "@angelic/core";
import { getStaffAvailability, timingFor } from "./availability";
import { BookingError, setAppointmentStatus } from "./booking";
import type { PublicBusiness } from "./public-booking";

export const LIVE = ["booked", "confirmed", "checked_in", "in_progress", "completed"] as const;

export type ClassSession = typeof schema.classSessions.$inferSelect;

/** Sessions with their service, instructor and seat counts. */
export async function listSessions(businessId: string, opts: { from: Date; to: Date; serviceId?: string | null; includeCancelled?: boolean }) {
  return withTenant(businessId, async (tx) => {
    const rows = await tx
      .select({
        session: schema.classSessions,
        serviceName: schema.services.name,
        staffName: schema.staff.displayName,
        staffColor: schema.staff.color,
        booked: sql<number>`(select count(*) from appointment_items ai where ai.class_session_id = ${schema.classSessions.id} and ai.status in ('booked','confirmed','checked_in','in_progress','completed'))`,
      })
      .from(schema.classSessions)
      .innerJoin(schema.services, eq(schema.services.id, schema.classSessions.serviceId))
      .innerJoin(schema.staff, eq(schema.staff.id, schema.classSessions.staffId))
      .where(
        and(
          gte(schema.classSessions.startAt, opts.from),
          lt(schema.classSessions.startAt, opts.to),
          opts.serviceId ? eq(schema.classSessions.serviceId, opts.serviceId) : undefined,
          opts.includeCancelled ? undefined : eq(schema.classSessions.status, "scheduled"),
        ),
      )
      .orderBy(asc(schema.classSessions.startAt));
    return rows.map((r) => ({ ...r.session, serviceName: r.serviceName, staffName: r.staffName, staffColor: r.staffColor, booked: Number(r.booked), seatsLeft: Math.max(0, r.session.capacity - Number(r.booked)) }));
  });
}

/** Sessions a client can join online: inside the booking window, scheduled, with a seat left. */
export async function publicSessions(business: PublicBusiness, serviceId: string, now = new Date()) {
  const w = onlineBookingWindow(now, business);
  const rows = await listSessions(business.id, { from: w.notBefore, to: w.notAfter, serviceId });
  return rows.filter((s) => s.seatsLeft > 0);
}

export async function getSession(businessId: string, sessionId: string) {
  return withTenant(businessId, async (tx) => {
    const session = await tx.query.classSessions.findFirst({ where: eq(schema.classSessions.id, sessionId) });
    if (!session) return null;
    const [service, person, roster] = await Promise.all([
      tx.query.services.findFirst({ where: eq(schema.services.id, session.serviceId) }),
      tx.query.staff.findFirst({ where: eq(schema.staff.id, session.staffId) }),
      tx
        .select({
          appointmentId: schema.appointments.id,
          status: schema.appointments.status,
          clientId: schema.clients.id,
          firstName: schema.clients.firstName,
          lastName: schema.clients.lastName,
          phone: schema.clients.phone,
          email: schema.clients.email,
          source: schema.appointments.source,
          createdAt: schema.appointments.createdAt,
          depositStatus: schema.appointments.depositStatus,
        })
        .from(schema.appointmentItems)
        .innerJoin(schema.appointments, eq(schema.appointments.id, schema.appointmentItems.appointmentId))
        .leftJoin(schema.clients, eq(schema.clients.id, schema.appointments.clientId))
        .where(eq(schema.appointmentItems.classSessionId, sessionId))
        .orderBy(asc(schema.appointments.createdAt)),
    ]);
    const booked = roster.filter((r) => (LIVE as readonly string[]).includes(r.status)).length;
    return { session, service: service ?? null, staff: person ?? null, roster, booked, seatsLeft: Math.max(0, session.capacity - booked) };
  });
}

export async function createSession(input: { businessId: string; timeZone: string; slotIntervalMin: number; serviceId: string; staffId: string; startAt: Date; capacity: number | null; notes: string | null; actorUserId: string }) {
  const service = await withTenant(input.businessId, (tx) => tx.query.services.findFirst({ where: eq(schema.services.id, input.serviceId) }));
  if (!service || !service.active) throw new BookingError("That service is not available.");
  if (service.capacity < 2) throw new BookingError("Set a group size above 1 on the service to run it as a class.");
  const staffRow = await withTenant(input.businessId, (tx) => tx.query.staff.findFirst({ where: eq(schema.staff.id, input.staffId) }));
  if (!staffRow || !staffRow.active) throw new BookingError("That staff member is not available.");
  // The instructor must be free for the whole block (other sessions count as busy too).
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: input.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(input.startAt);
  const slots = await getStaffAvailability({ businessId: input.businessId, timeZone: input.timeZone, slotIntervalMin: input.slotIntervalMin, staffId: input.staffId, date, service: timingFor(service) });
  if (!slots.some((s) => s.getTime() === input.startAt.getTime())) throw new BookingError("The instructor isn't free then. Pick one of the open times.");
  const minutes = service.durationMin + service.gapMin + service.finishMin;
  const capacity = input.capacity && input.capacity > 0 ? Math.min(500, input.capacity) : service.capacity;
  return withTenant(input.businessId, async (tx) => {
    const [row] = await tx
      .insert(schema.classSessions)
      .values({
        businessId: input.businessId,
        serviceId: service.id,
        staffId: input.staffId,
        locationId: staffRow.locationId,
        startAt: input.startAt,
        endAt: new Date(input.startAt.getTime() + minutes * 60_000),
        capacity,
        priceCents: service.priceCents,
        notes: input.notes,
        createdByUserId: input.actorUserId,
      })
      .returning();
    await tx.insert(schema.auditLog).values({ businessId: input.businessId, actorUserId: input.actorUserId, action: "class.schedule", entity: "class_session", entityId: row!.id, diff: JSON.stringify({ serviceId: service.id, staffId: input.staffId, startAt: input.startAt }) });
    return row!;
  });
}

/**
 * Lock the session, check a seat is free, and insert the appointment + item.
 * Runs inside the caller's tenant transaction so it composes with deposits.
 */
export async function insertSeat(tx: TenantDb, input: { businessId: string; sessionId: string; clientId: string | null; notes: string | null; source: "staff" | "online"; createdByUserId: string | null; deposit?: { paymentIntentId: string; cents: number; cardLabel: string | null } | null; cardSetupIntentId?: string | null }) {
  const [session] = await tx.select().from(schema.classSessions).where(eq(schema.classSessions.id, input.sessionId)).for("update");
  if (!session || session.status !== "scheduled") throw new BookingError("That class is no longer scheduled.");
  if (session.startAt <= new Date()) throw new BookingError("That class has already started.");
  const [c] = await tx
    .select({ n: count() })
    .from(schema.appointmentItems)
    .where(and(eq(schema.appointmentItems.classSessionId, session.id), inArray(schema.appointmentItems.status, [...LIVE])));
  if (Number(c?.n ?? 0) >= session.capacity) throw new BookingError("This class is full.");
  if (input.clientId) {
    const [dup] = await tx
      .select({ n: count() })
      .from(schema.appointmentItems)
      .innerJoin(schema.appointments, eq(schema.appointments.id, schema.appointmentItems.appointmentId))
      .where(and(eq(schema.appointmentItems.classSessionId, session.id), eq(schema.appointments.clientId, input.clientId), inArray(schema.appointmentItems.status, [...LIVE])));
    if (Number(dup?.n ?? 0) > 0) throw new BookingError("This client already has a seat in that class.");
  }
  const service = await tx.query.services.findFirst({ where: eq(schema.services.id, session.serviceId) });
  const [appt] = await tx
    .insert(schema.appointments)
    .values({
      businessId: input.businessId,
      locationId: session.locationId,
      clientId: input.clientId,
      notes: input.notes,
      source: input.source,
      createdByUserId: input.createdByUserId,
      ...(input.deposit ? { depositCents: input.deposit.cents, depositStatus: "paid" as const, depositPaymentIntentId: input.deposit.paymentIntentId, depositCardLabel: input.deposit.cardLabel } : {}),
      cardSetupIntentId: input.cardSetupIntentId ?? null,
    })
    .returning({ id: schema.appointments.id, manageToken: schema.appointments.manageToken });
  await tx.insert(schema.appointmentItems).values({
    businessId: input.businessId,
    appointmentId: appt!.id,
    staffId: session.staffId,
    serviceId: session.serviceId,
    serviceName: service?.name ?? "Class",
    startAt: session.startAt,
    endAt: session.endAt,
    priceCents: session.priceCents,
    classSessionId: session.id,
  });
  await tx.insert(schema.auditLog).values({ businessId: input.businessId, actorUserId: input.createdByUserId, action: "class.enrol", entity: "appointment", entityId: appt!.id, diff: JSON.stringify({ sessionId: session.id, clientId: input.clientId }) });
  return { appointmentId: appt!.id, manageToken: appt!.manageToken };
}

export async function enrolClient(input: { businessId: string; sessionId: string; clientId: string | null; notes: string | null; actorUserId: string }) {
  return withTenant(input.businessId, (tx) => insertSeat(tx, { ...input, source: "staff", createdByUserId: input.actorUserId }));
}

/** Cancel a session and every seat in it. Returns the cancelled appointment ids (for notifications). */
export async function cancelSession(input: { businessId: string; sessionId: string; actorUserId: string; reason: string | null }) {
  const s = await getSession(input.businessId, input.sessionId);
  if (!s) throw new BookingError("Class not found.");
  const ids = s.roster.filter((r) => r.status === "booked" || r.status === "confirmed" || r.status === "checked_in").map((r) => r.appointmentId);
  for (const id of ids) await setAppointmentStatus(input.businessId, id, "cancelled", input.actorUserId, input.reason ?? "Class cancelled");
  await withTenant(input.businessId, async (tx) => {
    await tx.update(schema.classSessions).set({ status: "cancelled" }).where(eq(schema.classSessions.id, input.sessionId));
    await tx.insert(schema.auditLog).values({ businessId: input.businessId, actorUserId: input.actorUserId, action: "class.cancel", entity: "class_session", entityId: input.sessionId, diff: JSON.stringify({ seats: ids.length, reason: input.reason }) });
  });
  return ids;
}

/** Group services for pickers. */
export async function listGroupServices(businessId: string) {
  return withTenant(businessId, (tx) =>
    tx
      .select()
      .from(schema.services)
      .where(and(eq(schema.services.active, true), sql`${schema.services.capacity} > 1`))
      .orderBy(asc(schema.services.name)),
  );
}
