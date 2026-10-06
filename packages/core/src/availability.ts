import { addMinutes, zonedToInstant, type ISODate, type LocalTime } from "./time";

export interface Interval {
  start: Date;
  end: Date;
}

/** How a service occupies a provider's time. All values in minutes. */
export interface ServiceTiming {
  /** First active block (provider hands-on). */
  durationMin: number;
  /** Processing time after the first block where the provider is FREE (e.g. colour developing). */
  gapMin?: number;
  /** Second active block after the gap (e.g. rinse + style). */
  finishMin?: number;
  /** Clean-up buffer appended after the last active block. Blocks the provider. */
  bufferAfterMin?: number;
}

export interface LocalBlock {
  start: LocalTime;
  end: LocalTime;
}

export interface WeeklyScheduleRow {
  weekday: number; // 0..6
  start: LocalTime;
  end: LocalTime;
}

export interface ScheduleOverride {
  date: ISODate;
  isOff: boolean;
  start?: LocalTime | null;
  end?: LocalTime | null;
}

export interface BookingSegment extends Interval {
  kind: "active" | "finish";
}

/**
 * The time segments a booking starting at `start` blocks on the provider's
 * calendar. The processing gap is deliberately NOT returned: another client
 * can be booked into it.
 */
export function buildBookingSegments(start: Date, timing: ServiceTiming): BookingSegment[] {
  const gap = timing.gapMin ?? 0;
  const finish = timing.finishMin ?? 0;
  const buffer = timing.bufferAfterMin ?? 0;
  if (timing.durationMin <= 0) throw new Error("durationMin must be > 0");

  const firstEnd = addMinutes(start, timing.durationMin);
  if (gap > 0 && finish > 0) {
    const finishStart = addMinutes(firstEnd, gap);
    return [
      { kind: "active", start, end: firstEnd },
      { kind: "finish", start: finishStart, end: addMinutes(finishStart, finish + buffer) },
    ];
  }
  // No usable gap: one contiguous block (gap without a finish block just extends the service).
  return [{ kind: "active", start, end: addMinutes(firstEnd, gap + finish + buffer) }];
}

/** Total wall-clock span of a booking (first start to last end). */
export function totalSpanMin(timing: ServiceTiming): number {
  return (
    timing.durationMin + (timing.gapMin ?? 0) + (timing.finishMin ?? 0) + (timing.bufferAfterMin ?? 0)
  );
}

/** Weekly template + per-date override -> working blocks for one date. */
export function resolveWorkingBlocks(
  date: ISODate,
  weekday: number,
  weekly: WeeklyScheduleRow[],
  override?: ScheduleOverride | null,
): LocalBlock[] {
  if (override && override.date === date) {
    if (override.isOff) return [];
    if (override.start && override.end) return [{ start: override.start, end: override.end }];
  }
  return weekly
    .filter((r) => r.weekday === weekday)
    .map((r) => ({ start: r.start, end: r.end }))
    .sort((a, b) => a.start.localeCompare(b.start));
}

export interface AvailabilityInput {
  date: ISODate;
  timeZone: string;
  /** Provider's working blocks for `date` (local wall-clock). Empty => not working. */
  workingBlocks: LocalBlock[];
  /** Provider's existing commitments (absolute instants), cancelled ones excluded. */
  busy: Interval[];
  service: ServiceTiming;
  /** Candidate start times are aligned to this grid (e.g. 15). */
  slotIntervalMin: number;
  /** Earliest bookable instant. Defaults to no restriction. */
  notBefore?: Date;
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;
const within = (inner: Interval, outer: Interval) => inner.start >= outer.start && inner.end <= outer.end;

/**
 * Pure availability computation for one provider on one date.
 * Returns candidate start instants, ascending.
 *
 * A start is valid when every blocking segment of the service fits inside a
 * single working block and overlaps nothing in `busy`. The processing gap may
 * overlap anything.
 */
export function computeAvailableSlots(input: AvailabilityInput): Date[] {
  const { date, timeZone, service, slotIntervalMin } = input;
  if (slotIntervalMin <= 0) throw new Error("slotIntervalMin must be > 0");
  const busy = input.busy.filter((b) => b.start < b.end);
  const out: Date[] = [];

  for (const block of input.workingBlocks) {
    const blockStart = zonedToInstant(date, block.start, timeZone);
    const blockEnd =
      block.end === "24:00" ? zonedToInstant(date, "23:59", timeZone) : zonedToInstant(date, block.end, timeZone);
    if (blockEnd <= blockStart) continue;
    const blockIv: Interval = { start: blockStart, end: blockEnd };

    for (let t = blockStart; t < blockEnd; t = addMinutes(t, slotIntervalMin)) {
      if (input.notBefore && t < input.notBefore) continue;
      const segments = buildBookingSegments(t, service);
      const lastEnd = segments[segments.length - 1]!.end;
      if (lastEnd > blockEnd) break; // nothing later in this block can fit either
      const fits = segments.every((s) => within(s, blockIv) && !busy.some((b) => overlaps(s, b)));
      if (fits) out.push(t);
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}
