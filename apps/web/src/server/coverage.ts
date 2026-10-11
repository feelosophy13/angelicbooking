import { and, asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { instantToLocalTime, weekdayOf, type WeeklyHours } from "@angelic/core";
import { shiftISODate } from "@/lib/utils";
import { workingBlocksFor } from "./availability";
import { listCategories, pathTo } from "./categories";
import { tzFor } from "./locations";

/**
 * Service coverage for one week at one location: who is in on each day and at what hours, and
 * which services someone on duty can perform during opening hours. Rotations, time off and
 * custom hours are already folded in by workingBlocksFor; this turns the result into minutes
 * of the local day so a grid can draw it with time down the side.
 */

export interface CoverageBlock { start: number; end: number } // minutes from midnight, local to the location
export interface CoverageLane { staffId: string; name: string; color: string; blocks: CoverageBlock[] }
export type StripState = "closed" | "none" | "partial" | "full";
export interface CoverageStrip {
  start: number;
  end: number;
  state: StripState;
  /** Services nobody on duty performs (names). */
  missing: string[];
  missingCount: number;
  /** The same by top-level category, with how much of the category that is: "12 of 24 Facials", "all 6 Brows". */
  missingGroups: string[];
}
export interface CoverageDay {
  date: string;
  weekday: number;
  open: CoverageBlock | null;
  lanes: CoverageLane[];
  strip: CoverageStrip[];
  /** Open stretches with no provider at all. */
  uncovered: CoverageBlock[];
}
export interface Coverage {
  days: CoverageDay[];
  /** Vertical extent of the grid in minutes, on whole hours. */
  startMin: number;
  endMin: number;
  staff: { id: string; name: string; color: string }[];
  /** What the strip and gaps are judged against. */
  scope: { label: string; serviceCount: number };
  timeZone: string;
}

const SLOT = 30;
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };

