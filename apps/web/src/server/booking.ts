import { and, eq, sql } from "drizzle-orm";
import { db, schema, withTenant, type TenantDb } from "@angelic/db";
import { buildBookingSegments, instantToISODate, rowsForDate, weekdayOf } from "@angelic/core";
import { timingFor, withinWorkingBlocks, workingBlocksFor } from "./availability";
import { refreshHomeLocation, serviceOfferedAt } from "./locations";

export class BookingError extends Error {}

type Tx = TenantDb;

/** Insert the time segments for one service into an existing appointment. */
async function insertServiceItems(
  tx: Tx,
  input: { businessId: string; appointmentId: string; serviceId: string; staffId: string; startAt: Date; sortOrderBase: number },
) {
  const service = await tx.query.services.findFirst({ where: eq(schema.services.id, input.serviceId) });
  if (!service || !service.active) throw new BookingError("That service is no longer available.");
  const staffRow = await tx.query.staff.findFirst({ where: eq(schema.staff.id, input.staffId) });
  if (!staffRow || !staffRow.active) throw new BookingError("That staff member is not available.");
  await assertQualified(tx, staffRow, service);
  const override = await tx.query.staffServices.findFirst({
    where: and(eq(schema.staffServices.staffId, input.staffId), eq(schema.staffServices.serviceId, input.serviceId)),
  });
  const timing = timingFor({ ...service, durationMin: override?.durationMinOverride ?? service.durationMin });
  const priceCents = override?.priceCentsOverride ?? service.priceCents;
  const segments = buildBookingSegments(input.startAt, timing);
  await tx.insert(schema.appointmentItems).values(
    segments.map((seg, i) => ({
      businessId: input.businessId,
      appointmentId: input.appointmentId,
      staffId: input.staffId,
      serviceId: service.id,
      serviceName: i === 0 ? service.name : `${service.name} (finish)`,
      startAt: seg.start,
      endAt: seg.end,
      priceCents: i === 0 ? priceCents : 0,
      sortOrder: input.sortOrderBase + i,
    })),
  );
  return { service, segments };
}

/** When a service has an assigned-staff list, only those providers may take it. (No list = anyone.) */
async function assertQualified(tx: Tx, staffRow: { id: string; displayName: string }, service: { id: string; name: string }) {
  const mapped = await tx.select({ staffId: schema.staffServices.staffId }).from(schema.staffServices).where(eq(schema.staffServices.serviceId, service.id));
  if (mapped.length && !mapped.some((m) => m.staffId === staffRow.id)) throw new BookingError(`${staffRow.displayName} doesn't perform ${service.name}. Assign it under Staff → Services first.`);
}

/** Every log row names who did it: a user id, or the literal "client" for self-service actions online. */
async function audit(tx: Tx, businessId: string, actorUserId: string | null, action: string, entityId: string, diff?: unknown) {
  await tx.insert(schema.auditLog).values({
    businessId,
    actorUserId: actorUserId ?? "client",
    action,
    entity: "appointment",
    entityId,
    diff: diff === undefined ? null : JSON.stringify(diff),
  });
}

/** Translate a Postgres exclusion violation into a user-facing BookingError. */
function translate(e: unknown): never {
  const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  if (code === "23P01") throw new BookingError("That time was just taken. Please pick another slot.");
  throw e;
}

/**
 * Create an appointment with one service for one staff member.
 * The DB exclusion constraint is the final authority on conflicts, so a race
 * between two bookings resolves safely regardless of app-side checks.
 */
export interface BookAppointmentInput {
  businessId: string;
  clientId: string | null;
  serviceId: string;
  staffId: string;
  startAt: Date;
  notes?: string | null;
  createdByUserId: string | null;
  source?: "staff" | "online";
  /** Standing-appointment series this occurrence belongs to. */
  seriesId?: string | null;
  /** Deposit already collected online (PaymentIntent on the business's Stripe account). */
  deposit?: { paymentIntentId: string; cents: number; cardLabel: string | null } | null;
  /** SetupIntent that saved a card on file at booking. */
  cardSetupIntentId?: string | null;
  /** Book a seat in this class session instead of a one-to-one slot. */
  classSessionId?: string | null;
  /** Promo code to apply when checkout opens. */
  promoCodeId?: string | null;
  /** Where the visit happens. Defaults to where the provider works that weekday, else their primary site, else the default. */
  locationId?: string | null;
}

