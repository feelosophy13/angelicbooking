import { NextResponse } from "next/server";
import { and, asc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { cadenceError } from "@angelic/core";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, firstForeign, type ApiContext } from "@/lib/api";
import { CategoryError, deleteCategory, ensureCategory, moveCategory, renameCategory, updateServiceCategory } from "./categories";
import { addOptions, convertToGroup, createGroup, GroupError, setGroupActive, updateGroup } from "./product-groups";
import { attachBarcode, codeTaken, InventoryError, removeExtraBarcode } from "./inventory";
import { productCreate, productPatch, PRODUCT_DEFAULTS } from "./api-v1-more";
import { serializeProduct } from "./api-v1";

/**
 * The catalog half of the admin-parity API: categories, service ordering and per-stylist terms, packages, membership plans, product groups
 * (products that come in options), extra barcodes. Same rules as the staff app's actions; this module is what they call. Every function takes the
 * business from the key (ctx.business.id), runs inside withTenant, and proves every id the request names belongs to that business first
 * (foreign keys bypass row-level security).
 */

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const ok = (data: unknown, status = 200) => NextResponse.json({ data }, { status });
const money = z.number().int().min(0).max(10_000_000);
const idStr = z.string().min(1).max(100);

/** Rule violations raised by the server modules are 409s carrying the app's own message. */
export function ruleError(e: unknown): NextResponse | null {
  if (e instanceof InventoryError || e instanceof GroupError || e instanceof CategoryError) return ApiErrors.conflict(e.message);
  return null;
}
export async function guarded(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    const r = ruleError(e);
    if (r) return r;
    throw e;
  }
}
/** Ids of this business named by a request: the label of the first that is not, else null. */
export const owned = (b: string, checks: Parameters<typeof firstForeign>[2]) => withTenant(b, (tx) => firstForeign(tx, b, checks));

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
export type CategoryKind = "service" | "product";
export const kindOf = (url: URL): CategoryKind | null => {
  const k = url.searchParams.get("kind") ?? "service";
  return k === "service" || k === "product" ? k : null;
};

type SvcCat = typeof schema.serviceCategories.$inferSelect;
type ProdCat = typeof schema.productCategories.$inferSelect;
export const serializeServiceCategory = (c: SvcCat) => ({ id: c.id, name: c.name, parent_id: c.parentId, description: c.description, prep_notes: c.prepNotes, sort_order: c.sortOrder });
export const serializeProductCategory = (c: ProdCat) => ({ id: c.id, name: c.name, parent_id: null, description: null, prep_notes: null, sort_order: c.sortOrder });

export async function listCategoriesFull(b: string, kind: CategoryKind) {
  return withTenant(b, async (tx) =>
    kind === "service"
      ? (await tx.select().from(schema.serviceCategories).where(eq(schema.serviceCategories.businessId, b)).orderBy(asc(schema.serviceCategories.sortOrder), asc(schema.serviceCategories.name))).map(serializeServiceCategory)
      : (await tx.select().from(schema.productCategories).where(eq(schema.productCategories.businessId, b)).orderBy(asc(schema.productCategories.sortOrder), asc(schema.productCategories.name))).map(serializeProductCategory),
  );
}

async function categoryRow(b: string, kind: CategoryKind, id: string) {
  return withTenant(b, async (tx) =>
    kind === "service"
      ? ((await tx.query.serviceCategories.findFirst({ where: and(eq(schema.serviceCategories.id, id), eq(schema.serviceCategories.businessId, b)) })) ?? null)
      : ((await tx.query.productCategories.findFirst({ where: and(eq(schema.productCategories.id, id), eq(schema.productCategories.businessId, b)) })) ?? null),
  );
}
const serializeCategory = (kind: CategoryKind, row: SvcCat | ProdCat) => (kind === "service" ? serializeServiceCategory(row as SvcCat) : serializeProductCategory(row as ProdCat));

export async function getCategoryApi(b: string, kind: CategoryKind, id: string) {
  const row = await categoryRow(b, kind, id);
  return row ? ok(serializeCategory(kind, row)) : ApiErrors.notFound("category");
}

// No `.default()` anywhere in a patch schema (see CLIENT_DEFAULTS): defaults are applied by the handler.
export const categoryCreate = z.object({
  kind: z.enum(["service", "product"]),
  name: z.string().trim().min(1).max(60),
  parent_id: idStr.nullable().optional(),
  description: z.string().trim().max(300).nullable().optional(),
  prep_notes: z.string().trim().max(400).nullable().optional(),
}).strict();
export const serviceCategoryPatch = z.object({
  name: z.string().trim().min(1).max(60),
  parent_id: idStr.nullable(),
  description: z.string().trim().max(300).nullable(),
  prep_notes: z.string().trim().max(400).nullable(),
}).partial().strict();
export const productCategoryPatch = z.object({ name: z.string().trim().min(1).max(60) }).partial().strict();

