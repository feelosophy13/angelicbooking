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
import { staffIdsAt } from "./locations";

const LIVE_STATUSES_EXCLUDED = ["cancelled", "no_show"] as const;

export function timingFor(s: {
  durationMin: number;
  gapMin: number;
  finishMin: number;
  bufferAfterMin: number;
}): ServiceTiming {
  return { durationMin: s.durationMin, gapMin: s.gapMin, finishMin: s.finishMin, bufferAfterMin: s.bufferAfterMin };
}

type AvailabilityOpts = {
  businessId: string;
  timeZone: string;
  slotIntervalMin: number;
  staffId: string;
  service: ServiceTiming;
  notBefore?: Date;
  locationId?: string | null;
};

/**
 * Open slots for one staff member performing one service on one date.
 * Each weekly-hours row belongs to a location (its own, else the staff member's
 * primary, else the default); a block is capped by that location's opening hours.
 * With `locationId`, only the blocks at that location count.
 */
export async function getStaffAvailability(opts: AvailabilityOpts & { date: string }): Promise<Date[]> {
  const byDate = await getStaffAvailabilityForDates({ ...opts, dates: [opts.date] });
  return byDate.get(opts.date) ?? [];
}

/**
 * Same as getStaffAvailability for many dates at once (a month of the public
 * calendar): the schedule, overrides, bookings and classes are fetched once for
 * the whole range instead of once per day.
 */
export async function getStaffAvailabilityForDates(opts: AvailabilityOpts & { dates: string[] }): Promise<Map<string, Date[]>> {
  const { businessId, timeZone, staffId } = opts;
  const dates = [...new Set(opts.dates)].sort();
  const out = new Map<string, Date[]>();
  if (!dates.length) return out;
  // Fetch a generous window so items spanning midnight are included.
  const windowStart = zonedToInstant(shiftISODate(dates[0]!, -1), "00:00", timeZone);
  const windowEnd = zonedToInstant(shiftISODate(dates[dates.length - 1]!, 2), "00:00", timeZone);

  return withTenant(businessId, async (tx) => {
    const [weekly, overrides, items, sessions, person, locations] = await Promise.all([
      tx
        .select({ weekday: schema.staffSchedules.weekday, start: schema.staffSchedules.startTime, end: schema.staffSchedules.endTime, locationId: schema.staffSchedules.locationId })
        .from(schema.staffSchedules)
        .where(eq(schema.staffSchedules.staffId, staffId)),
      tx
        .select()
        .from(schema.staffScheduleOverrides)
        .where(and(eq(schema.staffScheduleOverrides.staffId, staffId), inArray(schema.staffScheduleOverrides.date, dates))),
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
      tx.select({ id: schema.locations.id, isDefault: schema.locations.isDefault, hours: schema.locations.hours, timezone: schema.locations.timezone }).from(schema.locations),
    ]);
    const fallbackLoc = person?.locationId ?? locations.find((l) => l.isDefault)?.id ?? locations[0]?.id ?? null;
    const locOf = (r: { locationId: string | null }) => r.locationId ?? fallbackLoc;
    const openAt = (locId: string | null, weekday: number) => {
      const l = locations.find((x) => x.id === locId);
      return l?.hours ? (l.hours[String(weekday)] ?? null) : undefined;
    };
    // A location in another timezone keeps its own wall clock.
    const tzAt = (locId: string | null) => locations.find((x) => x.id === locId)?.timezone ?? timeZone;
    const busy: Interval[] = [...items, ...sessions].map((i) => ({ start: i.start, end: i.end }));

    for (const date of dates) {
      const weekday = weekdayOf(date);
      const override = overrides.find((o) => o.date === date);
      const ov = override ? { date: override.date, isOff: override.isOff, start: override.startTime, end: override.endTime } : null;
      const todays = weekly.filter((r) => r.weekday === weekday);
      // Working blocks per location (each with its own opening hours and clock).
      const blocksByLoc = new Map<string | null, ReturnType<typeof resolveWorkingBlocks>>();
      if (ov) {
        // A day override replaces the weekly rows; it happens wherever the provider normally works that day.
        const dayLoc = todays[0] ? locOf(todays[0]) : fallbackLoc;
        if (!opts.locationId || dayLoc === opts.locationId) blocksByLoc.set(dayLoc, clampToOpenHours(resolveWorkingBlocks(date, weekday, [], ov), openAt(dayLoc, weekday)));
      } else {
        const byLoc = new Map<string | null, typeof todays>();
        for (const r of todays) {
          const l = locOf(r);
          if (opts.locationId && l !== opts.locationId) continue;
          byLoc.set(l, [...(byLoc.get(l) ?? []), r]);
        }
        for (const [l, rows] of byLoc) blocksByLoc.set(l, clampToOpenHours(resolveWorkingBlocks(date, weekday, rows, null), openAt(l, weekday)));
      }
      const slots = new Map<number, Date>();
      for (const [l, workingBlocks] of blocksByLoc) {
        for (const at of computeAvailableSlots({ date, timeZone: tzAt(l), workingBlocks, busy, service: opts.service, slotIntervalMin: opts.slotIntervalMin, notBefore: opts.notBefore })) slots.set(at.getTime(), at);
      }
      out.set(date, [...slots.values()].sort((a, b) => a.getTime() - b.getTime()));
    }
    return out;
  });
}