/** The location an appointment belongs to when none was chosen explicitly. */
export async function resolveAppointmentLocation(tx: Tx, staffId: string, startAt: Date, timeZone: string, explicit?: string | null): Promise<string | null> {
  if (explicit) return explicit;
  const [rows, person, def] = await Promise.all([
    tx.select({ weekday: schema.staffSchedules.weekday, locationId: schema.staffSchedules.locationId, weekIndex: schema.staffSchedules.weekIndex }).from(schema.staffSchedules).where(eq(schema.staffSchedules.staffId, staffId)),
    tx.query.staff.findFirst({ where: eq(schema.staff.id, staffId), columns: { locationId: true, rotationWeeks: true, rotationAnchor: true } }),
    tx.query.locations.findFirst({ where: eq(schema.locations.isDefault, true), columns: { id: true } }),
  ]);
  const date = instantToISODate(startAt, timeZone);
  const weekday = weekdayOf(date);
  const day = rowsForDate(date, rows, person ? { weeks: person.rotationWeeks, anchor: person.rotationAnchor } : null).find((r) => r.weekday === weekday);
  return day?.locationId ?? person?.locationId ?? def?.id ?? null;
}

export async function bookAppointment(input: BookAppointmentInput): Promise<{ appointmentId: string }> {
  if (input.classSessionId) {
    const { insertSeat } = await import("./classes");
    return withTenant(input.businessId, async (tx) => {
      const r = await insertSeat(tx, { businessId: input.businessId, sessionId: input.classSessionId!, clientId: input.clientId, notes: input.notes ?? null, source: input.source ?? "staff", createdByUserId: input.createdByUserId ?? null, deposit: input.deposit, cardSetupIntentId: input.cardSetupIntentId, promoCodeId: input.promoCodeId });
      return { appointmentId: r.appointmentId };
    });
  }
  try {
    return await withTenant(input.businessId, async (tx) => {
      const biz = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, input.businessId), columns: { timezone: true } });
      const locationId = await resolveAppointmentLocation(tx, input.staffId, input.startAt, biz?.timezone ?? "America/New_York", input.locationId);
      if (!(await serviceOfferedAt(tx, input.serviceId, locationId))) throw new BookingError("That service isn't offered at this location.");
      const [appt] = await tx
        .insert(schema.appointments)
        .values({
          businessId: input.businessId,
          locationId,
          clientId: input.clientId,
          notes: input.notes ?? null,
          source: input.source ?? "staff",
          createdByUserId: input.createdByUserId,
          seriesId: input.seriesId ?? null,
          ...(input.deposit
            ? { depositCents: input.deposit.cents, depositStatus: "paid" as const, depositPaymentIntentId: input.deposit.paymentIntentId, depositCardLabel: input.deposit.cardLabel }
            : {}),
          cardSetupIntentId: input.cardSetupIntentId ?? null,
          promoCodeId: input.promoCodeId ?? null,
        })
        .returning({ id: schema.appointments.id });
      await insertServiceItems(tx, { ...input, appointmentId: appt!.id, sortOrderBase: 0 });
      await refreshHomeLocation(tx, input.clientId);
      await audit(tx, input.businessId, input.source === "online" ? "client" : input.createdByUserId, "appointment.create", appt!.id, {
        serviceId: input.serviceId,
        staffId: input.staffId,
        startAt: input.startAt,
        ...(input.seriesId ? { seriesId: input.seriesId } : {}),
        ...(input.deposit ? { depositCents: input.deposit.cents } : {}),
      });
      return { appointmentId: appt!.id };
    });
  } catch (e) {
    translate(e);
  }
}

