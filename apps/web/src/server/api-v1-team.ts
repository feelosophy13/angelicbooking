import { NextResponse } from "next/server";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema, withTenant } from "@angelic/db";
import { ACTIONS, DEFAULT_ROLE_META, DEFAULT_ROLE_PERMISSIONS, PERMISSION_GROUPS, ROLES, instantToISODate, mondayOf } from "@angelic/core";
import { ApiErrors, apiAudit, firstForeign, list, pageParams, readBody, type ApiContext, probe } from "@/lib/api";
import { rateAsOf } from "@/lib/pay-rates";
import { shiftISODate } from "@/lib/utils";
import { listPayRates, recordPayChange } from "@/server/pay-rates";
import { applyStaffServices } from "@/server/stylist-pricing";
import { staffScheduleApi } from "@/server/api-v1-more";
import { finalizedPeriodOn, PayrollLockedError } from "./payroll-lock";

/**
 * The team area of the public API: staff profiles, hours, time off, services, pay, the time clock and roles. It mirrors the staff app's actions
 * (staff/actions.ts, time/actions.ts, settings/roles/actions.ts) and reuses the server functions they call where those are free of login state.
 *
 * What is never here: logins, members and invitations, who holds which role, clock PINs and their hashes, calendar-feed tokens, user ids.
 * Everything runs inside withTenant for the key's business and every id a request names is proven to belong to it first.
 */

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM");
/** A real calendar date: the regex alone would let 2026-02-31 reach Postgres and come back as a 500. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine((v) => { const t = Date.parse(v + "T00:00:00Z"); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v; }, "Not a real date");
const blankToNull = <T extends string>(v: T | null | undefined) => (v ? v : null);
const missing = (label: string): Miss => ({ miss: label });
type Miss = { miss: string };
const NOT_FOUND: Miss = { miss: "staff member" };
const isMiss = <T,>(x: T): x is Extract<T, Miss> => typeof x === "object" && x !== null && "miss" in x;

// ---------------------------------------------------------------------------
// Team members
// ---------------------------------------------------------------------------

type StaffRow = typeof schema.staff.$inferSelect;
/** Contact details included (staff:read), pay and secrets never. */
export const serializeTeamMember = (s: StaffRow) => ({
  id: s.id, display_name: s.displayName, full_name: s.fullName, email: s.email, phone: s.phone, position: s.position, bio: s.bio, photo_url: s.photoUrl, color: s.color,
  location_id: s.locationId, bookable_online: s.bookableOnline, takes_appointments: s.takesAppointments, active: s.active, sort_order: s.sortOrder,
  rotation_weeks: s.rotationWeeks, created_at: iso(s.createdAt),
});

// No `.default()` anywhere in a patch schema: `.partial()` would re-apply it and overwrite stored values. Create defaults live in the handler.
const email = z.union([z.literal(""), z.string().trim().toLowerCase().email().max(200)]).nullable().transform(blankToNull);
export const staffPatch = z.object({
  display_name: z.string().trim().min(1).max(80),
  full_name: z.string().trim().max(120).nullable().transform(blankToNull),
  email,
  phone: z.string().trim().max(30).nullable().transform(blankToNull),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #6366f1"),
  bio: z.string().trim().max(300).nullable().transform(blankToNull),
  position: z.string().trim().max(60).nullable().transform(blankToNull),
  location_id: z.string().max(100).nullable(),
  bookable_online: z.boolean(),
  takes_appointments: z.boolean(),
  active: z.boolean(),
  sort_order: z.number().int().min(0).max(100_000),
}).partial().strict();
export const staffCreate = staffPatch.required({ display_name: true });

export async function listTeam(ctx: ApiContext, req: Request) {
  const url = new URL(req.url);
  const p = pageParams(url);
  const take = probe(p);
  const activeParam = url.searchParams.get("active");
  const rows = await withTenant(ctx.business.id, (tx) =>
    tx.select().from(schema.staff)
      .where(and(eq(schema.staff.businessId, ctx.business.id), ...(activeParam === "true" ? [eq(schema.staff.active, true)] : activeParam === "false" ? [eq(schema.staff.active, false)] : [])))
      .orderBy(asc(schema.staff.sortOrder), asc(schema.staff.displayName), asc(schema.staff.id)).limit(take.limit).offset(take.offset),
  );
  return list(rows.map(serializeTeamMember), p);
}

export async function getTeamMember(ctx: ApiContext, id: string) {
  const s = await withTenant(ctx.business.id, (tx) => tx.query.staff.findFirst({ where: and(eq(schema.staff.id, id), eq(schema.staff.businessId, ctx.business.id)) }));
  return s ? NextResponse.json({ data: serializeTeamMember(s) }) : ApiErrors.notFound("staff member");
}