export type WorkingInterval = { start: Date; end: Date };

/**
 * Working blocks (as instants) per staff member per date, honouring day
 * overrides, each block's location opening hours and that location's clock.
 * Key: `${staffId}:${date}`. A key present with an empty array means a day off.
 */
export async function workingBlocksFor(opts: { businessId: string; timeZone: string; staffIds: string[]; dates: string[]; locationId?: string | null }): Promise<Map<string, WorkingInterval[]>> {
  const out = new Map<string, WorkingInterval[]>();
  const dates = [...new Set(opts.dates)].sort();
  const staffIds = [...new Set(opts.staffIds)];
  if (!dates.length || !staffIds.length) return out;
  return withTenant(opts.businessId, async (tx) => {
    const [weekly, overrides, people, locations] = await Promise.all([
      tx.select({ staffId: schema.staffSchedules.staffId, weekday: schema.staffSchedules.weekday, start: schema.staffSchedules.startTime, end: schema.staffSchedules.endTime, locationId: schema.staffSchedules.locationId }).from(schema.staffSchedules).where(inArray(schema.staffSchedules.staffId, staffIds)),
      tx.select().from(schema.staffScheduleOverrides).where(and(inArray(schema.staffScheduleOverrides.staffId, staffIds), inArray(schema.staffScheduleOverrides.date, dates))),
      tx.select({ id: schema.staff.id, locationId: schema.staff.locationId }).from(schema.staff).where(inArray(schema.staff.id, staffIds)),
      tx.select({ id: schema.locations.id, isDefault: schema.locations.isDefault, hours: schema.locations.hours, timezone: schema.locations.timezone }).from(schema.locations),
    ]);
    const defaultLoc = locations.find((l) => l.isDefault)?.id ?? locations[0]?.id ?? null;
    for (const staffId of staffIds) {
      const fallbackLoc = people.find((p) => p.id === staffId)?.locationId ?? defaultLoc;
      const locOf = (r: { locationId: string | null }) => r.locationId ?? fallbackLoc;
      const openAt = (locId: string | null, weekday: number) => {
        const l = locations.find((x) => x.id === locId);
        return l?.hours ? (l.hours[String(weekday)] ?? null) : undefined;
      };
      const tzAt = (locId: string | null) => locations.find((x) => x.id === locId)?.timezone ?? opts.timeZone;
      const mine = weekly.filter((r) => r.staffId === staffId);
      for (const date of dates) {
        const weekday = weekdayOf(date);
        const override = overrides.find((o) => o.staffId === staffId && o.date === date);
        const ov = override ? { date: override.date, isOff: override.isOff, start: override.startTime, end: override.endTime } : null;
        const todays = mine.filter((r) => r.weekday === weekday);
        const blocks: WorkingInterval[] = [];
        const push = (loc: string | null, local: { start: string; end: string }[]) => {
          for (const b of local) blocks.push({ start: zonedToInstant(date, b.start, tzAt(loc)), end: b.end === "24:00" ? zonedToInstant(date, "23:59", tzAt(loc)) : zonedToInstant(date, b.end, tzAt(loc)) });
        };
        if (ov) {
          const dayLoc = todays[0] ? locOf(todays[0]) : fallbackLoc;
          if (!opts.locationId || dayLoc === opts.locationId) push(dayLoc, clampToOpenHours(resolveWorkingBlocks(date, weekday, [], ov), openAt(dayLoc, weekday)));
        } else {
          const byLoc = new Map<string | null, typeof todays>();
          for (const r of todays) {
            const l = locOf(r);
            if (opts.locationId && l !== opts.locationId) continue;
            byLoc.set(l, [...(byLoc.get(l) ?? []), r]);
          }
          for (const [l, rows] of byLoc) push(l, clampToOpenHours(resolveWorkingBlocks(date, weekday, rows, null), openAt(l, weekday)));
        }
        out.set(`${staffId}:${date}`, blocks.sort((a, b) => a.start.getTime() - b.start.getTime()));
      }
    }
    return out;
  });
}

/** Every segment must sit inside one of the provider's working blocks that day. */
export function withinWorkingBlocks(blocks: WorkingInterval[], segments: Interval[]): boolean {
  return segments.every((s) => blocks.some((b) => s.start >= b.start && s.end <= b.end));
}

/** Staff who can perform a service (or all active staff if no mapping exists yet), optionally only those working at a location. */
export async function staffForService(businessId: string, serviceId: string, locationId?: string | null) {
  return withTenant(businessId, async (tx) => {
    const mapped = await tx
      .select({ staffId: schema.staffServices.staffId })
      .from(schema.staffServices)
      .where(eq(schema.staffServices.serviceId, serviceId));
    const where = mapped.length
      ? and(eq(schema.staff.active, true), eq(schema.staff.takesAppointments, true), inArray(schema.staff.id, mapped.map((m) => m.staffId)))
      : and(eq(schema.staff.active, true), eq(schema.staff.takesAppointments, true));
    const rows = await tx.select().from(schema.staff).where(where).orderBy(schema.staff.sortOrder, schema.staff.displayName);
    const at = await staffIdsAt(tx, locationId);
    return at ? rows.filter((r) => at.has(r.id)) : rows;
  });
}
