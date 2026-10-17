import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db, schema, withTenant, type TenantDb } from "@angelic/db";
import { buildBookingSegments, instantToISODate, isInsideCancelWindow, rowsForDate, weekdayOf } from "@angelic/core";
import { timingFor, withinWorkingBlocks, workingBlocksFor } from "./availability";
import { refreshHomeLocation, serviceOfferedAt } from "./locations";

export class BookingError extends Error {}
/** The time clashes with another visit or a class on that provider's calendar. The desk can book it anyway (allowOverlap). */
export class OverlapError extends BookingError {}

type Tx = TenantDb;

/** Insert the time segments for one service into an existing appointment. */
async function insertServiceItems(
  tx: Tx,
  input: { businessId: string; appointmentId: string; serviceId: string; staffId: string; startAt: Date; sortOrderBase: number; allowOverlap?: boolean },
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
  // A deliberate double-booking skips the clash checks (other visits and classes) but never lands on blocked time.
  if (input.allowOverlap) await assertNoBlock(tx, input.staffId, segments);
  else await assertNoClassClash(tx, input.staffId, segments);
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
      allowOverlap: input.allowOverlap === true,
    })),
  );
  return { service, segments };
}

/** A booking saved with a promo code takes one of its uses (checked under the code's lock, in the booking's own transaction). */
async function promoRoom(tx: Tx, promoCodeId: string) {
  const { assertPromoRoom, PromoError } = await import("./promos");
  try {
    await assertPromoRoom(tx, promoCodeId);
  } catch (e) {
    if (e instanceof PromoError) throw new BookingError(e.message);
    throw e;
  }
}

/** The provider is teaching a scheduled class across any of these ranges. Classes aren't appointment items, so the DB constraint can't see them. */
async function assertNoClassClash(tx: Tx, staffId: string, ranges: { start: Date; end: Date }[]) {
  if (!ranges.length) return;
  const from = new Date(Math.min(...ranges.map((r) => r.start.getTime())));
  const to = new Date(Math.max(...ranges.map((r) => r.end.getTime())));
  const classes = await tx
    .select({ start: schema.classSessions.startAt, end: sql<Date>`${schema.classSessions.endAt} + make_interval(mins => coalesce(${schema.services.bufferAfterMin}, 0)::int)`.mapWith(schema.classSessions.endAt) })
    .from(schema.classSessions)
    .leftJoin(schema.services, eq(schema.services.id, schema.classSessions.serviceId))
    // A class blocks its cleanup time too.
    .where(and(eq(schema.classSessions.staffId, staffId), eq(schema.classSessions.status, "scheduled"), lt(schema.classSessions.startAt, to), sql`${schema.classSessions.endAt} + make_interval(mins => coalesce(${schema.services.bufferAfterMin}, 0)::int) > ${from.toISOString()}::timestamptz`));
  if (classes.some((c) => ranges.some((r) => r.start < c.end && c.start < r.end))) throw new OverlapError("That time overlaps a class this provider is teaching. Please pick another.");
}