export async function buildCoverage(
  business: { id: string; timezone: string; name: string },
  opts: { weekStart: string; locationId: string | null; serviceId?: string | null; categoryId?: string | null },
): Promise<Coverage> {
  const dates = Array.from({ length: 7 }, (_, i) => shiftISODate(opts.weekStart, i));
  const { staff, services, staffServices, locations, cats } = await withTenant(business.id, async (tx) => ({
    staff: await tx.select({ id: schema.staff.id, name: schema.staff.displayName, color: schema.staff.color }).from(schema.staff).where(and(eq(schema.staff.active, true), eq(schema.staff.takesAppointments, true))).orderBy(asc(schema.staff.sortOrder), asc(schema.staff.displayName)),
    services: await tx.select({ id: schema.services.id, name: schema.services.name, categoryId: schema.services.categoryId }).from(schema.services).where(eq(schema.services.active, true)).orderBy(asc(schema.services.name)),
    staffServices: await tx.select({ staffId: schema.staffServices.staffId, serviceId: schema.staffServices.serviceId }).from(schema.staffServices),
    locations: await tx.select({ id: schema.locations.id, hours: schema.locations.hours, timezone: schema.locations.timezone }).from(schema.locations),
    cats: await listCategories(business.id, "service"),
  }));
  const location = opts.locationId ? locations.find((l) => l.id === opts.locationId) ?? null : null;
  const timeZone = tzFor(business, location);

  // Which services are in scope: one, a category (and its children), or everything.
  let scoped = services;
  let label = "All services";
  if (opts.serviceId) {
    scoped = services.filter((s) => s.id === opts.serviceId);
    label = scoped[0]?.name ?? "Service";
  } else if (opts.categoryId) {
    scoped = services.filter((s) => s.categoryId && pathTo(cats, s.categoryId).some((c) => c.id === opts.categoryId));
    label = cats.find((c) => c.id === opts.categoryId)?.name ?? "Category";
  }
  // A service nobody is mapped to can be done by anyone (mirrors staffForService).
  const mappedStaff = new Map<string, Set<string>>();
  for (const r of staffServices) mappedStaff.set(r.serviceId, (mappedStaff.get(r.serviceId) ?? new Set()).add(r.staffId));
  const performs = (staffId: string, serviceId: string) => { const m = mappedStaff.get(serviceId); return !m || m.size === 0 || m.has(staffId); };
  const topCategory = (categoryId: string | null) => (categoryId ? pathTo(cats, categoryId)[0]?.name : null) ?? "Other";
  const totals = new Map<string, number>();
  for (const svc of scoped) totals.set(topCategory(svc.categoryId), (totals.get(topCategory(svc.categoryId)) ?? 0) + 1);
  const groupNames = (list: { categoryId: string | null }[]) => {
    const counts = new Map<string, number>();
    for (const svc of list) counts.set(topCategory(svc.categoryId), (counts.get(topCategory(svc.categoryId)) ?? 0) + 1);
    return [...counts.entries()].sort((x, y) => y[1] - x[1]).map(([name, n]) => { const t = totals.get(name) ?? n; return n === t ? (t === 1 ? name : `all ${t} ${name}`) : `${n} of ${t} ${name}`; });
  };

  // Opening hours: the location's, or across every location when looking at all of them.
  const openFor = (weekday: number): CoverageBlock | null => {
    const pool = location ? [location] : locations;
    let open: CoverageBlock | null = null;
    for (const l of pool) {
      const h = (l.hours as WeeklyHours | null)?.[String(weekday)];
      if (!h) continue;
      const b = { start: toMin(h.open), end: toMin(h.close) };
      open = open ? { start: Math.min(open.start, b.start), end: Math.max(open.end, b.end) } : b;
    }
    return open;
  };

  const blocks = await workingBlocksFor({ businessId: business.id, timeZone: business.timezone, staffIds: staff.map((s) => s.id), dates, locationId: opts.locationId });
  const days: CoverageDay[] = dates.map((date) => {
    const weekday = weekdayOf(date);
    const open = openFor(weekday);
    const lanes: CoverageLane[] = [];
    for (const s of staff) {
      const mine = (blocks.get(`${s.id}:${date}`) ?? []).map((b) => {
        const start = toMin(instantToLocalTime(b.start, timeZone));
        const endLocal = instantToLocalTime(b.end, timeZone);
        // A block ending at midnight reads back as 00:00 of the next day.
        const end = endLocal === "00:00" ? 24 * 60 : toMin(endLocal);
        return { start, end: Math.max(end, start) };
      }).filter((b) => b.end > b.start);
      if (mine.length) lanes.push({ staffId: s.id, name: s.name, color: s.color, blocks: mine });
    }
    // Coverage strip: per slot inside opening hours, which scoped services someone on duty can do.
    const strip: CoverageStrip[] = [];
    const uncovered: CoverageBlock[] = [];
    if (open && scoped.length) {
      let cur: CoverageStrip | null = null;
      for (let t = open.start; t < open.end; t += SLOT) {
        const slotEnd = Math.min(t + SLOT, open.end);
        const onDuty = lanes.filter((l) => l.blocks.some((b) => b.start < slotEnd && b.end > t)).map((l) => l.staffId);
        const missing = scoped.filter((svc) => !onDuty.some((id) => performs(id, svc.id)));
        const state: StripState = onDuty.length === 0 ? "none" : missing.length === 0 ? "full" : "partial";
        const names = missing.map((m) => m.name);
        if (cur && cur.state === state && cur.missing.join("|") === names.join("|")) cur.end = slotEnd;
        else { cur = { start: t, end: slotEnd, state, missing: names, missingCount: missing.length, missingGroups: groupNames(missing) }; strip.push(cur); }
      }
      for (const s of strip) if (s.state === "none") uncovered.push({ start: s.start, end: s.end });
    }
    return { date, weekday, open, lanes, strip, uncovered };
  });

  // Grid extent: opening hours and every block, on whole hours; 8–6 when there is nothing.
  let lo = Infinity, hi = -Infinity;
  for (const d of days) {
    if (d.open) { lo = Math.min(lo, d.open.start); hi = Math.max(hi, d.open.end); }
    for (const l of d.lanes) for (const b of l.blocks) { lo = Math.min(lo, b.start); hi = Math.max(hi, b.end); }
  }
  if (!Number.isFinite(lo)) { lo = 8 * 60; hi = 18 * 60; }
  const startMin = Math.floor(lo / 60) * 60;
  const endMin = Math.min(24 * 60, Math.ceil(hi / 60) * 60);
  return { days, startMin, endMin, staff, scope: { label, serviceCount: scoped.length }, timeZone };
}