export async function createCategoryApi(ctx: ApiContext, d: z.infer<typeof categoryCreate>) {
  const b = ctx.business.id;
  if (d.kind === "product" && (d.parent_id || d.description || d.prep_notes)) return ApiErrors.invalid("Product categories are flat and only have a name.");
  const parentId = d.kind === "service" ? (d.parent_id ?? null) : null;
  const problem = await withTenant(b, async (tx) => {
    const miss = await firstForeign(tx, b, [[schema.serviceCategories, parentId, "parent category"]]);
    if (miss) return miss;
    const same = sql`lower(name) = ${d.name.toLowerCase()}`;
    const dup = d.kind === "service"
      ? await tx.select({ id: schema.serviceCategories.id }).from(schema.serviceCategories).where(and(eq(schema.serviceCategories.businessId, b), same, parentId ? eq(schema.serviceCategories.parentId, parentId) : isNull(schema.serviceCategories.parentId))).limit(1)
      : await tx.select({ id: schema.productCategories.id }).from(schema.productCategories).where(and(eq(schema.productCategories.businessId, b), same)).limit(1);
    return dup.length ? "dup" : null;
  });
  if (problem === "dup") return ApiErrors.conflict("A category with that name already exists here.");
  if (problem) return ApiErrors.notFound(problem);
  const id = await ensureCategory(b, d.kind, d.name, parentId);
  if (!id) return ApiErrors.invalid("Enter a name.");
  if (d.kind === "service") await updateServiceCategory(b, id, { name: d.name, description: d.description ?? null, prepNotes: d.prep_notes ?? null, parentId });
  const row = (await categoryRow(b, d.kind, id))!;
  await apiAudit(ctx, "api.category.create", `${d.kind}_category`, id, { name: d.name });
  return ok(serializeCategory(d.kind, row), 201);
}

export async function updateCategoryApi(ctx: ApiContext, kind: CategoryKind, id: string, d: { name?: string; parent_id?: string | null; description?: string | null; prep_notes?: string | null }) {
  const b = ctx.business.id;
  const cur = await categoryRow(b, kind, id);
  if (!cur) return ApiErrors.notFound("category");
  if (kind === "product") {
    if (d.name !== undefined) await renameCategory(b, "product", id, d.name);
  } else {
    const c = cur as SvcCat;
    if (d.parent_id && (await owned(b, [[schema.serviceCategories, d.parent_id, "parent category"]]))) return ApiErrors.notFound("parent category");
    await updateServiceCategory(b, id, {
      name: d.name ?? c.name,
      description: d.description !== undefined ? d.description : c.description,
      prepNotes: d.prep_notes !== undefined ? d.prep_notes : c.prepNotes,
      parentId: d.parent_id !== undefined ? d.parent_id : c.parentId,
    });
  }
  await apiAudit(ctx, "api.category.update", `${kind}_category`, id, { fields: Object.keys(d) });
  return ok(serializeCategory(kind, (await categoryRow(b, kind, id))!));
}

/** The category goes; its items become uncategorised and sub-categories move up a level (the app's rule). */
export async function deleteCategoryApi(ctx: ApiContext, kind: CategoryKind, id: string) {
  const b = ctx.business.id;
  if (!(await categoryRow(b, kind, id))) return ApiErrors.notFound("category");
  await deleteCategory(b, kind, id);
  await apiAudit(ctx, "api.category.delete", `${kind}_category`, id);
  return ok({ id, deleted: true });
}

export const moveBody = z.object({ direction: z.enum(["up", "down"]) }).strict();
export async function moveCategoryApi(ctx: ApiContext, kind: CategoryKind, id: string, direction: "up" | "down") {
  const b = ctx.business.id;
  if (!(await categoryRow(b, kind, id))) return ApiErrors.notFound("category");
  await moveCategory(b, kind, id, direction);
  await apiAudit(ctx, "api.category.move", `${kind}_category`, id, { direction });
  return ok(await listCategoriesFull(b, kind));
}

// ---------------------------------------------------------------------------
// Services: order within a category, and who performs a service at what price
// ---------------------------------------------------------------------------
/** Move a service up or down within its category and renumber its siblings (as the app does, so legacy zeros become a real order). */
export async function moveServiceApi(ctx: ApiContext, id: string, direction: "up" | "down") {
  const b = ctx.business.id;
  const found = await withTenant(b, async (tx) => {
    const me = await tx.query.services.findFirst({ where: and(eq(schema.services.id, id), eq(schema.services.businessId, b)) });
    if (!me) return false;
    const siblings = await tx.select({ id: schema.services.id }).from(schema.services)
      .where(and(eq(schema.services.businessId, b), me.categoryId ? eq(schema.services.categoryId, me.categoryId) : isNull(schema.services.categoryId)))
      .orderBy(asc(schema.services.sortOrder), asc(schema.services.name));
    const ids = siblings.map((s) => s.id);
    const i = ids.indexOf(me.id);
    const j = direction === "up" ? i - 1 : i + 1;
    if (i >= 0 && j >= 0 && j < ids.length) {
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
      for (let k = 0; k < ids.length; k++) await tx.update(schema.services).set({ sortOrder: k }).where(and(eq(schema.services.id, ids[k]!), eq(schema.services.businessId, b)));
    }
    return true;
  });
  if (!found) return ApiErrors.notFound("service");
  await apiAudit(ctx, "api.service.move", "service", id, { direction });
  return ok({ id, moved: direction });
}

async function serviceStaffRows(b: string, serviceId: string) {
  return withTenant(b, async (tx) => {
    const svc = await tx.query.services.findFirst({ where: and(eq(schema.services.id, serviceId), eq(schema.services.businessId, b)) });
    if (!svc) return null;
    const rows = await tx
      .select({ staffId: schema.staffServices.staffId, name: schema.staff.displayName, active: schema.staff.active, price: schema.staffServices.priceCentsOverride, duration: schema.staffServices.durationMinOverride })
      .from(schema.staffServices)
      .innerJoin(schema.staff, eq(schema.staff.id, schema.staffServices.staffId))
      .where(and(eq(schema.staffServices.serviceId, serviceId), eq(schema.staffServices.businessId, b)))
      .orderBy(asc(schema.staff.sortOrder), asc(schema.staff.displayName));
    return rows.map((r) => ({
      staff_id: r.staffId, display_name: r.name, active: r.active,
      price_cents: r.price ?? svc.priceCents, duration_min: r.duration ?? svc.durationMin,
      price_override_cents: r.price, duration_override_min: r.duration,
    }));
  });
}
export async function getServiceStaffApi(b: string, serviceId: string) {
  const rows = await serviceStaffRows(b, serviceId);
  return rows ? ok(rows) : ApiErrors.notFound("service");
}