/** Add another service (possibly with a different staff member) to an existing appointment. */
export async function addServiceToAppointment(input: {
  businessId: string;
  appointmentId: string;
  serviceId: string;
  staffId: string;
  startAt: Date;
  actorUserId: string;
}) {
  try {
    await withTenant(input.businessId, async (tx) => {
      const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, input.appointmentId) });
      if (!appt) throw new BookingError("Appointment not found.");
      if (appt.status === "cancelled" || appt.status === "completed" || appt.status === "no_show") {
        throw new BookingError(`Can't add a service to a ${appt.status.replace("_", " ")} appointment.`);
      }
      if (!(await serviceOfferedAt(tx, input.serviceId, appt.locationId))) throw new BookingError("That service isn't offered at this appointment's location.");
      const [agg] = await tx
        .select({ max: sql<number>`coalesce(max(${schema.appointmentItems.sortOrder}), -1)` })
        .from(schema.appointmentItems)
        .where(eq(schema.appointmentItems.appointmentId, input.appointmentId));
      await insertServiceItems(tx, { ...input, sortOrderBase: Number(agg?.max ?? -1) + 1 });
      await audit(tx, input.businessId, input.actorUserId, "appointment.add_service", input.appointmentId, {
        serviceId: input.serviceId,
        staffId: input.staffId,
        startAt: input.startAt,
      });
    });
  } catch (e) {
    translate(e);
  }
}

/**
 * Move one service within an appointment to a new start (and optionally a new
 * staff member). All segments of that service (e.g. colour + finish) shift by
 * the same delta. Overlap is checked once at commit thanks to the deferrable
 * exclusion constraint.
 */
export async function rescheduleService(input: {
  businessId: string;
  itemId: string;
  newStartAt: Date;
  newStaffId?: string | null;
  actorUserId: string;
}) {
  try {
    await withTenant(input.businessId, async (tx) => {
      const item = await tx.query.appointmentItems.findFirst({ where: eq(schema.appointmentItems.id, input.itemId) });
      if (!item) throw new BookingError("Appointment not found.");
      if (item.status === "cancelled" || item.status === "completed" || item.status === "no_show") {
        throw new BookingError("This appointment can no longer be moved.");
      }
      if (item.classSessionId) throw new BookingError("Seats in a class move with the class. Cancel the seat and book another session instead.");
      const siblings = await tx
        .select()
        .from(schema.appointmentItems)
        .where(
          and(
            eq(schema.appointmentItems.appointmentId, item.appointmentId),
            item.serviceId ? eq(schema.appointmentItems.serviceId, item.serviceId) : eq(schema.appointmentItems.id, item.id),
            eq(schema.appointmentItems.staffId, item.staffId),
          ),
        );
      const first = siblings.reduce((a, b) => (a.startAt < b.startAt ? a : b));
      const deltaMs = input.newStartAt.getTime() - first.startAt.getTime();
      const staffId = input.newStaffId ?? item.staffId;
      if (deltaMs === 0 && staffId === item.staffId) return;
      const target = await tx.query.staff.findFirst({ where: eq(schema.staff.id, staffId) });
      if (!target || !target.active) throw new BookingError("That staff member is not available.");
      if (staffId !== item.staffId && item.serviceId) {
        const service = await tx.query.services.findFirst({ where: eq(schema.services.id, item.serviceId), columns: { id: true, name: true } });
        if (service) await assertQualified(tx, target, service);
      }
      // The moved segments must land inside the provider's working hours that day (busy clashes are the DB's job).
      const biz = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, input.businessId), columns: { timezone: true } });
      const tz = biz?.timezone ?? "America/New_York";
      const moved = siblings.map((s) => ({ start: new Date(s.startAt.getTime() + deltaMs), end: new Date(s.endAt.getTime() + deltaMs) }));
      const day = instantToISODate(moved[0]!.start, tz);
      const blocks = (await workingBlocksFor({ businessId: input.businessId, timeZone: tz, staffIds: [staffId], dates: [day] })).get(`${staffId}:${day}`) ?? [];
      if (!withinWorkingBlocks(blocks, moved)) {
        const when = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz }).format(moved[0]!.start);
        throw new BookingError(blocks.length ? `${target.displayName} isn't working at ${when}. Pick a time inside their hours, or change their hours under Staff.` : `${target.displayName} is off on ${when.split(",")[0]}.`);
      }
      await tx.execute(sql`set constraints appointment_items_no_double_booking deferred`);
      for (const s of siblings) {
        await tx
          .update(schema.appointmentItems)
          .set({ startAt: new Date(s.startAt.getTime() + deltaMs), endAt: new Date(s.endAt.getTime() + deltaMs), staffId })
          .where(eq(schema.appointmentItems.id, s.id));
      }
      await followProviderLocation(tx, input.businessId, item.appointmentId);
      await audit(tx, input.businessId, input.actorUserId, "appointment.reschedule", item.appointmentId, {
        itemId: item.id,
        from: first.startAt,
        to: input.newStartAt,
        fromStaff: item.staffId,
        toStaff: staffId,
      });
    });
  } catch (e) {
    translate(e);
  }
}