/** The columns a profile body sets (snake_case in, drizzle names out). Only what was sent. */
function staffColumns(d: z.infer<typeof staffPatch>) {
  const set: Partial<typeof schema.staff.$inferInsert> = {};
  if (d.display_name !== undefined) set.displayName = d.display_name;
  if (d.full_name !== undefined) set.fullName = d.full_name;
  if (d.email !== undefined) set.email = d.email;
  if (d.phone !== undefined) set.phone = d.phone;
  if (d.color !== undefined) set.color = d.color;
  if (d.bio !== undefined) set.bio = d.bio;
  if (d.position !== undefined) set.position = d.position;
  if (d.location_id !== undefined) set.locationId = d.location_id;
  if (d.active !== undefined) set.active = d.active;
  if (d.sort_order !== undefined) set.sortOrder = d.sort_order;
  return set;
}

export async function createStaffApi(ctx: ApiContext, req: Request) {
  const body = await readBody(req, staffCreate);
  if ("error" in body) return body.error;
  const d = body.data;
  const out = await withTenant(ctx.business.id, async (tx) => {
    const miss = await firstForeign(tx, ctx.business.id, [[schema.locations, d.location_id, "location"]]);
    if (miss) return missing(miss);
    const takes = d.takes_appointments ?? true;
    const [row] = await tx.insert(schema.staff).values({
      ...staffColumns(d), businessId: ctx.business.id, displayName: d.display_name, takesAppointments: takes, bookableOnline: (d.bookable_online ?? true) && takes,
    }).returning();
    // Default hours, as when the app adds someone: Tue-Sat 9 to 5, editable right away.
    await tx.insert(schema.staffSchedules).values([2, 3, 4, 5, 6].map((weekday) => ({ businessId: ctx.business.id, staffId: row!.id, weekday, startTime: "09:00", endTime: "17:00" })));
    return row!;
  });
  if (isMiss(out)) return ApiErrors.notFound(out.miss);
  await apiAudit(ctx, "api.staff.create", "staff", out.id, { display_name: out.displayName });
  return NextResponse.json({ data: serializeTeamMember(out) }, { status: 201 });
}

export async function patchStaffApi(ctx: ApiContext, req: Request, id: string) {
  const body = await readBody(req, staffPatch);
  if ("error" in body) return body.error;
  const d = body.data;
  const out = await withTenant(ctx.business.id, async (tx) => {
    const cur = await tx.query.staff.findFirst({ where: and(eq(schema.staff.id, id), eq(schema.staff.businessId, ctx.business.id)) });
    if (!cur) return NOT_FOUND;
    const miss = await firstForeign(tx, ctx.business.id, [[schema.locations, d.location_id, "location"]]);
    if (miss) return missing(miss);
    const set = staffColumns(d);
    // Someone who takes no appointments is never bookable online (the app's rule).
    if (d.takes_appointments !== undefined || d.bookable_online !== undefined) {
      const takes = d.takes_appointments ?? cur.takesAppointments;
      set.takesAppointments = takes;
      set.bookableOnline = (d.bookable_online ?? cur.bookableOnline) && takes;
    }
    if (!Object.keys(set).length) return cur;
    const [row] = await tx.update(schema.staff).set(set).where(and(eq(schema.staff.id, id), eq(schema.staff.businessId, ctx.business.id))).returning();
    return row!;
  });
  if (isMiss(out)) return ApiErrors.notFound(out.miss);
  await apiAudit(ctx, "api.staff.update", "staff", id, d);
  return NextResponse.json({ data: serializeTeamMember(out) });
}

// ---------------------------------------------------------------------------
// Weekly hours
// ---------------------------------------------------------------------------

const hoursBlock = z.object({
  weekday: z.number().int().min(0).max(6),
  week_index: z.number().int().min(0).max(3).optional(),
  start: hhmm,
  end: hhmm,
  location_id: z.string().max(100).nullable().optional(),
}).strict();
export const scheduleInput = z.object({
  rotation_weeks: z.number().int().min(1).max(4),
  this_week_is: z.number().int().min(0).max(3),
  weekly: z.array(hoursBlock).max(400),
}).partial().required({ weekly: true }).strict();