// Per entry: omit a field to keep what is stored; null = use the service's own; a value equal to the service's is stored as "use the service's".
export const serviceStaffPut = z.object({
  staff: z.array(z.object({ staff_id: idStr, price_cents: money.nullable().optional(), duration_min: z.number().int().min(5).max(600).nullable().optional() }).strict()).max(200),
}).strict();

/** Replace the set of people who perform this service, with each one's own price and length (applyStaffServices' rules, from the service's side). */
export async function putServiceStaffApi(ctx: ApiContext, serviceId: string, d: z.infer<typeof serviceStaffPut>) {
  const b = ctx.business.id;
  const ids = d.staff.map((s) => s.staff_id);
  if (new Set(ids).size !== ids.length) return ApiErrors.invalid("A person can only be listed once.");
  const missing = await withTenant(b, async (tx) => {
    const svc = await tx.query.services.findFirst({ where: and(eq(schema.services.id, serviceId), eq(schema.services.businessId, b)) });
    if (!svc) return "service";
    const miss = await firstForeign(tx, b, d.staff.map((s) => [schema.staff, s.staff_id, "staff member"] as [typeof schema.staff, string, string]));
    if (miss) return miss;
    const existing = new Map((await tx.select().from(schema.staffServices).where(and(eq(schema.staffServices.serviceId, serviceId), eq(schema.staffServices.businessId, b)))).map((r) => [r.staffId, r]));
    await tx.delete(schema.staffServices).where(and(eq(schema.staffServices.serviceId, serviceId), eq(schema.staffServices.businessId, b), ids.length ? notInArray(schema.staffServices.staffId, ids) : undefined));
    if (d.staff.length) {
      const values = d.staff.map((p) => {
        const price = p.price_cents === undefined ? (existing.get(p.staff_id)?.priceCentsOverride ?? null) : p.price_cents;
        const duration = p.duration_min === undefined ? (existing.get(p.staff_id)?.durationMinOverride ?? null) : p.duration_min;
        return { businessId: b, staffId: p.staff_id, serviceId, priceCentsOverride: price === svc.priceCents ? null : price, durationMinOverride: duration === svc.durationMin ? null : duration };
      });
      await tx.insert(schema.staffServices).values(values)
        .onConflictDoUpdate({ target: [schema.staffServices.staffId, schema.staffServices.serviceId], set: { priceCentsOverride: sql`excluded.price_cents_override`, durationMinOverride: sql`excluded.duration_min_override` } });
    }
    return null;
  });
  if (missing) return ApiErrors.notFound(missing);
  await apiAudit(ctx, "api.service.staff", "service", serviceId, { staff: ids });
  return ok(await serviceStaffRows(b, serviceId));
}

// ---------------------------------------------------------------------------
// Packages and membership plans
// ---------------------------------------------------------------------------
type PackageRow = typeof schema.packages.$inferSelect;
export const serializePackageFull = (p: PackageRow) => ({
  id: p.id, name: p.name, service_id: p.serviceId, sessions: p.sessions, price_cents: p.priceCents, valid_days: p.validDays, description: p.description,
  valid_location_ids: p.validLocationIds, active: p.active, created_at: iso(p.createdAt),
});
type PlanRow = typeof schema.membershipPlans.$inferSelect;
export const serializePlanFull = (p: PlanRow) => ({
  id: p.id, name: p.name, price_cents: p.priceCents, interval: p.interval, interval_count: p.intervalCount, included_service_id: p.includedServiceId,
  included_sessions: p.includedSessions, rollover_cap: p.rolloverCap, cycle_count: p.cycleCount, discount_bps: p.discountBps, description: p.description,
  valid_location_ids: p.validLocationIds, active: p.active, created_at: iso(p.createdAt),
});

/** Where a package or plan can be used: every id proven to be this business's; none or all of them means everywhere (the app's validAtFromForm). */
async function normalizeValidAt(tx: Parameters<Parameters<typeof withTenant>[1]>[0], b: string, ids: string[]): Promise<{ ids: string[] } | { missing: string }> {
  const miss = await firstForeign(tx, b, ids.map((id) => [schema.locations, id, "location"] as [typeof schema.locations, string, string]));
  if (miss) return { missing: miss };
  const all = await tx.select({ id: schema.locations.id }).from(schema.locations).where(eq(schema.locations.businessId, b));
  const picked = [...new Set(ids)];
  return { ids: picked.length === 0 || picked.length >= all.length ? [] : picked };
}

const validLocations = z.array(idStr).max(100);
export const packagePatch = z.object({
  name: z.string().trim().min(1).max(80),
  service_id: idStr.nullable(),
  sessions: z.number().int().min(1).max(100),
  price_cents: money,
  valid_days: z.number().int().min(1).max(36_500).nullable(),
  description: z.string().trim().max(300).nullable(),
  valid_location_ids: validLocations,
  active: z.boolean(),
}).partial().strict();
export const packageCreate = packagePatch.required({ name: true, sessions: true, price_cents: true });

export async function getPackageApi(b: string, id: string) {
  const row = await withTenant(b, (tx) => tx.query.packages.findFirst({ where: and(eq(schema.packages.id, id), eq(schema.packages.businessId, b)) }));
  return row ? ok(serializePackageFull(row)) : ApiErrors.notFound("package");
}