/**
 * After a move, the visit happens wherever its (first) provider works on the new
 * day. If that is a different site, every service on the ticket must be offered
 * there; then the appointment and the client's home location follow.
 */
async function followProviderLocation(tx: Tx, businessId: string, appointmentId: string) {
  const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, appointmentId) });
  if (!appt) return;
  const live = await tx
    .select({ staffId: schema.appointmentItems.staffId, serviceId: schema.appointmentItems.serviceId, startAt: schema.appointmentItems.startAt })
    .from(schema.appointmentItems)
    .where(and(eq(schema.appointmentItems.appointmentId, appointmentId), sql`${schema.appointmentItems.status} <> 'cancelled'`))
    .orderBy(schema.appointmentItems.startAt);
  const first = live[0];
  if (!first) return;
  const biz = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, businessId), columns: { timezone: true } });
  const locationId = await resolveAppointmentLocation(tx, first.staffId, first.startAt, biz?.timezone ?? "America/New_York");
  if (!locationId || locationId === appt.locationId) return;
  for (const serviceId of new Set(live.map((i) => i.serviceId).filter((x): x is string => !!x))) {
    if (!(await serviceOfferedAt(tx, serviceId, locationId))) {
      const loc = await tx.query.locations.findFirst({ where: eq(schema.locations.id, locationId), columns: { name: true } });
      throw new BookingError(`That day the provider works at ${loc?.name ?? "another location"}, where one of these services isn't offered.`);
    }
  }
  await tx.update(schema.appointments).set({ locationId }).where(eq(schema.appointments.id, appointmentId));
  await refreshHomeLocation(tx, appt.clientId);
}

/** Remove one service (all its segments) from an appointment. Cancels the appointment if nothing is left. */
export async function removeServiceFromAppointment(input: { businessId: string; itemId: string; actorUserId: string }): Promise<{ appointmentId: string; cancelled: boolean } | null> {
  return withTenant(input.businessId, async (tx) => {
    const item = await tx.query.appointmentItems.findFirst({ where: eq(schema.appointmentItems.id, input.itemId) });
    if (!item) return null;
    await tx
      .update(schema.appointmentItems)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(schema.appointmentItems.appointmentId, item.appointmentId),
          item.serviceId ? eq(schema.appointmentItems.serviceId, item.serviceId) : eq(schema.appointmentItems.id, item.id),
          eq(schema.appointmentItems.staffId, item.staffId),
        ),
      );
    const [agg] = await tx
      .select({ live: sql<number>`count(*) filter (where ${schema.appointmentItems.status} <> 'cancelled')` })
      .from(schema.appointmentItems)
      .where(eq(schema.appointmentItems.appointmentId, item.appointmentId));
    const cancelled = Number(agg?.live ?? 0) === 0;
    if (cancelled) {
      await tx
        .update(schema.appointments)
        .set({ status: "cancelled", cancelledAt: new Date() })
        .where(eq(schema.appointments.id, item.appointmentId));
    }
    await audit(tx, input.businessId, input.actorUserId, "appointment.remove_service", item.appointmentId, { itemId: item.id });
    return { appointmentId: item.appointmentId, cancelled };
  });
}