/** Blocked time (lunch, time off) on these ranges. Only needed for a double-booking: otherwise the DB constraint already refuses it. */
async function assertNoBlock(tx: Tx, staffId: string, ranges: { start: Date; end: Date }[]) {
  for (const r of ranges) {
    const [hit] = await tx
      .select({ id: schema.appointmentItems.id })
      .from(schema.appointmentItems)
      .innerJoin(schema.appointments, eq(schema.appointments.id, schema.appointmentItems.appointmentId))
      .where(and(eq(schema.appointmentItems.staffId, staffId), eq(schema.appointments.kind, "block"), sql`${schema.appointmentItems.status} <> 'cancelled'`, lt(schema.appointmentItems.startAt, r.end), gt(schema.appointmentItems.endAt, r.start)))
      .limit(1);
    if (hit) throw new BookingError("That time is blocked off on this provider's calendar. Remove the block first.");
  }
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
  if (code === "23P01") throw new OverlapError("That time was just taken. Please pick another slot.");
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
  deposit?: { paymentIntentId: string; cents: number; cardLabel: string | null; accountId?: string | null } | null;
  /** SetupIntent that saved a card on file at booking. */
  cardSetupIntentId?: string | null;
  /** Book a seat in this class session instead of a one-to-one slot. */
  classSessionId?: string | null;
  /** Promo code to apply when checkout opens. */
  promoCodeId?: string | null;
  /** Online bookings: the cancellation policy the client agreed to by booking. */
  policy?: { text: string; ip: string | null } | null;
  /** Where the visit happens. Defaults to where the provider works that weekday, else their primary site, else the default. */
  locationId?: string | null;
  /** More services booked in the same visit, with the same provider, each starting where the last one ends. */
  extras?: { serviceId: string; startAt: Date }[];
  /**
   * Double-book on purpose: the new services may overlap the provider's other visits and classes (a quick add-on while colour
   * processes), but not blocked time. Desk only, for someone who can manage any appointment; always ignored online. Working hours
   * aren't checked here either way (the desk may book outside them; online checks them before it gets here).
   */
  allowOverlap?: boolean;
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
  // Online bookings never double-book, whatever the caller passed. (A class seat isn't a one-to-one slot, so it doesn't apply.)
  const allowOverlap = input.allowOverlap === true && input.source !== "online" && !input.classSessionId;
  if (input.classSessionId) {
    const { insertSeat } = await import("./classes");
    return withTenant(input.businessId, async (tx) => {
      if (input.promoCodeId) await promoRoom(tx, input.promoCodeId);
      const r = await insertSeat(tx, { businessId: input.businessId, sessionId: input.classSessionId!, clientId: input.clientId, notes: input.notes ?? null, source: input.source ?? "staff", createdByUserId: input.createdByUserId ?? null, deposit: input.deposit, cardSetupIntentId: input.cardSetupIntentId, promoCodeId: input.promoCodeId });
      if (input.policy) await tx.update(schema.appointments).set({ policyText: input.policy.text, policyAcceptedAt: new Date(), policyAcceptedIp: input.policy.ip }).where(eq(schema.appointments.id, r.appointmentId));
      return { appointmentId: r.appointmentId };
    });
  }
  try {
    return await withTenant(input.businessId, async (tx) => {
      const biz = await tx.query.businesses.findFirst({ where: eq(schema.businesses.id, input.businessId), columns: { timezone: true } });
      const locationId = await resolveAppointmentLocation(tx, input.staffId, input.startAt, biz?.timezone ?? "America/New_York", input.locationId);
      if (!(await serviceOfferedAt(tx, input.serviceId, locationId))) throw new BookingError("That service isn't offered at this location.");
      if (input.promoCodeId) await promoRoom(tx, input.promoCodeId);
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
            ? { depositCents: input.deposit.cents, depositStatus: "paid" as const, depositPaymentIntentId: input.deposit.paymentIntentId, depositStripeAccountId: input.deposit.accountId ?? null, depositCardLabel: input.deposit.cardLabel }
            : {}),
          cardSetupIntentId: input.cardSetupIntentId ?? null,
          promoCodeId: input.promoCodeId ?? null,
          ...(input.policy ? { policyText: input.policy.text, policyAcceptedAt: new Date(), policyAcceptedIp: input.policy.ip } : {}),
        })
        .returning({ id: schema.appointments.id });
      const firstItems = await insertServiceItems(tx, { ...input, allowOverlap, appointmentId: appt!.id, sortOrderBase: 0 });
      let order = firstItems.segments.length;
      for (const x of input.extras ?? []) {
        if (!(await serviceOfferedAt(tx, x.serviceId, locationId))) throw new BookingError("One of the added services isn't offered at this location.");
        const r = await insertServiceItems(tx, { businessId: input.businessId, appointmentId: appt!.id, serviceId: x.serviceId, staffId: input.staffId, startAt: x.startAt, sortOrderBase: order, allowOverlap });
        order += r.segments.length;
      }
      await refreshHomeLocation(tx, input.clientId);
      await audit(tx, input.businessId, input.source === "online" ? "client" : input.createdByUserId, "appointment.create", appt!.id, {
        serviceId: input.serviceId,
        staffId: input.staffId,
        startAt: input.startAt,
        ...(input.seriesId ? { seriesId: input.seriesId } : {}),
        ...(input.deposit ? { depositCents: input.deposit.cents } : {}),
      });
      if (allowOverlap) await audit(tx, input.businessId, input.createdByUserId, "appointment.double_booked", appt!.id, { staffId: input.staffId, startAt: input.startAt });
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
  /** Double-book on purpose (desk only), as in bookAppointment. */
  allowOverlap?: boolean;
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
        ...(input.allowOverlap ? { doubleBooked: true } : {}),
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
      const biz = await tx.query.businesses.findFirst({ where: eq(schema.businesses.id, input.businessId), columns: { timezone: true } });
      const tz = biz?.timezone ?? "America/New_York";
      const moved = siblings.map((s) => ({ start: new Date(s.startAt.getTime() + deltaMs), end: new Date(s.endAt.getTime() + deltaMs) }));
      const day = instantToISODate(moved[0]!.start, tz);
      const blocks = (await workingBlocksFor({ businessId: input.businessId, timeZone: tz, staffIds: [staffId], dates: [day] })).get(`${staffId}:${day}`) ?? [];
      if (!withinWorkingBlocks(blocks, moved)) {
        const when = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz }).format(moved[0]!.start);
        throw new BookingError(blocks.length ? `${target.displayName} isn't working at ${when}. Pick a time inside their hours, or change their hours under Staff.` : `${target.displayName} is off on ${when.split(",")[0]}.`);
      }
      await assertNoClassClash(tx, staffId, moved);
      // A different provider charges their own price, and a single-block service takes their own length (a service with processing
      // time keeps its shape; its price still follows the provider).
      let priceFor: number | null = null;
      let lengthMin: number | null = null;
      if (staffId !== item.staffId && item.serviceId) {
        const svc = await tx.query.services.findFirst({ where: eq(schema.services.id, item.serviceId), columns: { priceCents: true, durationMin: true } });
        const own = await tx.query.staffServices.findFirst({ where: and(eq(schema.staffServices.staffId, staffId), eq(schema.staffServices.serviceId, item.serviceId)) });
        if (svc) {
          priceFor = own?.priceCentsOverride ?? svc.priceCents;
          if (siblings.length === 1) lengthMin = own?.durationMinOverride ?? svc.durationMin;
        }
      }
      const priced = siblings.find((x) => x.priceCents > 0) ?? first;
      await tx.execute(sql`set constraints appointment_items_no_double_booking deferred`);
      for (const s of siblings) {
        const start = new Date(s.startAt.getTime() + deltaMs);
        await tx
          .update(schema.appointmentItems)
          .set({ startAt: start, endAt: lengthMin !== null ? new Date(start.getTime() + lengthMin * 60_000) : new Date(s.endAt.getTime() + deltaMs), staffId, ...(priceFor !== null && s.id === priced.id ? { priceCents: priceFor } : {}) })
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
 * Move a whole appointment (every live service) to a new start, keeping the gaps between services.
 * One transaction with the overlap check deferred, so services that follow each other can swap into
 * each other's old times.
 */
export async function rescheduleAppointment(input: { businessId: string; appointmentId: string; newStartAt: Date; actorUserId: string }) {
  try {
    await withTenant(input.businessId, async (tx) => {
      const items = (await tx.select().from(schema.appointmentItems).where(eq(schema.appointmentItems.appointmentId, input.appointmentId)))
        .filter((i) => i.status !== "cancelled" && i.status !== "completed" && i.status !== "no_show")
        .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
      if (!items.length) throw new BookingError("This appointment can no longer be moved.");
      if (items.some((i) => i.classSessionId)) throw new BookingError("Seats in a class move with the class. Cancel the seat and book another session instead.");
      const deltaMs = input.newStartAt.getTime() - items[0]!.startAt.getTime();
      if (deltaMs === 0) return;
      const biz = await tx.query.businesses.findFirst({ where: eq(schema.businesses.id, input.businessId), columns: { timezone: true } });
      const tz = biz?.timezone ?? "America/New_York";
      const moved = items.map((i) => ({ item: i, start: new Date(i.startAt.getTime() + deltaMs), end: new Date(i.endAt.getTime() + deltaMs) }));
      const staffIds = [...new Set(moved.map((m) => m.item.staffId))];
      const dates = [...new Set(moved.map((m) => instantToISODate(m.start, tz)))];
      const blocks = await workingBlocksFor({ businessId: input.businessId, timeZone: tz, staffIds, dates });
      for (const staffId of staffIds) {
        for (const day of dates) {
          const mine = moved.filter((m) => m.item.staffId === staffId && instantToISODate(m.start, tz) === day);
          if (!mine.length) continue;
          if (!withinWorkingBlocks(blocks.get(`${staffId}:${day}`) ?? [], mine)) throw new BookingError("That time doesn't fit every service in this appointment. Please pick another.");
        }
      }
      await tx.execute(sql`set constraints appointment_items_no_double_booking deferred`);
      for (const staffId of staffIds) await assertNoClassClash(tx, staffId, moved.filter((m) => m.item.staffId === staffId));
      for (const m of moved) await tx.update(schema.appointmentItems).set({ startAt: m.start, endAt: m.end }).where(eq(schema.appointmentItems.id, m.item.id));
      await followProviderLocation(tx, input.businessId, input.appointmentId);
      await audit(tx, input.businessId, input.actorUserId, "appointment.reschedule", input.appointmentId, { from: items[0]!.startAt, to: input.newStartAt, items: items.length });
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
      const biz = await tx.query.businesses.findFirst({ where: eq(schema.businesses.id, input.businessId), columns: { timezone: true } });
      const locationId = await resolveAppointmentLocation(tx, input.staffId, input.startAt, biz?.timezone ?? "America/New_York", input.locationId);
      const [appt] = await tx
        .insert(schema.appointments)
        .values({ businessId: input.businessId, locationId, clientId: null, kind: "block", notes: input.reason, createdByUserId: input.actorUserId.startsWith("api:") ? null : input.actorUserId, source: "staff" }) // API keys are not users: the audit row below names the key
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
  /** The managed reason picked from the list (cancellation_reasons.id). Who cancelled is "client" when the actor is the client, else staff. */
  reasonId?: string | null,
): Promise<boolean> {
  let changed = false;
  try {
  await withTenant(businessId, async (tx) => {
    // The few rules every path follows (desk, calendar, API, app): a cancelled visit stays cancelled (book it again instead, since its
    // time may be taken), and setting the status it already has changes nothing (no second message or log).
    const [cur] = await tx.select({ status: schema.appointments.status }).from(schema.appointments).where(eq(schema.appointments.id, appointmentId)).for("update");
    if (!cur) throw new BookingError("Appointment not found.");
    if (cur.status === status) return;
    if (cur.status === "cancelled") throw new BookingError("This appointment is cancelled. Book it again instead.");
    let cancelledLate: boolean | null = null;
    let cleanReasonId: string | null = null;
    if (status === "cancelled") {
      // Whether it fell inside the cancellation window is recorded now, so Reports stay right if the policy changes later.
      const [first] = await tx.select({ startAt: schema.appointmentItems.startAt }).from(schema.appointmentItems).where(and(eq(schema.appointmentItems.appointmentId, appointmentId), sql`${schema.appointmentItems.status} <> 'cancelled'`)).orderBy(schema.appointmentItems.startAt).limit(1);
      const biz = await tx.query.businesses.findFirst({ where: eq(schema.businesses.id, businessId), columns: { cancelWindowHours: true } });
      cancelledLate = first && biz ? isInsideCancelWindow(first.startAt, biz.cancelWindowHours) : null;
      if (reasonId) {
        const ok = await tx.query.cancellationReasons.findFirst({ where: eq(schema.cancellationReasons.id, reasonId), columns: { id: true } });
        if (!ok) throw new BookingError("Pick a reason from the list.");
        cleanReasonId = ok.id;
      }
    }
    await tx
      .update(schema.appointments)
      .set({
        status,
        cancelledAt: status === "cancelled" ? new Date() : null,
        cancellationReason: status === "cancelled" ? (reason ?? null) : null,
        cancellationReasonId: cleanReasonId,
        cancelledBy: status === "cancelled" ? (actorUserId === "client" ? "client" : "staff") : null,
        cancelledLate,
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
    await audit(tx, businessId, actorUserId, `appointment.${status}`, appointmentId, reason || reasonId ? { reason, reasonId } : undefined);
    changed = true;
  });
  } catch (e) {
    // Undoing a no-show or a completion puts the visit back on the calendar, where its time may have been taken since.
    if ((e as { code?: string }).code === "23P01" || (e as { cause?: { code?: string } }).cause?.code === "23P01") throw new BookingError("That time has been booked since. Move the appointment first.");
    throw e;
  }
  if (changed && status === "no_show") {
    const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, businessId) });
    if (business) {
      const wf = await import("@/server/workflows");
      await wf.resyncAppointmentRuns(business, appointmentId, "cancelled");
      await wf.triggerAppointmentWorkflows(business, "appointment_no_show", appointmentId);
    }
  }
  return changed;
}

export async function updateAppointmentNotes(businessId: string, appointmentId: string, notes: string | null, actorUserId: string) {
  await withTenant(businessId, async (tx) => {
    await tx.update(schema.appointments).set({ notes }).where(eq(schema.appointments.id, appointmentId));
    await audit(tx, businessId, actorUserId, "appointment.notes", appointmentId);
  });
}