export async function createPackageApi(ctx: ApiContext, d: z.infer<typeof packageCreate>) {
  const b = ctx.business.id;
  const out = await withTenant(b, async (tx) => {
    const miss = await firstForeign(tx, b, [[schema.services, d.service_id, "service"]]);
    if (miss) return { missing: miss };
    const valid = await normalizeValidAt(tx, b, d.valid_location_ids ?? []);
    if ("missing" in valid) return valid;
    const [row] = await tx.insert(schema.packages).values({
      businessId: b, name: d.name, serviceId: d.service_id ?? null, sessions: d.sessions, priceCents: d.price_cents, validDays: d.valid_days ?? null,
      description: d.description ?? null, validLocationIds: valid.ids, active: d.active ?? true,
    }).returning();
    return { row: row! };
  });
  if ("missing" in out) return ApiErrors.notFound(out.missing!);
  await apiAudit(ctx, "api.package.create", "package", out.row!.id, { name: d.name });
  return ok(serializePackageFull(out.row!), 201);
}

export async function patchPackageApi(ctx: ApiContext, id: string, d: z.infer<typeof packagePatch>) {
  const b = ctx.business.id;
  const out = await withTenant(b, async (tx) => {
    const cur = await tx.query.packages.findFirst({ where: and(eq(schema.packages.id, id), eq(schema.packages.businessId, b)) });
    if (!cur) return { missing: "package" };
    const miss = await firstForeign(tx, b, [[schema.services, d.service_id, "service"]]);
    if (miss) return { missing: miss };
    let validIds: string[] | undefined;
    if (d.valid_location_ids !== undefined) {
      const valid = await normalizeValidAt(tx, b, d.valid_location_ids);
      if ("missing" in valid) return valid;
      validIds = valid.ids;
    }
    const set = {
      ...(d.name !== undefined ? { name: d.name } : {}), ...(d.service_id !== undefined ? { serviceId: d.service_id } : {}), ...(d.sessions !== undefined ? { sessions: d.sessions } : {}),
      ...(d.price_cents !== undefined ? { priceCents: d.price_cents } : {}), ...(d.valid_days !== undefined ? { validDays: d.valid_days } : {}), ...(d.description !== undefined ? { description: d.description } : {}),
      ...(validIds ? { validLocationIds: validIds } : {}), ...(d.active !== undefined ? { active: d.active } : {}),
    };
    if (!Object.keys(set).length) return { row: cur };
    const [row] = await tx.update(schema.packages).set(set).where(and(eq(schema.packages.id, id), eq(schema.packages.businessId, b))).returning();
    return { row: row! };
  });
  if ("missing" in out) return ApiErrors.notFound(out.missing!);
  await apiAudit(ctx, "api.package.update", "package", id, { fields: Object.keys(d) });
  return ok(serializePackageFull(out.row!));
}

export const planPatch = z.object({
  name: z.string().trim().min(1).max(80),
  price_cents: money,
  interval: z.enum(["week", "month", "year"]),
  interval_count: z.number().int().min(1).max(52),
  included_service_id: idStr.nullable(),
  included_sessions: z.number().int().min(0).max(31),
  rollover_cap: z.number().int().min(0).max(99),
  // A fixed-length plan ends after this many billed periods; 0 or null = ongoing until cancelled.
  cycle_count: z.number().int().min(0).max(120).nullable(),
  discount_bps: z.number().int().min(0).max(10_000),
  description: z.string().trim().max(300).nullable(),
  valid_location_ids: validLocations,
  active: z.boolean(),
}).partial().strict();
export const planCreate = planPatch.required({ name: true, price_cents: true });
export const PLAN_DEFAULTS = { interval: "month", interval_count: 1, included_sessions: 0, rollover_cap: 0, discount_bps: 0, active: true } as const;

export async function getPlanApi(b: string, id: string) {
  const row = await withTenant(b, (tx) => tx.query.membershipPlans.findFirst({ where: and(eq(schema.membershipPlans.id, id), eq(schema.membershipPlans.businessId, b)) }));
  return row ? ok(serializePlanFull(row)) : ApiErrors.notFound("membership plan");
}

/** The app's two plan rules: sessions need a service to be for, and the cadence has to be billable (cadenceError). */
function planRuleError(sessions: number, serviceId: string | null, interval: string, count: number) {
  if (sessions > 0 && !serviceId) return ApiErrors.invalid("Choose which service the sessions are for.", [{ path: "included_service_id", message: "Required when included_sessions is above 0" }]);
  const cadence = cadenceError(interval, count);
  if (cadence) return ApiErrors.invalid(cadence, [{ path: "interval_count", message: cadence }]);
  return null;
}

export async function createPlanApi(ctx: ApiContext, input: z.infer<typeof planCreate>) {
  const b = ctx.business.id;
  const d = { ...PLAN_DEFAULTS, ...input };
  const bad = planRuleError(d.included_sessions, d.included_service_id ?? null, d.interval, d.interval_count);
  if (bad) return bad;
  const out = await withTenant(b, async (tx) => {
    const miss = await firstForeign(tx, b, [[schema.services, d.included_service_id, "service"]]);
    if (miss) return { missing: miss };
    const valid = await normalizeValidAt(tx, b, d.valid_location_ids ?? []);
    if ("missing" in valid) return valid;
    const [row] = await tx.insert(schema.membershipPlans).values({
      businessId: b, name: d.name, priceCents: d.price_cents, interval: d.interval, intervalCount: d.interval_count, includedServiceId: d.included_service_id ?? null,
      includedSessions: d.included_sessions, rolloverCap: d.rollover_cap, cycleCount: d.cycle_count || null, discountBps: d.discount_bps, description: d.description ?? null,
      validLocationIds: valid.ids, active: d.active,
    }).returning();
    return { row: row! };
  });
  if ("missing" in out) return ApiErrors.notFound(out.missing!);
  await apiAudit(ctx, "api.membership_plan.create", "membership_plan", out.row!.id, { name: d.name });
  return ok(serializePlanFull(out.row!), 201);
}