/**
 * Blocked time: lunch, a late start, "do not book". Stored as an appointment of
 * kind "block" with one item (no service, no client) so availability, the
 * calendar and the exclusion constraint treat it like any other busy time.
 */
export async function blockTime(input: { businessId: string; staffId: string; startAt: Date; endAt: Date; reason: string | null; actorUserId: string; locationId?: string | null }): Promise<{ appointmentId: string }> {
  if (input.endAt <= input.startAt) throw new BookingError("The block must end after it starts.");
  if (input.endAt.getTime() - input.startAt.getTime() > 24 * 3_600_000) throw new BookingError("A block can't be longer than a day.");
  try {
    return await withTenant(input.businessId, async (tx) => {
      const staffRow = await tx.query.staff.findFirst({ where: eq(schema.staff.id, input.staffId) });
      if (!staffRow || !staffRow.active) throw new BookingError("That staff member is not available.");
      const biz = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, input.businessId), columns: { timezone: true } });
      const locationId = await resolveAppointmentLocation(tx, input.staffId, input.startAt, biz?.timezone ?? "America/New_York", input.locationId);
      const [appt] = await tx
        .insert(schema.appointments)
        .values({ businessId: input.businessId, locationId, clientId: null, kind: "block", notes: input.reason, createdByUserId: input.actorUserId, source: "staff" })
        .returning({ id: schema.appointments.id });
      await tx.insert(schema.appointmentItems).values({
        businessId: input.businessId,
        appointmentId: appt!.id,
        staffId: input.staffId,
        serviceId: null,
        serviceName: input.reason ? `Blocked · ${input.reason}` : "Blocked time",
        startAt: input.startAt,
        endAt: input.endAt,
        priceCents: 0,
        sortOrder: 0,
      });
      await audit(tx, input.businessId, input.actorUserId, "appointment.block", appt!.id, { staffId: input.staffId, startAt: input.startAt, endAt: input.endAt, reason: input.reason });
      return { appointmentId: appt!.id };
    });
  } catch (e) {
    translate(e);
  }
}

export async function setAppointmentStatus(
  businessId: string,
  appointmentId: string,
  status: (typeof schema.appointmentStatus.enumValues)[number],
  actorUserId: string,
  reason?: string | null,
) {
  await withTenant(businessId, async (tx) => {
    await tx
      .update(schema.appointments)
      .set({
        status,
        cancelledAt: status === "cancelled" ? new Date() : null,
        cancellationReason: status === "cancelled" ? (reason ?? null) : null,
      })
      .where(eq(schema.appointments.id, appointmentId));
    await tx
      .update(schema.appointmentItems)
      .set({ status })
      .where(and(eq(schema.appointmentItems.appointmentId, appointmentId), sql`${schema.appointmentItems.status} <> 'cancelled'`));
    if (status === "cancelled" || status === "no_show") {
      const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, appointmentId), columns: { clientId: true } });
      await refreshHomeLocation(tx, appt?.clientId);
    }
    await audit(tx, businessId, actorUserId, `appointment.${status}`, appointmentId, reason ? { reason } : undefined);
  });
  if (status === "no_show") {
    const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, businessId) });
    if (business) {
      const wf = await import("@/server/workflows");
      await wf.resyncAppointmentRuns(business, appointmentId, "cancelled");
      await wf.triggerAppointmentWorkflows(business, "appointment_no_show", appointmentId);
    }
  }
}

export async function updateAppointmentNotes(businessId: string, appointmentId: string, notes: string | null, actorUserId: string) {
  await withTenant(businessId, async (tx) => {
    await tx.update(schema.appointments).set({ notes }).where(eq(schema.appointments.id, appointmentId));
    await audit(tx, businessId, actorUserId, "appointment.notes", appointmentId);
  });
}
