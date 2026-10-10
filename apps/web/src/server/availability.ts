import { and, eq, gte, inArray, lt, notInArray } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import {
  clampToOpenHours,
  computeAvailableSlots,
  resolveWorkingBlocks,
  weekdayOf,
  zonedToInstant,
  type Interval,
  type ServiceTiming,
} from "@angelic/core";
import { shiftISODate } from "@/lib/utils";

const LIVE_STATUSES_EXCLUDED = ["cancelled", "no_show"] as const;

export function timingFor(s: {
  durationMin: number;
  gapMin: number;
  finishMin: number;
  bufferAfterMin: number;
}): ServiceTiming {
  return { durationMin: s.durationMin, gapMin: s.gapMin, finishMin: s.finishMin, bufferAfterMin: s.bufferAfterMin };
}

/** Open slots for one staff member performing one service on one date. */
export async function getStaffAvailability(opts: {
  businessId: string;
  timeZone: string;
  slotIntervalMin: number;
  staffId: string;
  date: string; // YYYY-MM-DD
  service: ServiceTiming;
  notBefore?: Date;
}): Promise<Date[]> {
  const { businessId, timeZone, date, staffId } = opts;
  const weekday = weekdayOf(date);
  // Fetch a generous window so items spanning midnight are included.
  const windowStart = zonedToInstant(shiftISODate(date, -1), "00:00", timeZone);
  const windowEnd = zonedToInstant(shiftISODate(date, 2), "00:00", timeZone);

  return withTenant(businessId, async (tx) => {
    const [weekly, override, items, sessions, person, locations] = await Promise.all([
      tx
        .select({ weekday: schema.staffSchedules.weekday, start: schema.staffSchedules.startTime, end: schema.staffSchedules.endTime })
        .from(schema.staffSchedules)
        .where(eq(schema.staffSchedules.staffId, staffId)),
      tx.query.staffScheduleOverrides.findFirst({
        where: and(eq(schema.staffScheduleOverrides.staffId, staffId), eq(schema.staffScheduleOverrides.date, date)),
      }),
      tx
        .select({ start: schema.appointmentItems.startAt, end: schema.appointmentItems.endAt })
        .from(schema.appointmentItems)
        .where(
          and(
            eq(schema.appointmentItems.staffId, staffId),
            notInArray(schema.appointmentItems.status, [...LIVE_STATUSES_EXCLUDED]),
            gte(schema.appointmentItems.startAt, windowStart),
            lt(schema.appointmentItems.startAt, windowEnd),
          ),
        ),
      // Scheduled classes block the instructor even before anyone has enrolled.
      tx
        .select({ start: schema.classSessions.startAt, end: schema.classSessions.endAt })
        .from(schema.classSessions)
        .where(and(eq(schema.classSessions.staffId, staffId), eq(schema.classSessions.status, "scheduled"), gte(schema.classSessions.startAt, windowStart), lt(schema.classSessions.startAt, windowEnd))),
      tx.query.staff.findFirst({ where: eq(schema.staff.id, staffId), columns: { locationId: true } }),
      tx.select({ id: schema.locations.id, isDefault: schema.locations.isDefault, hours: schema.locations.hours }).from(schema.locations),
    ]);
    // The provider's location (or the default one) caps availability with its opening hours.
    const location = locations.find((l) => l.id === person?.locationId) ?? locations.find((l) => l.isDefault) ?? null;
    const open = location?.hours ? (location.hours[String(weekday)] ?? null) : undefined;

    const workingBlocks = clampToOpenHours(
      resolveWorkingBlocks(date, weekday, weekly, override ? { date: override.date, isOff: override.isOff, start: override.startTime, end: override.endTime } : null),
      open,
    );
    const busy: Interval[] = [...items, ...sessions].map((i) => ({ start: i.start, end: i.end }));
    return computeAvailableSlots({
      date,
      timeZone,
      workingBlocks,
      busy,
      service: opts.service,
      slotIntervalMin: opts.slotIntervalMin,
      notBefore: opts.notBefore,
    });
  });
}

/** Staff who can perform a service (or all active staff if no mapping exists yet). */
export async function staffForService(businessId: string, serviceId: string) {
  return withTenant(businessId, async (tx) => {
    const mapped = await tx
      .select({ staffId: schema.staffServices.staffId })
      .from(schema.staffServices)
      .where(eq(schema.staffServices.serviceId, serviceId));
    const where = mapped.length
      ? and(eq(schema.staff.active, true), eq(schema.staff.takesAppointments, true), inArray(schema.staff.id, mapped.map((m) => m.staffId)))
      : and(eq(schema.staff.active, true), eq(schema.staff.takesAppointments, true));
    return tx.select().from(schema.staff).where(where).orderBy(schema.staff.sortOrder, schema.staff.displayName);
  });
}