export async function patchPlanApi(ctx: ApiContext, id: string, d: z.infer<typeof planPatch>) {
  const b = ctx.business.id;
  const out = await withTenant(b, async (tx) => {
    const cur = await tx.query.membershipPlans.findFirst({ where: and(eq(schema.membershipPlans.id, id), eq(schema.membershipPlans.businessId, b)) });
    if (!cur) return { missing: "membership plan" };
    const serviceId = d.included_service_id !== undefined ? d.included_service_id : cur.includedServiceId;
    const bad = planRuleError(d.included_sessions ?? cur.includedSessions, serviceId, d.interval ?? cur.interval, d.interval_count ?? cur.intervalCount);
    if (bad) return { bad };
    const miss = await firstForeign(tx, b, [[schema.services, d.included_service_id, "service"]]);
    if (miss) return { missing: miss };
    let validIds: string[] | undefined;
    if (d.valid_location_ids !== undefined) {
      const valid = await normalizeValidAt(tx, b, d.valid_location_ids);
      if ("missing" in valid) return valid;
      validIds = valid.ids;
    }
    // A new price or cadence needs a new Stripe price; subscriptions already running keep the old one until set up again.
    const repriced = (d.price_cents !== undefined && d.price_cents !== cur.priceCents) || (d.interval !== undefined && d.interval !== cur.interval) || (d.interval_count !== undefined && d.interval_count !== cur.intervalCount);
    const set = {
      ...(d.name !== undefined ? { name: d.name } : {}), ...(d.price_cents !== undefined ? { priceCents: d.price_cents } : {}), ...(d.interval !== undefined ? { interval: d.interval } : {}),
      ...(d.interval_count !== undefined ? { intervalCount: d.interval_count } : {}), ...(d.included_service_id !== undefined ? { includedServiceId: d.included_service_id } : {}),
      ...(d.included_sessions !== undefined ? { includedSessions: d.included_sessions } : {}), ...(d.rollover_cap !== undefined ? { rolloverCap: d.rollover_cap } : {}),
      ...(d.cycle_count !== undefined ? { cycleCount: d.cycle_count || null } : {}), ...(d.discount_bps !== undefined ? { discountBps: d.discount_bps } : {}),
      ...(d.description !== undefined ? { description: d.description } : {}), ...(validIds ? { validLocationIds: validIds } : {}), ...(d.active !== undefined ? { active: d.active } : {}),
      ...(repriced ? { stripePriceId: null } : {}),
    };
    if (!Object.keys(set).length) return { row: cur };
    const [row] = await tx.update(schema.membershipPlans).set(set).where(and(eq(schema.membershipPlans.id, id), eq(schema.membershipPlans.businessId, b))).returning();
    return { row: row! };
  });
  if ("bad" in out) return out.bad!;
  if ("missing" in out) return ApiErrors.notFound(out.missing!);
  await apiAudit(ctx, "api.membership_plan.update", "membership_plan", id, { fields: Object.keys(d) });
  return ok(serializePlanFull(out.row!));
}

// ---------------------------------------------------------------------------
// Products: the create/update the staff app does, including supplier, reorder level and options
// ---------------------------------------------------------------------------
// supplier_id and reorder_up_to are inventory settings the earlier product schemas did not carry; variant_label names an option of a group.
const productExtras = {
  supplier_id: idStr.nullable(),
  reorder_up_to: z.number().int().min(0).max(100_000).nullable(),
};
export const productPatchX = productPatch.extend({ ...productExtras, variant_label: z.string().trim().min(1).max(40) }).partial().strict();
export const productCreateX = productCreate.extend({ supplier_id: productExtras.supplier_id.optional(), reorder_up_to: productExtras.reorder_up_to.optional() }).strict();

const REORDER_MSG = "Order up to must be at least the low-stock level.";

export async function createProductApi(ctx: ApiContext, input: z.infer<typeof productCreateX>) {
  const b = ctx.business.id;
  const d = { ...PRODUCT_DEFAULTS, ...input };
  for (const [field, code] of [["barcode", d.barcode], ["sku", d.sku]] as const) {
    if (!code) continue;
    const owner = await codeTaken(b, code);
    if (owner) return ApiErrors.conflict(`${owner} already uses this ${field}.`);
  }
  if (d.reorder_up_to != null && d.reorder_up_to < d.low_stock_threshold) return ApiErrors.invalid(REORDER_MSG, [{ path: "reorder_up_to", message: REORDER_MSG }]);
  const retail = d.kind === "retail";
  const out = await withTenant(b, async (tx) => {
    const miss = await firstForeign(tx, b, [[schema.productCategories, d.category_id, "category"], [schema.suppliers, d.supplier_id, "supplier"]]);
    if (miss) return { miss };
    const [row] = await tx.insert(schema.products).values({
      businessId: b, categoryId: d.category_id ?? null, name: d.name, description: d.description ?? null, kind: d.kind, sku: d.sku ?? null, barcode: d.barcode ?? null,
      priceCents: d.price_cents, costCents: d.cost_cents, taxable: d.taxable, sellOnline: retail ? d.sell_online : false, trackStock: retail ? d.track_stock : true,
      lowStockThreshold: d.low_stock_threshold, reorderUpTo: d.reorder_up_to ?? null, supplierId: d.supplier_id ?? null, active: d.active,
    }).returning();
    return { row: row! };
  });
  if ("miss" in out) return ApiErrors.notFound(out.miss!);
  await apiAudit(ctx, "api.product.create", "product", out.row!.id, { name: out.row!.name });
  return ok(serializeProduct(out.row!), 201);
}