export async function putScheduleApi(ctx: ApiContext, req: Request, id: string) {
  const body = await readBody(req, scheduleInput);
  if ("error" in body) return body.error;
  const d = body.data;
  const result = await withTenant(ctx.business.id, async (tx) => {
    const cur = await tx.query.staff.findFirst({ where: and(eq(schema.staff.id, id), eq(schema.staff.businessId, ctx.business.id)), columns: { id: true, rotationWeeks: true, rotationAnchor: true } });
    if (!cur) return NOT_FOUND;
    const rotationWeeks = d.rotation_weeks ?? cur.rotationWeeks;
    const thisWeekIs = d.this_week_is ?? 0;
    if (thisWeekIs >= rotationWeeks) return { bad: { path: "this_week_is", message: "Must be less than rotation_weeks." } };
    // Same checks as the hours editor: per day, every block start < end, none overlapping, at most 12 blocks.
    const days = new Map<string, { start: string; end: string }[]>();
    for (const b of d.weekly) {
      const week = b.week_index ?? 0;
      if (week >= rotationWeeks) return { bad: { path: "weekly.week_index", message: "week_index must be less than rotation_weeks." } };
      if (b.start >= b.end) return { bad: { path: "weekly", message: `Start time must be before end time (weekday ${b.weekday}).` } };
      const k = `${week}:${b.weekday}`;
      days.set(k, [...(days.get(k) ?? []), { start: b.start, end: b.end }]);
    }
    for (const [k, blocks] of days) {
      if (blocks.length > 12) return { bad: { path: "weekly", message: `At most 12 blocks per day (week:weekday ${k}).` } };
      blocks.sort((a, b) => a.start.localeCompare(b.start));
      for (let i = 1; i < blocks.length; i++) if (blocks[i]!.start < blocks[i - 1]!.end) return { bad: { path: "weekly", message: `Blocks overlap (week:weekday ${k}).` } };
    }
    const miss = await firstForeign(tx, ctx.business.id, [...new Set(d.weekly.map((b) => b.location_id).filter((x): x is string => !!x))].map((l) => [schema.locations, l, "location"] as [typeof schema.locations, string, string]));
    if (miss) return missing(miss);
    // The anchor is the Monday of a "Week 1" week: this week's Monday, moved back by how many weeks into the cycle this week is.
    let rotationAnchor: string | null = null;
    if (rotationWeeks > 1) {
      const keep = d.rotation_weeks === undefined && d.this_week_is === undefined && cur.rotationAnchor;
      rotationAnchor = keep ? cur.rotationAnchor : shiftISODate(mondayOf(instantToISODate(new Date(), ctx.business.timezone)), -7 * thisWeekIs);
    }
    // A single-location business stores null (= the only one), like the app.
    const locs = await tx.select({ id: schema.locations.id }).from(schema.locations).where(eq(schema.locations.businessId, ctx.business.id));
    const locId = (l: string | null | undefined) => (locs.length > 1 && l ? l : null);
    await tx.delete(schema.staffSchedules).where(and(eq(schema.staffSchedules.staffId, id), eq(schema.staffSchedules.businessId, ctx.business.id)));
    if (d.weekly.length) {
      await tx.insert(schema.staffSchedules).values(d.weekly.map((b) => ({ businessId: ctx.business.id, staffId: id, weekIndex: b.week_index ?? 0, weekday: b.weekday, startTime: b.start, endTime: b.end, locationId: locId(b.location_id) })));
    }
    await tx.update(schema.staff).set({ rotationWeeks, rotationAnchor }).where(and(eq(schema.staff.id, id), eq(schema.staff.businessId, ctx.business.id)));
    return { ok: true } as const;
  });
  if (isMiss(result)) return ApiErrors.notFound(result.miss);
  if ("bad" in result) return ApiErrors.invalid(result.bad!.message, [result.bad]);
  await apiAudit(ctx, "api.staff.schedule.replace", "staff", id, { blocks: d.weekly.length, rotation_weeks: d.rotation_weeks ?? null });
  return NextResponse.json({ data: await staffScheduleApi(ctx.business.id, id) });
}

// ---------------------------------------------------------------------------
// Days off and custom hours
// ---------------------------------------------------------------------------

const serializeOverride = (o: typeof schema.staffScheduleOverrides.$inferSelect) => ({
  id: o.id, date: o.date, is_off: o.isOff, start: o.startTime ? String(o.startTime).slice(0, 5) : null, end: o.endTime ? String(o.endTime).slice(0, 5) : null, note: o.note,
});

export const overrideInput = z.object({
  date: isoDate,
  to: isoDate.optional(),
  kind: z.enum(["off", "hours"]),
  start: hhmm.optional(),
  end: hhmm.optional(),
  note: z.string().trim().max(200).nullable().optional(),
}).strict().superRefine((o, c) => {
  if (o.to && o.to < o.date) c.addIssue({ code: "custom", path: ["to"], message: "Must be on or after date." });
  if (o.to && o.to >= o.date && datesBetween(o.date, o.to).length > 366) c.addIssue({ code: "custom", path: ["to"], message: "At most a year at a time." });
  if (o.kind === "hours") {
    if (!o.start) c.addIssue({ code: "custom", path: ["start"], message: "start is required for kind hours." });
    if (!o.end) c.addIssue({ code: "custom", path: ["end"], message: "end is required for kind hours." });
    if (o.start && o.end && o.start >= o.end) c.addIssue({ code: "custom", path: ["end"], message: "end must be after start." });
  } else if (o.start || o.end) c.addIssue({ code: "custom", path: ["start"], message: "start and end are only for kind hours." });
});

