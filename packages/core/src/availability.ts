import { addMinutes, parseISODate, zonedToInstant, type ISODate, type LocalTime } from "./time";

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
  /** Week of a rotating schedule this row belongs to (0-based). Missing = 0. */
  weekIndex?: number;
}

/** A schedule that repeats every `weeks` weeks. `anchor` is any date inside a "week 0" week (weeks start Monday). */
export interface Rotation {
  weeks: number;
  anchor: ISODate | null;
}

/** ISO date of the Monday that starts the week containing `date`. */
export function mondayOf(date: ISODate): ISODate {
  const { y, mo, d } = parseISODate(date);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return dt.toISOString().slice(0, 10);
}

/** Which week of the rotation (0-based) `date` falls in. Always 0 for a schedule that repeats weekly. */
export function rotationWeekIndex(date: ISODate, rotation: Rotation | null | undefined): number {
  const weeks = rotation?.weeks ?? 1;
  if (weeks <= 1) return 0;
  const anchor = mondayOf(rotation?.anchor ?? "1970-01-05");
  const diffDays = Math.round((Date.parse(mondayOf(date) + "T00:00:00Z") - Date.parse(anchor + "T00:00:00Z")) / 86_400_000);
  const w = Math.floor(diffDays / 7) % weeks;
  return (w + weeks) % weeks;
}

/** The weekly rows that apply on `date`: the whole template for a weekly schedule, else that week's rows. */
export function rowsForDate<T extends { weekIndex?: number | null }>(date: ISODate, rows: T[], rotation: Rotation | null | undefined): T[] {
  if (!rotation || rotation.weeks <= 1) return rows;
  const w = rotationWeekIndex(date, rotation);
  return rows.filter((r) => (r.weekIndex ?? 0) === w);
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

/** Opening hours for one day; null = closed. Keys of a WeeklyHours map are weekday numbers 0 (Sunday) to 6. */
export interface OpenHours {
  open: LocalTime;
  close: LocalTime;
}
export type WeeklyHours = Record<string, OpenHours | null>;

/**
 * Keep only the part of a provider's working blocks that falls inside the
 * location's opening hours. `open` undefined = the location has no hours set
 * (no limit); null = closed that day.
 */
export function clampToOpenHours(blocks: LocalBlock[], open: OpenHours | null | undefined): LocalBlock[] {
  if (open === undefined) return blocks;
  if (open === null) return [];
  return blocks
    .map((b) => ({ start: b.start > open.open ? b.start : open.open, end: b.end < open.close ? b.end : open.close }))
    .filter((b) => b.start < b.end);
}