const GROUP_OWNED = ["name", "description", "category_id", "kind", "taxable", "sell_online", "supplier_id"] as const;

export async function patchProductApi(ctx: ApiContext, id: string, d: z.infer<typeof productPatchX>) {
  const b = ctx.business.id;
  const find = () => withTenant(b, (tx) => tx.query.products.findFirst({ where: and(eq(schema.products.id, id), eq(schema.products.businessId, b)) }));
  const cur = await find();
  if (!cur) return ApiErrors.notFound("product");
  // An option of a product keeps what the group shares equal to the group's: those are changed on the group, never on one option.
  if (cur.groupId) {
    const shared = GROUP_OWNED.find((f) => d[f] !== undefined);
    if (shared) return ApiErrors.conflict(`"${shared}" is shared by every option of this product. Change it with PATCH /product-groups/${cur.groupId}.`);
  } else if (d.variant_label !== undefined) {
    return ApiErrors.conflict("Only an option of a product has an option label. Use POST /products/{id}/convert-to-group first.");
  }
  for (const [field, code, was] of [["barcode", d.barcode, cur.barcode], ["sku", d.sku, cur.sku]] as const) {
    if (!code || code === was) continue;
    const owner = await codeTaken(b, code, id);
    if (owner) return ApiErrors.conflict(`${owner} already uses this ${field}.`);
  }
  const low = d.low_stock_threshold ?? cur.lowStockThreshold;
  const upTo = d.reorder_up_to !== undefined ? d.reorder_up_to : cur.reorderUpTo;
  if ((d.reorder_up_to !== undefined || d.low_stock_threshold !== undefined) && upTo != null && upTo < low) return ApiErrors.invalid(REORDER_MSG, [{ path: "reorder_up_to", message: REORDER_MSG }]);
  const label = d.variant_label?.replace(/\s+/g, " ").trim();
  const kind = d.kind ?? cur.kind;
  const out = await withTenant(b, async (tx) => {
    const miss = await firstForeign(tx, b, [[schema.productCategories, d.category_id, "category"], [schema.suppliers, d.supplier_id, "supplier"]]);
    if (miss) return { miss };
    if (label && cur.groupId) {
      const dup = await tx.select({ id: schema.products.id }).from(schema.products).where(and(eq(schema.products.businessId, b), eq(schema.products.groupId, cur.groupId), sql`${schema.products.id} <> ${id}`, sql`lower(${schema.products.variantLabel}) = ${label.toLowerCase()}`)).limit(1);
      if (dup.length) return { dup: true };
    }
    const set = {
      ...(d.name !== undefined ? { name: d.name } : {}), ...(d.description !== undefined ? { description: d.description } : {}), ...(d.kind !== undefined ? { kind: d.kind } : {}),
      ...(d.category_id !== undefined ? { categoryId: d.category_id } : {}), ...(d.sku !== undefined ? { sku: d.sku } : {}), ...(d.barcode !== undefined ? { barcode: d.barcode } : {}),
      ...(d.price_cents !== undefined ? { priceCents: d.price_cents } : {}), ...(d.cost_cents !== undefined ? { costCents: d.cost_cents } : {}), ...(d.taxable !== undefined ? { taxable: d.taxable } : {}),
      ...(d.sell_online !== undefined ? { sellOnline: d.sell_online } : {}), ...(d.track_stock !== undefined ? { trackStock: d.track_stock } : {}),
      ...(d.low_stock_threshold !== undefined ? { lowStockThreshold: d.low_stock_threshold } : {}), ...(d.reorder_up_to !== undefined ? { reorderUpTo: d.reorder_up_to } : {}),
      ...(d.supplier_id !== undefined ? { supplierId: d.supplier_id } : {}), ...(label ? { variantLabel: label } : {}), ...(d.active !== undefined ? { active: d.active } : {}),
      // A back-bar product is never sold and always counted (and an option of one has no price).
      ...(kind === "backbar" ? { sellOnline: false, trackStock: true, ...(cur.groupId ? { priceCents: 0 } : {}) } : {}),
    };
    if (!Object.keys(set).length) return { row: cur };
    const [row] = await tx.update(schema.products).set(set).where(and(eq(schema.products.id, id), eq(schema.products.businessId, b))).returning();
    return { row: row! };
  });
  if ("miss" in out) return ApiErrors.notFound(out.miss!);
  if ("dup" in out) return ApiErrors.conflict("This product already has an option with that name.");
  await apiAudit(ctx, "api.product.update", "product", id, { fields: Object.keys(d) });
  return ok(serializeProduct(out.row!));
}