/** Inclusive list of ISO dates from `from` to `to`; stops a little past a year so a bad range cannot run away. */
function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from + "T00:00:00Z");
  const last = new Date(to + "T00:00:00Z");
  for (let i = 0; d <= last && i < 400; i++, d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

export async function listOverridesApi(ctx: ApiContext, req: Request, id: string) {
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? instantToISODate(new Date(), ctx.business.timezone);
  const to = url.searchParams.get("to");
  if (!isoDate.safeParse(from).success || (to && !isoDate.safeParse(to).success)) return ApiErrors.invalid("from and to must be YYYY-MM-DD dates.");
  const rows = await withTenant(ctx.business.id, async (tx) => {
    const s = await tx.query.staff.findFirst({ where: and(eq(schema.staff.id, id), eq(schema.staff.businessId, ctx.business.id)), columns: { id: true } });
    if (!s) return null;
    return tx.select().from(schema.staffScheduleOverrides)
      .where(and(eq(schema.staffScheduleOverrides.staffId, id), eq(schema.staffScheduleOverrides.businessId, ctx.business.id), gte(schema.staffScheduleOverrides.date, from), ...(to ? [lte(schema.staffScheduleOverrides.date, to)] : [])))
      .orderBy(asc(schema.staffScheduleOverrides.date)).limit(400);
  });
  return rows ? NextResponse.json({ data: rows.map(serializeOverride) }) : ApiErrors.notFound("staff member");
}

export async function addOverrideApi(ctx: ApiContext, req: Request, id: string) {
  const body = await readBody(req, overrideInput);
  if ("error" in body) return body.error;
  const o = body.data;
  const dates = datesBetween(o.date, o.to ?? o.date);
  const fields = { isOff: o.kind === "off", startTime: o.kind === "hours" ? o.start! : null, endTime: o.kind === "hours" ? o.end! : null, note: blankToNull(o.note) };
  const rows = await withTenant(ctx.business.id, async (tx) => {
    const s = await tx.query.staff.findFirst({ where: and(eq(schema.staff.id, id), eq(schema.staff.businessId, ctx.business.id)), columns: { id: true } });
    if (!s) return null;
    // A date that already has an entry is replaced, as in the app.
    return tx.insert(schema.staffScheduleOverrides)
      .values(dates.map((date) => ({ businessId: ctx.business.id, staffId: id, date, ...fields })))
      .onConflictDoUpdate({ target: [schema.staffScheduleOverrides.businessId, schema.staffScheduleOverrides.staffId, schema.staffScheduleOverrides.date], set: fields })
      .returning();
  });
  if (!rows) return ApiErrors.notFound("staff member");
  await apiAudit(ctx, "api.staff.override.add", "staff", id, { kind: o.kind, from: o.date, to: o.to ?? o.date, days: dates.length });
  return NextResponse.json({ data: rows.sort((a, b) => a.date.localeCompare(b.date)).map(serializeOverride) }, { status: 201 });
}

export async function deleteOverrideApi(ctx: ApiContext, id: string, overrideId: string) {
  const gone = await withTenant(ctx.business.id, (tx) =>
    tx.delete(schema.staffScheduleOverrides)
      .where(and(eq(schema.staffScheduleOverrides.id, overrideId), eq(schema.staffScheduleOverrides.staffId, id), eq(schema.staffScheduleOverrides.businessId, ctx.business.id)))
      .returning({ id: schema.staffScheduleOverrides.id }),
  );
  if (!gone.length) return ApiErrors.notFound("day off or custom hours entry");
  await apiAudit(ctx, "api.staff.override.delete", "staff", id, { override_id: overrideId });
  return NextResponse.json({ data: { id: overrideId, deleted: true } });
}

// ---------------------------------------------------------------------------
// Services a person performs
// ---------------------------------------------------------------------------

export const staffServicesInput = z.object({
  services: z.array(z.object({
    service_id: z.string().min(1).max(100),
    price_cents: z.number().int().min(0).max(10_000_000).nullable().optional(),
    duration_min: z.number().int().min(5).max(600).nullable().optional(),
  }).strict()).max(500),
}).strict();

async function staffServicesRows(businessId: string, staffId: string) {
  return withTenant(businessId, async (tx) => {
    const s = await tx.query.staff.findFirst({ where: and(eq(schema.staff.id, staffId), eq(schema.staff.businessId, businessId)), columns: { id: true } });
    if (!s) return null;
    const rows = await tx.select().from(schema.staffServices).where(and(eq(schema.staffServices.staffId, staffId), eq(schema.staffServices.businessId, businessId)));
    return rows.map((x) => ({ service_id: x.serviceId, price_cents: x.priceCentsOverride, duration_min: x.durationMinOverride }));
  });
}

export async function getStaffServicesApi(ctx: ApiContext, id: string) {
  const rows = await staffServicesRows(ctx.business.id, id);
  return rows ? NextResponse.json({ data: rows }) : ApiErrors.notFound("staff member");
}

export async function putStaffServicesApi(ctx: ApiContext, req: Request, id: string) {
  const body = await readBody(req, staffServicesInput);
  if ("error" in body) return body.error;
  const picks = body.data.services;
  const serviceIds = picks.map((p) => p.service_id);
  if (new Set(serviceIds).size !== serviceIds.length) return ApiErrors.invalid("Each service may appear once.");
  const out = await withTenant(ctx.business.id, async (tx) => {
    const s = await tx.query.staff.findFirst({ where: and(eq(schema.staff.id, id), eq(schema.staff.businessId, ctx.business.id)), columns: { id: true } });
    if (!s) return NOT_FOUND;
    if (serviceIds.length) {
      const owned = await tx.select({ id: schema.services.id }).from(schema.services).where(and(eq(schema.services.businessId, ctx.business.id), inArray(schema.services.id, serviceIds)));
      if (owned.length !== serviceIds.length) return missing("service");
    }
    // A value left out keeps what is stored; null means "use the service's own price/length" (the app's rules, in applyStaffServices).
    await applyStaffServices(tx, ctx.business.id, id, picks.map((p) => ({ serviceId: p.service_id, price: p.price_cents, duration: p.duration_min })));
    return { ok: true } as const;
  });
  if (isMiss(out)) return ApiErrors.notFound(out.miss);
  await apiAudit(ctx, "api.staff.services.replace", "staff", id, { service_ids: serviceIds });
  return NextResponse.json({ data: await staffServicesRows(ctx.business.id, id) });
}

// ---------------------------------------------------------------------------
// Pay settings (pay:read / pay:write)
// ---------------------------------------------------------------------------

const bps = z.number().int().min(0).max(10_000);
const payMoney = z.number().int().min(0).max(1_000_000_000);
export const payInput = z.object({
  position: z.string().trim().max(60).nullable().transform(blankToNull),
  pay_type: z.enum(["commission", "hourly", "salary"]),
  main_commission_bps: bps,
  product_commission_bps: bps,
  cc_tip_fee_bps: bps,
  hourly_rate_cents: payMoney,
  salary_per_period_cents: payMoney,
  overtime_override: z.boolean().nullable(),
  tax_deduction_cents: payMoney.nullable(),
  tax_deduction_bps: z.number().int().min(0).max(9_999).nullable(),
  effective_from: isoDate.refine((v) => v >= "2000-01-01" && v <= "2100-01-01", "Pick a date between 2000 and 2100"),
  note: z.string().trim().max(200).nullable().transform(blankToNull),
}).partial().strict();

type PayShape = { payType: "commission" | "hourly" | "salary"; mainCommissionBps: number; productCommissionBps: number; ccTipFeeBps: number; hourlyRateCents: number; salaryPerPeriodCents: number; overtimeOverride: boolean | null; taxDeductionCents: number | null; taxDeductionBps: number | null };
const servePay = (r: PayShape) => ({
  pay_type: r.payType, main_commission_bps: r.mainCommissionBps, product_commission_bps: r.productCommissionBps, cc_tip_fee_bps: r.ccTipFeeBps, hourly_rate_cents: r.hourlyRateCents,
  salary_per_period_cents: r.salaryPerPeriodCents, overtime_override: r.overtimeOverride, tax_deduction_cents: r.taxDeductionCents, tax_deduction_bps: r.taxDeductionBps,
});

async function payOf(ctx: ApiContext, staffId: string) {
  const s = await withTenant(ctx.business.id, (tx) => tx.query.staff.findFirst({ where: and(eq(schema.staff.id, staffId), eq(schema.staff.businessId, ctx.business.id)) }));
  if (!s) return null;
  const rows = await listPayRates(ctx.business.id, staffId);
  const today = instantToISODate(new Date(), ctx.business.timezone);
  // The history row in force today; staff that predate the history keep their settings on the staff record.
  const now = rateAsOf(rows, today);
  return {
    staff_id: s.id,
    position: s.position,
    current: servePay(now ?? s),
    history: rows.map((r) => ({ effective_from: r.effectiveFrom, ...servePay(r), note: r.note, created_at: iso(r.createdAt) })),
  };
}

export async function getPayApi(ctx: ApiContext, id: string) {
  const out = await payOf(ctx, id);
  return out ? NextResponse.json({ data: out }) : ApiErrors.notFound("staff member");
}

export async function putPayApi(ctx: ApiContext, req: Request, id: string) {
  const body = await readBody(req, payInput);
  if ("error" in body) return body.error;
  const d = body.data;
  const s = await withTenant(ctx.business.id, (tx) => tx.query.staff.findFirst({ where: and(eq(schema.staff.id, id), eq(schema.staff.businessId, ctx.business.id)) }));
  if (!s) return ApiErrors.notFound("staff member");
  const today = instantToISODate(new Date(), ctx.business.timezone);
  const effectiveFrom = d.effective_from ?? today;
  // A field left out keeps the value in force on that date, so a partial body never zeroes someone's pay.
  const base: PayShape = rateAsOf(await listPayRates(ctx.business.id, id), effectiveFrom) ?? s;
  const rates = {
    payType: d.pay_type ?? base.payType,
    mainCommissionBps: d.main_commission_bps ?? base.mainCommissionBps,
    productCommissionBps: d.product_commission_bps ?? base.productCommissionBps,
    ccTipFeeBps: d.cc_tip_fee_bps ?? base.ccTipFeeBps,
    hourlyRateCents: d.hourly_rate_cents ?? base.hourlyRateCents,
    salaryPerPeriodCents: d.salary_per_period_cents ?? base.salaryPerPeriodCents,
    overtimeOverride: d.overtime_override !== undefined ? d.overtime_override : base.overtimeOverride,
    taxDeductionCents: d.tax_deduction_cents !== undefined ? d.tax_deduction_cents : base.taxDeductionCents,
    taxDeductionBps: d.tax_deduction_bps !== undefined ? d.tax_deduction_bps : base.taxDeductionBps,
  };
  if (rates.payType === "hourly" && !rates.hourlyRateCents) return ApiErrors.invalid("Enter an hourly rate.", [{ path: "hourly_rate_cents", message: "Enter an hourly rate." }]);
  if (rates.payType === "salary" && !rates.salaryPerPeriodCents) return ApiErrors.invalid("Enter the salary per period.", [{ path: "salary_per_period_cents", message: "Enter the salary per period." }]);
  // Position is descriptive, not pay: it changes on the record right away.
  if (d.position !== undefined) await withTenant(ctx.business.id, (tx) => tx.update(schema.staff).set({ position: d.position }).where(and(eq(schema.staff.id, id), eq(schema.staff.businessId, ctx.business.id))));
  try {
    await recordPayChange({ businessId: ctx.business.id, timezone: ctx.business.timezone, staffId: id, effectiveFrom, note: d.note ?? null, actorUserId: ctx.actor, rates });
  } catch (e) {
    if (e instanceof PayrollLockedError) return ApiErrors.conflict(e.message);
    throw e;
  }
  await apiAudit(ctx, "api.staff.pay.update", "staff", id, { effective_from: effectiveFrom, fields: Object.keys(d) });
  return NextResponse.json({ data: await payOf(ctx, id) });
}

// ---------------------------------------------------------------------------
// Time clock entries
// ---------------------------------------------------------------------------

const serializeEntry = (e: typeof schema.timeEntries.$inferSelect) => ({
  id: e.id, staff_id: e.staffId, date: e.date, minutes: e.minutes, hours: Math.round((e.minutes / 60) * 100) / 100, clock_in_at: iso(e.clockInAt), clock_out_at: iso(e.clockOutAt),
  location_id: e.locationId, note: e.note, created_at: iso(e.createdAt),
});

export const timeEntryInput = z.object({
  staff_id: z.string().min(1).max(100),
  date: isoDate,
  hours: z.number().min(0.25).max(24),
  note: z.string().trim().max(120).nullable().optional(),
}).strict();

export async function listTimeEntriesApi(ctx: ApiContext, req: Request) {
  const url = new URL(req.url);
  const p = pageParams(url);
  const staffId = url.searchParams.get("staff_id");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if ((from && !isoDate.safeParse(from).success) || (to && !isoDate.safeParse(to).success)) return ApiErrors.invalid("from and to must be YYYY-MM-DD dates.");
  const t = schema.timeEntries;
  const out = await withTenant(ctx.business.id, async (tx) => {
    const miss = await firstForeign(tx, ctx.business.id, [[schema.staff, staffId, "staff member"]]);
    if (miss) return missing(miss);
    const where = and(eq(t.businessId, ctx.business.id), ...(staffId ? [eq(t.staffId, staffId)] : []), ...(from ? [gte(t.date, from)] : []), ...(to ? [lte(t.date, to)] : []));
    const [rows, [n]] = await Promise.all([
      tx.select().from(t).where(where).orderBy(desc(t.date), desc(t.createdAt), asc(t.id)).limit(p.limit).offset(p.offset),
      tx.select({ n: sql<number>`count(*)` }).from(t).where(where),
    ]);
    return { rows, total: Number(n?.n ?? 0) };
  });
  if (isMiss(out)) return ApiErrors.notFound(out.miss);
  return list(out.rows.map(serializeEntry), p, out.total);
}

export async function addTimeEntryApi(ctx: ApiContext, req: Request) {
  const body = await readBody(req, timeEntryInput);
  if ("error" in body) return body.error;
  const d = body.data;
  const out = await withTenant(ctx.business.id, async (tx) => {
    const miss = await firstForeign(tx, ctx.business.id, [[schema.staff, d.staff_id, "staff member"]]);
    if (miss) return missing(miss);
    const locked = await finalizedPeriodOn(tx, d.date);
    if (locked) return { locked };
    const [row] = await tx.insert(schema.timeEntries).values({ businessId: ctx.business.id, staffId: d.staff_id, date: d.date, minutes: Math.round(d.hours * 60), note: blankToNull(d.note), createdByUserId: ctx.actor }).returning();
    return row!;
  });
  if (isMiss(out)) return ApiErrors.notFound(out.miss);
  if ("locked" in out) return ApiErrors.conflict(`That date is in the pay period ${out.locked.periodStart} to ${out.locked.periodEnd}, which is finalized.`);
  await apiAudit(ctx, "api.time_entry.create", "time_entry", out.id, { staff_id: d.staff_id, date: d.date, minutes: out.minutes });
  return NextResponse.json({ data: serializeEntry(out) }, { status: 201 });
}

export async function deleteTimeEntryApi(ctx: ApiContext, id: string) {
  const gone = await withTenant(ctx.business.id, async (tx) => {
    const entry = await tx.query.timeEntries.findFirst({ where: and(eq(schema.timeEntries.id, id), eq(schema.timeEntries.businessId, ctx.business.id)), columns: { date: true } });
    if (entry && (await finalizedPeriodOn(tx, entry.date))) return "locked" as const;
    return tx.delete(schema.timeEntries).where(and(eq(schema.timeEntries.id, id), eq(schema.timeEntries.businessId, ctx.business.id))).returning({ id: schema.timeEntries.id });
  });
  if (gone === "locked") return ApiErrors.conflict("That entry is in a finalized pay period.");
  if (!gone.length) return ApiErrors.notFound("time entry");
  await apiAudit(ctx, "api.time_entry.delete", "time_entry", id);
  return NextResponse.json({ data: { id, deleted: true } });
}

// ---------------------------------------------------------------------------
// Roles (roles:read / roles:write)
// ---------------------------------------------------------------------------
// The login system keeps its own copy of each custom role (for invitations). A key cannot reach it: the calls that sync it need a signed-in person.
// So a role made or changed here lives in the roles table only, and is registered with the login system the next time someone saves it in the app.

type RoleRow = typeof schema.roles.$inferSelect;
const serializeRole = (r: RoleRow, members: number) => ({
  id: r.id, key: r.key, name: r.name, description: r.description, permissions: r.permissions, is_system: r.isSystem, is_locked: r.key === "owner", member_count: members, sort_order: r.sortOrder,
});

/** Make sure the business has the four built-in roles (idempotent), as the app does before listing roles. */
async function ensureDefaultRolesApi(businessId: string) {
  await withTenant(businessId, async (tx) => {
    const have = new Set((await tx.select({ key: schema.roles.key }).from(schema.roles).where(eq(schema.roles.businessId, businessId))).map((r) => r.key));
    const missingKeys = ROLES.filter((k) => !have.has(k));
    if (!missingKeys.length) return;
    await tx.insert(schema.roles).values(missingKeys.map((key) => ({
      businessId, key, name: DEFAULT_ROLE_META[key].name, description: DEFAULT_ROLE_META[key].description, permissions: [...DEFAULT_ROLE_PERMISSIONS[key]], isSystem: true, sortOrder: ROLES.indexOf(key),
    })));
  });
}

/** How many logins hold each role key (a count only; nobody's identity is read). */
async function memberCounts(businessId: string) {
  const rows = await db.select({ role: schema.member.role, n: sql<number>`count(*)` }).from(schema.member).where(eq(schema.member.organizationId, businessId)).groupBy(schema.member.role);
  return new Map(rows.map((r) => [r.role, Number(r.n)]));
}

export async function listRolesApi(ctx: ApiContext) {
  await ensureDefaultRolesApi(ctx.business.id);
  const [roles, counts] = await Promise.all([
    withTenant(ctx.business.id, (tx) => tx.select().from(schema.roles).where(eq(schema.roles.businessId, ctx.business.id)).orderBy(asc(schema.roles.sortOrder), asc(schema.roles.name))),
    memberCounts(ctx.business.id),
  ]);
  return NextResponse.json({ data: roles.map((r) => serializeRole(r, counts.get(r.key) ?? 0)) });
}

async function findRole(businessId: string, id: string) {
  await ensureDefaultRolesApi(businessId);
  return withTenant(businessId, (tx) => tx.query.roles.findFirst({ where: and(eq(schema.roles.id, id), eq(schema.roles.businessId, businessId)) }));
}

export async function getRoleApi(ctx: ApiContext, id: string) {
  const r = await findRole(ctx.business.id, id);
  return r ? NextResponse.json({ data: serializeRole(r, (await memberCounts(ctx.business.id)).get(r.key) ?? 0) }) : ApiErrors.notFound("role");
}

export function permissionCatalogue() {
  return NextResponse.json({ data: { groups: PERMISSION_GROUPS.map((g) => ({ title: g.title, permissions: g.items.map((i) => ({ action: i.action, label: i.label, description: i.description })) })), actions: [...ACTIONS] } });
}

const permissionList = z.array(z.enum(ACTIONS)).min(1, "Pick at least one permission.").max(ACTIONS.length).refine((a) => new Set(a).size === a.length, "Each permission may appear once.");
export const rolePatch = z.object({
  name: z.string().trim().min(2).max(40),
  description: z.string().trim().max(160).nullable().transform(blankToNull),
  permissions: permissionList,
}).partial().strict();
export const roleCreate = rolePatch.required({ name: true, permissions: true });

/** Same key rule as the app: a slug of the name, made unique with _2, _3 ... */
function slugifyKey(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

export async function createRoleApi(ctx: ApiContext, req: Request) {
  const body = await readBody(req, roleCreate);
  if ("error" in body) return body.error;
  const d = body.data;
  await ensureDefaultRolesApi(ctx.business.id);
  const row = await withTenant(ctx.business.id, async (tx) => {
    const keys = new Set((await tx.select({ key: schema.roles.key }).from(schema.roles).where(eq(schema.roles.businessId, ctx.business.id))).map((r) => r.key));
    let key = slugifyKey(d.name) || "role";
    if (keys.has(key) || (ROLES as readonly string[]).includes(key)) {
      let i = 2;
      while (keys.has(`${key}_${i}`)) i++;
      key = `${key}_${i}`;
    }
    const [r] = await tx.insert(schema.roles).values({ businessId: ctx.business.id, key, name: d.name, description: d.description ?? null, permissions: d.permissions, isSystem: false, sortOrder: 100 }).returning();
    return r!;
  });
  await apiAudit(ctx, "api.role.create", "role", row.id, { name: row.name, permissions: row.permissions });
  return NextResponse.json({ data: serializeRole(row, 0) }, { status: 201 });
}

export async function patchRoleApi(ctx: ApiContext, req: Request, id: string) {
  const body = await readBody(req, rolePatch);
  if ("error" in body) return body.error;
  const d = body.data;
  const cur = await findRole(ctx.business.id, id);
  if (!cur) return ApiErrors.notFound("role");
  if (cur.key === "owner") return ApiErrors.conflict("The Owner role can't be changed.");
  const set: Partial<typeof schema.roles.$inferInsert> = {};
  if (d.name !== undefined) set.name = d.name;
  if (d.description !== undefined) set.description = d.description;
  if (d.permissions !== undefined) set.permissions = d.permissions;
  const row = Object.keys(set).length
    ? (await withTenant(ctx.business.id, (tx) => tx.update(schema.roles).set(set).where(and(eq(schema.roles.id, id), eq(schema.roles.businessId, ctx.business.id))).returning()))[0]!
    : cur;
  await apiAudit(ctx, "api.role.update", "role", id, d);
  return NextResponse.json({ data: serializeRole(row, (await memberCounts(ctx.business.id)).get(row.key) ?? 0) });
}

export async function deleteRoleApi(ctx: ApiContext, id: string) {
  const role = await findRole(ctx.business.id, id);
  if (!role) return ApiErrors.notFound("role");
  if (role.isSystem) return ApiErrors.conflict("Built-in roles can't be deleted. You can edit their permissions instead.");
  const n = (await memberCounts(ctx.business.id)).get(role.key) ?? 0;
  if (n > 0) return ApiErrors.conflict(`${n} member(s) still have this role. Move them to another role first.`);
  await withTenant(ctx.business.id, (tx) => tx.delete(schema.roles).where(and(eq(schema.roles.id, id), eq(schema.roles.businessId, ctx.business.id))));
  await apiAudit(ctx, "api.role.delete", "role", id, { key: role.key });
  return NextResponse.json({ data: { id, deleted: true } });
}
