/**
 * Standing appointments: "every N weeks, M times". Each occurrence is an
 * ordinary appointment linked by series_id and booked in its own transaction,
 * so one clash (a day off, another booking) skips that date instead of
 * aborting the whole series.
 */
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { buildBookingSegments, instantToISODate, seriesOccurrences } from "@angelic/core";
import { bookAppointment, BookingError, setAppointmentStatus } from "./booking";
import { withinWorkingBlocks, workingBlocksFor } from "./availability";
import { timingForStaff } from "./stylist-pricing";

export const SERIES_INTERVALS = [1, 2, 3, 4, 5, 6, 8, 12] as const;
export const MAX_SERIES_OCCURRENCES = 52;

export interface CreateSeriesInput {
  businessId: string;
  timeZone: string;
  slotIntervalMin: number;
  clientId: string | null;
  serviceId: string;
  staffId: string;
  firstStartAt: Date;
  intervalWeeks: number;
  occurrences: number;
  notes: string | null;
  createdByUserId: string;
  locationId?: string | null;
}

export interface CreateSeriesResult {
  seriesId: string;
  created: { appointmentId: string; startAt: Date }[];
  skipped: { startAt: Date; reason: string }[];
}

export async function createSeries(input: CreateSeriesInput): Promise<CreateSeriesResult> {
  if (!SERIES_INTERVALS.includes(input.intervalWeeks as (typeof SERIES_INTERVALS)[number])) throw new BookingError("Pick how often the appointment repeats.");
  if (input.occurrences < 2 || input.occurrences > MAX_SERIES_OCCURRENCES) throw new BookingError(`A series has between 2 and ${MAX_SERIES_OCCURRENCES} visits.`);
  const service = await withTenant(input.businessId, (tx) => tx.query.services.findFirst({ where: eq(schema.services.id, input.serviceId) }));
  if (!service || !service.active) throw new BookingError("That service is no longer available.");
  const [series] = await withTenant(input.businessId, (tx) =>
    tx
      .insert(schema.appointmentSeries)
      .values({
        businessId: input.businessId,
        clientId: input.clientId,
        serviceId: input.serviceId,
        staffId: input.staffId,
        intervalWeeks: input.intervalWeeks,
        firstStartAt: input.firstStartAt,
        occurrences: input.occurrences,
        notes: input.notes,
        createdByUserId: input.createdByUserId,
      })
      .returning({ id: schema.appointmentSeries.id }),
  );
  const result: CreateSeriesResult = { seriesId: series!.id, created: [], skipped: [] };
  const timing = await timingForStaff(input.businessId, service, input.staffId);
  for (const startAt of seriesOccurrences(input.firstStartAt, input.intervalWeeks, input.occurrences, input.timeZone)) {
    // Respect working hours and time off for each date. Any start inside them works (a custom 10:20 needn't sit on the slot grid);
    // clashes with other bookings and classes are caught when booking.
    const day = instantToISODate(startAt, input.timeZone);
    const blocks = (await workingBlocksFor({ businessId: input.businessId, timeZone: input.timeZone, staffIds: [input.staffId], dates: [day], locationId: input.locationId })).get(`${input.staffId}:${day}`) ?? [];
    if (!withinWorkingBlocks(blocks, buildBookingSegments(startAt, timing))) {
      result.skipped.push({ startAt, reason: "not available" });
      continue;
    }
    try {
      const { appointmentId } = await bookAppointment({ ...input, startAt, seriesId: series!.id, source: "staff" });
      result.created.push({ appointmentId, startAt });
    } catch (e) {
      if (e instanceof BookingError) result.skipped.push({ startAt, reason: e.message });
      else throw e;
    }
  }
  if (result.created.length === 0) {
    await withTenant(input.businessId, (tx) => tx.delete(schema.appointmentSeries).where(eq(schema.appointmentSeries.id, series!.id)));
    throw new BookingError("None of those dates are available.");
  }
  return result;
}

/** The series an appointment belongs to, with every occurrence in date order. */
export async function getSeriesForAppointment(businessId: string, appointmentId: string) {
  return withTenant(businessId, async (tx) => {
    const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, appointmentId), columns: { seriesId: true } });
    if (!appt?.seriesId) return null;
    const series = await tx.query.appointmentSeries.findFirst({ where: eq(schema.appointmentSeries.id, appt.seriesId) });
    if (!series) return null;
    const rows = await tx
      .select({ id: schema.appointments.id, status: schema.appointments.status, startAt: schema.appointmentItems.startAt })
      .from(schema.appointments)
      .innerJoin(schema.appointmentItems, and(eq(schema.appointmentItems.appointmentId, schema.appointments.id), eq(schema.appointmentItems.sortOrder, 0)))
      .where(eq(schema.appointments.seriesId, series.id))
      .orderBy(asc(schema.appointmentItems.startAt));
    return { series, occurrences: rows };
  });
}

/** Cancel this occurrence and every later one that is still open; marks the series ended. */
export async function cancelSeriesFrom(input: { businessId: string; appointmentId: string; actorUserId: string; reason: string | null }): Promise<string[]> {
  const s = await getSeriesForAppointment(input.businessId, input.appointmentId);
  if (!s) throw new BookingError("This appointment is not part of a series.");
  const me = s.occurrences.find((o) => o.id === input.appointmentId);
  if (!me) throw new BookingError("Appointment not found.");
  const open = new Set(["booked", "confirmed"]);
  const targets = s.occurrences.filter((o) => o.startAt >= me.startAt && open.has(o.status)).map((o) => o.id);
  for (const id of targets) await setAppointmentStatus(input.businessId, id, "cancelled", input.actorUserId, input.reason ?? "Series cancelled");
  await withTenant(input.businessId, (tx) => tx.update(schema.appointmentSeries).set({ endedAt: new Date() }).where(eq(schema.appointmentSeries.id, s.series.id)));
  return targets;
}

/** Upcoming open appointments of a series (for the client page / reminders). */
export async function upcomingInSeries(businessId: string, seriesId: string, from = new Date()) {
  return withTenant(businessId, (tx) =>
    tx
      .select({ id: schema.appointments.id, startAt: schema.appointmentItems.startAt })
      .from(schema.appointments)
      .innerJoin(schema.appointmentItems, and(eq(schema.appointmentItems.appointmentId, schema.appointments.id), eq(schema.appointmentItems.sortOrder, 0)))
      .where(and(eq(schema.appointments.seriesId, seriesId), gte(schema.appointmentItems.startAt, from), inArray(schema.appointments.status, ["booked", "confirmed"])))
      .orderBy(asc(schema.appointmentItems.startAt)),
  );
}