// ---------------------------------------------------------------------------
// Product groups (products that come in options)
// ---------------------------------------------------------------------------
type GroupRow = typeof schema.productGroups.$inferSelect;
type ProductRow = typeof schema.products.$inferSelect;
// Cost and the usual supplier are deliberately absent: a catalog:read key (a website, say) never sees them. inventory:read endpoints do.
const serializeOption = (p: ProductRow) => ({
  id: p.id, variant_label: p.variantLabel, sku: p.sku, barcode: p.barcode, price_cents: p.priceCents, track_stock: p.trackStock, stock_qty: p.trackStock ? p.stockQty : null,
  low_stock_threshold: p.lowStockThreshold, reorder_up_to: p.reorderUpTo, active: p.active,
});
export const serializeGroup = (g: GroupRow, options?: ProductRow[]) => ({
  id: g.id, name: g.name, description: g.description, category_id: g.categoryId, kind: g.kind, taxable: g.taxable, sell_online: g.sellOnline, active: g.active,
  created_at: iso(g.createdAt), ...(options ? { options: options.map(serializeOption) } : {}),
});

const optionLabels = z.array(z.string().max(80)).min(1).max(100);
/** Same cleaning as the app's option list: spaces collapsed, 40 characters, no repeats ignoring case. */
export function cleanLabels(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const label = r.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.push(label);
  }
  return out;
}

export const groupCreate = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(400).nullable().optional(),
  category_id: idStr.nullable().optional(),
  kind: z.enum(["retail", "backbar"]).optional(),
  taxable: z.boolean().optional(),
  sell_online: z.boolean().optional(),
  supplier_id: idStr.nullable().optional(),
  options: optionLabels,
  // What each new option starts with (barcodes and SKUs belong to each option and are set on it afterwards).
  price_cents: money.optional(),
  cost_cents: money.optional(),
  low_stock_threshold: z.number().int().min(0).max(100_000).optional(),
  reorder_up_to: z.number().int().min(0).max(100_000).nullable().optional(),
  track_stock: z.boolean().optional(),
}).strict();
export const groupPatch = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(400).nullable(),
  category_id: idStr.nullable(),
  kind: z.enum(["retail", "backbar"]),
  taxable: z.boolean(),
  sell_online: z.boolean(),
  supplier_id: idStr.nullable(),
  active: z.boolean(),
}).partial().strict();
export const groupOptionsBody = z.object({ options: optionLabels, price_cents: money.optional(), cost_cents: money.optional() }).strict();
export const convertBody = z.object({ label: z.string().trim().min(1).max(40) }).strict();

async function groupWithOptions(b: string, id: string) {
  return withTenant(b, async (tx) => {
    const g = await tx.query.productGroups.findFirst({ where: and(eq(schema.productGroups.id, id), eq(schema.productGroups.businessId, b)) });
    if (!g) return null;
    const options = await tx.select().from(schema.products).where(and(eq(schema.products.groupId, id), eq(schema.products.businessId, b))).orderBy(asc(schema.products.variantLabel));
    return { g, options };
  });
}

export async function listGroupsApi(b: string, p: { limit: number; offset: number }, includeInactive: boolean) {
  return withTenant(b, async (tx) => {
    const groups = await tx.select().from(schema.productGroups).where(and(eq(schema.productGroups.businessId, b), includeInactive ? undefined : eq(schema.productGroups.active, true))).orderBy(asc(schema.productGroups.name)).limit(p.limit).offset(p.offset);
    const options = groups.length ? await tx.select().from(schema.products).where(and(eq(schema.products.businessId, b), inArray(schema.products.groupId, groups.map((g) => g.id)))).orderBy(asc(schema.products.variantLabel)) : [];
    return groups.map((g) => serializeGroup(g, options.filter((o) => o.groupId === g.id)));
  });
}

export async function getGroupApi(b: string, id: string) {
  const r = await groupWithOptions(b, id);
  return r ? ok(serializeGroup(r.g, r.options)) : ApiErrors.notFound("product group");
}

export async function createGroupApi(ctx: ApiContext, d: z.infer<typeof groupCreate>) {
  const b = ctx.business.id;
  const kind = d.kind ?? "retail";
  const labels = cleanLabels(d.options);
  if (!labels.length) return ApiErrors.invalid("Add at least one option.", [{ path: "options", message: "Add at least one option" }]);
  if (kind === "retail" && !(d.price_cents && d.price_cents > 0)) return ApiErrors.invalid("Enter a price.", [{ path: "price_cents", message: "Required (above 0) for a retail product" }]);
  const low = d.low_stock_threshold ?? 3;
  if (d.reorder_up_to != null && d.reorder_up_to < low) return ApiErrors.invalid(REORDER_MSG, [{ path: "reorder_up_to", message: REORDER_MSG }]);
  const miss = await owned(b, [[schema.productCategories, d.category_id, "category"], [schema.suppliers, d.supplier_id, "supplier"]]);
  if (miss) return ApiErrors.notFound(miss);
  const { group } = await createGroup({
    businessId: b,
    shared: { name: d.name, description: d.description ?? null, imageUrl: null, categoryId: d.category_id ?? null, kind, taxable: d.taxable ?? true, sellOnline: kind === "retail" ? (d.sell_online ?? false) : false, supplierId: d.supplier_id ?? null },
    labels,
    defaults: { priceCents: d.price_cents, costCents: d.cost_cents, lowStockThreshold: low, reorderUpTo: d.reorder_up_to ?? null, trackStock: d.track_stock ?? false },
  });
  await apiAudit(ctx, "api.product_group.create", "product_group", group.id, { name: d.name, options: labels.length });
  const after = (await groupWithOptions(b, group.id))!;
  return ok(serializeGroup(after.g, after.options), 201);
}

export async function patchGroupApi(ctx: ApiContext, id: string, d: z.infer<typeof groupPatch>) {
  const b = ctx.business.id;
  const cur = await groupWithOptions(b, id);
  if (!cur) return ApiErrors.notFound("product group");
  const miss = await owned(b, [[schema.productCategories, d.category_id, "category"], [schema.suppliers, d.supplier_id, "supplier"]]);
  if (miss) return ApiErrors.notFound(miss);
  const kind = d.kind ?? (cur.g.kind as "retail" | "backbar");
  const shared = {
    ...(d.name !== undefined ? { name: d.name } : {}), ...(d.description !== undefined ? { description: d.description } : {}), ...(d.category_id !== undefined ? { categoryId: d.category_id } : {}),
    ...(d.kind !== undefined ? { kind: d.kind } : {}), ...(d.taxable !== undefined ? { taxable: d.taxable } : {}), ...(d.supplier_id !== undefined ? { supplierId: d.supplier_id } : {}),
    // A back-bar product is never sold online.
    ...(d.sell_online !== undefined || d.kind !== undefined ? { sellOnline: kind === "retail" ? (d.sell_online ?? cur.g.sellOnline) : false } : {}),
  };
  if (Object.keys(shared).length) await updateGroup({ businessId: b, groupId: id, shared });
  if (d.active !== undefined) await setGroupActive({ businessId: b, groupId: id, active: d.active });
  await apiAudit(ctx, "api.product_group.update", "product_group", id, { fields: Object.keys(d) });
  const after = (await groupWithOptions(b, id))!;
  return ok(serializeGroup(after.g, after.options));
}

export async function addGroupOptionsApi(ctx: ApiContext, id: string, d: z.infer<typeof groupOptionsBody>) {
  const b = ctx.business.id;
  if (!(await groupWithOptions(b, id))) return ApiErrors.notFound("product group");
  const labels = cleanLabels(d.options);
  if (!labels.length) return ApiErrors.invalid("Add at least one option.", [{ path: "options", message: "Add at least one option" }]);
  const r = await addOptions({ businessId: b, groupId: id, labels, defaults: { priceCents: d.price_cents ?? null, costCents: d.cost_cents ?? null } });
  await apiAudit(ctx, "api.product_group.add_options", "product_group", id, { added: r.added, skipped: r.skipped });
  const after = (await groupWithOptions(b, id))!;
  return NextResponse.json({ data: { added: r.added, skipped: r.skipped, group: serializeGroup(after.g, after.options) } }, { status: 201 });
}

export async function convertToGroupApi(ctx: ApiContext, productId: string, d: z.infer<typeof convertBody>) {
  const b = ctx.business.id;
  const p = await withTenant(b, (tx) => tx.query.products.findFirst({ where: and(eq(schema.products.id, productId), eq(schema.products.businessId, b)), columns: { id: true } }));
  if (!p) return ApiErrors.notFound("product");
  const g = await convertToGroup({ businessId: b, productId, label: d.label });
  await apiAudit(ctx, "api.product.convert_to_group", "product", productId, { group_id: g.id });
  const after = (await groupWithOptions(b, g.id))!;
  return ok(serializeGroup(after.g, after.options), 201);
}

// ---------------------------------------------------------------------------
// Extra barcodes (a case, a different pack size): one scan of one stands for `units_per_scan` units
// ---------------------------------------------------------------------------
export const barcodeBody = z.object({ code: z.string().trim().min(1).max(60), units_per_scan: z.number().int().min(1).max(1000).optional() }).strict();
const serializeBarcode = (r: typeof schema.productBarcodes.$inferSelect) => ({ id: r.id, product_id: r.productId, code: r.code, units_per_scan: r.unitsPerScan, created_at: iso(r.createdAt) });

const productExists = (b: string, id: string) => withTenant(b, (tx) => tx.query.products.findFirst({ where: and(eq(schema.products.id, id), eq(schema.products.businessId, b)), columns: { id: true } }));

export async function listBarcodesApi(b: string, productId: string) {
  if (!(await productExists(b, productId))) return ApiErrors.notFound("product");
  const rows = await withTenant(b, (tx) => tx.select().from(schema.productBarcodes).where(and(eq(schema.productBarcodes.productId, productId), eq(schema.productBarcodes.businessId, b))).orderBy(asc(schema.productBarcodes.createdAt)));
  return ok(rows.map(serializeBarcode));
}

export async function addBarcodeApi(ctx: ApiContext, productId: string, d: z.infer<typeof barcodeBody>) {
  const b = ctx.business.id;
  if (!(await productExists(b, productId))) return ApiErrors.notFound("product");
  await attachBarcode({ businessId: b, productId, code: d.code, mode: "add", units: d.units_per_scan ?? 1, actorUserId: ctx.actor });
  const code = d.code.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const row = await withTenant(b, (tx) => tx.query.productBarcodes.findFirst({ where: and(eq(schema.productBarcodes.productId, productId), eq(schema.productBarcodes.businessId, b), eq(schema.productBarcodes.code, code)) }));
  await apiAudit(ctx, "api.product.barcode_add", "product", productId, { code, units: d.units_per_scan ?? 1 });
  return ok(serializeBarcode(row!), 201);
}

export async function deleteBarcodeApi(ctx: ApiContext, productId: string, barcodeId: string) {
  const b = ctx.business.id;
  const row = await withTenant(b, (tx) => tx.query.productBarcodes.findFirst({ where: and(eq(schema.productBarcodes.id, barcodeId), eq(schema.productBarcodes.productId, productId), eq(schema.productBarcodes.businessId, b)), columns: { id: true } }));
  if (!row) return ApiErrors.notFound("barcode");
  await removeExtraBarcode({ businessId: b, id: barcodeId });
  await apiAudit(ctx, "api.product.barcode_remove", "product", productId, { barcode_id: barcodeId });
  return ok({ id: barcodeId, deleted: true });
}
