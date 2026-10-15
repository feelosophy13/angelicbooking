import { NextResponse } from "next/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema, withTenant } from "@angelic/db";
import { ApiErrors, apiAudit, readBody, type ApiContext } from "@/lib/api";
import { TIMEZONES } from "@/lib/utils";
import { SMS_DEFAULTS, SMS_PLACEHOLDERS, SMS_TEMPLATE_KEYS } from "@/lib/notify/sms";
import { ensureRefundReasons, moveRefundReason, RefundReasonError, renameRefundReason, setRefundReasonActive } from "@/server/refund-reasons";
import { serializeLocation } from "@/server/api-v1-more";

/**
 * Settings area of the public API: the business profile, booking rules, loyalty, store, reviews and the text wording, plus locations and refund reasons.
 * Each section edits exactly the columns the matching save action in the app edits and nothing more: never Stripe, tax, the custom domain, the messaging
 * number, billing, logo or cover uploads, or anything on the auth side. Money is in cents, rates in basis points.
 */

type Business = typeof schema.businesses.$inferSelect;
const blankToNull = (v: string | null) => (v ? v : null);
/** An optional http(s) address; empty means none. Same rule as the app's URL fields. */
const url = z.string().trim().max(500).refine((v) => !v || /^https?:\/\/\S+$/i.test(v), "Enter a full URL starting with https://").nullable().transform((v) => (v ? v : null));
const money = z.number().int().min(0).max(10_000_000);

type Err = { error: { path: string; message: string } };
type Section<S extends z.ZodTypeAny> = {
  schema: S;
  serialize: (b: Business) => unknown;
  /** The columns to write for a validated body, given the stored business (for rules that span fields); or an error. */
  columns: (d: z.infer<S>, b: Business) => Partial<typeof schema.businesses.$inferInsert> | Err;
};
const section = <S extends z.ZodTypeAny>(s: Section<S>) => s;

// No `.default()` in any of these schemas: a PATCH must leave unmentioned settings as they are.
const profile = section({
  schema: z.object({
    tagline: z.string().trim().max(120).nullable(),
    about: z.string().trim().max(1500).nullable(),
    brand_color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #6d28d9").nullable(),
    website: url,
    instagram: z.string().trim().max(60).nullable(),
    hours_text: z.string().trim().max(600).nullable(),
  }).partial().strict(),
  serialize: (b) => ({ tagline: b.tagline, about: b.about, brand_color: b.brandColor, website: b.website, instagram: b.instagram, hours_text: b.hoursText, logo_url: b.logoUrl, cover_url: b.coverUrl }),
  columns: (d) => ({
    ...(d.tagline !== undefined ? { tagline: blankToNull(d.tagline) } : {}),
    ...(d.about !== undefined ? { about: blankToNull(d.about) } : {}),
    // The app stores the default violet as "no colour set".
    ...(d.brand_color !== undefined ? { brandColor: d.brand_color && d.brand_color.toLowerCase() !== "#6d28d9" ? d.brand_color : null } : {}),
    ...(d.website !== undefined ? { website: d.website } : {}),
    ...(d.instagram !== undefined ? { instagram: (d.instagram?.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/$/, "") ?? "") || null } : {}),
    ...(d.hours_text !== undefined ? { hoursText: blankToNull(d.hours_text) } : {}),
  }),
});

const booking = section({
  schema: z.object({
    online_booking_enabled: z.boolean(),
    require_card_online: z.boolean(),
    client_accounts_enabled: z.boolean(),
    min_notice_min: z.number().int().min(0).max(7 * 24 * 60),
    max_advance_days: z.number().int().min(1).max(365),
    cancel_window_hours: z.number().int().min(0).max(168),
    no_show_fee_cents: money,
    late_cancel_fee_type: z.enum(["none", "flat", "percent"]),
    late_cancel_fee_value: z.number().int().min(0).max(10_000_000),
    late_cancel_deposit: z.enum(["toward", "extra"]),
    deposit_refund_as: z.enum(["original", "store_credit"]),
    booking_policy: z.string().trim().max(1000).nullable(),
    address_line: z.string().trim().max(200).nullable(),
  }).partial().strict(),
  serialize: (b) => ({
    online_booking_enabled: b.onlineBookingEnabled, require_card_online: b.requireCardOnline, client_accounts_enabled: b.clientAccountsEnabled, min_notice_min: b.minNoticeMin,
    max_advance_days: b.maxAdvanceDays, cancel_window_hours: b.cancelWindowHours, no_show_fee_cents: b.noShowFeeCents, late_cancel_fee_type: b.lateCancelFeeType,
    late_cancel_fee_value: b.lateCancelFeeValue, late_cancel_deposit: b.lateCancelDeposit, deposit_refund_as: b.depositRefundAs, booking_policy: b.bookingPolicy, address_line: b.addressLine,
  }),
  columns: (d, b) => {
    // The fee rules read the stored values for whatever the body leaves out (flat: cents; percent: basis points, so 1250 = 12.5%).
    const type = d.late_cancel_fee_type ?? (b.lateCancelFeeType as "none" | "flat" | "percent");
    const value = d.late_cancel_fee_value ?? b.lateCancelFeeValue;
    if (type !== "none" && value <= 0) return { error: { path: "late_cancel_fee_value", message: type === "flat" ? "Enter the fee amount." : "Enter the percent." } };
    if (type === "percent" && value > 10_000) return { error: { path: "late_cancel_fee_value", message: "At most 100% (10000 basis points)." } };
    return {
      ...(d.late_cancel_fee_type !== undefined || d.late_cancel_fee_value !== undefined ? { lateCancelFeeType: type, lateCancelFeeValue: type === "none" ? 0 : value } : {}),
      ...(d.late_cancel_deposit !== undefined ? { lateCancelDeposit: d.late_cancel_deposit } : {}),
      ...(d.online_booking_enabled !== undefined ? { onlineBookingEnabled: d.online_booking_enabled } : {}),
      ...(d.require_card_online !== undefined ? { requireCardOnline: d.require_card_online } : {}),
      ...(d.client_accounts_enabled !== undefined ? { clientAccountsEnabled: d.client_accounts_enabled } : {}),
      ...(d.min_notice_min !== undefined ? { minNoticeMin: d.min_notice_min } : {}),
      ...(d.max_advance_days !== undefined ? { maxAdvanceDays: d.max_advance_days } : {}),
      ...(d.cancel_window_hours !== undefined ? { cancelWindowHours: d.cancel_window_hours } : {}),
      ...(d.no_show_fee_cents !== undefined ? { noShowFeeCents: d.no_show_fee_cents } : {}),
      ...(d.deposit_refund_as !== undefined ? { depositRefundAs: d.deposit_refund_as } : {}),
      ...(d.booking_policy !== undefined ? { bookingPolicy: blankToNull(d.booking_policy) } : {}),
      ...(d.address_line !== undefined ? { addressLine: blankToNull(d.address_line) } : {}),
    };
  },
});

const loyalty = section({
  schema: z.object({
    enabled: z.boolean(),
    points_per_dollar: z.number().int().min(0).max(100),
    points_per_visit: z.number().int().min(0).max(10_000),
    point_value_cents: z.number().int().min(1).max(1000),
    min_redeem_points: z.number().int().min(1).max(100_000),
    referral_bonus_points: z.number().int().min(0).max(100_000),
    referral_friend_bonus_points: z.number().int().min(0).max(100_000),
  }).partial().strict(),
  serialize: (b) => ({
    enabled: b.loyaltyEnabled, points_per_dollar: b.loyaltyPointsPerDollar, points_per_visit: b.loyaltyPointsPerVisit, point_value_cents: b.loyaltyPointValueCents,
    min_redeem_points: b.loyaltyMinRedeemPoints, referral_bonus_points: b.referralBonusPoints, referral_friend_bonus_points: b.referralFriendBonusPoints,
  }),
  columns: (d) => ({
    ...(d.enabled !== undefined ? { loyaltyEnabled: d.enabled } : {}),
    ...(d.points_per_dollar !== undefined ? { loyaltyPointsPerDollar: d.points_per_dollar } : {}),
    ...(d.points_per_visit !== undefined ? { loyaltyPointsPerVisit: d.points_per_visit } : {}),
    ...(d.point_value_cents !== undefined ? { loyaltyPointValueCents: d.point_value_cents } : {}),
    ...(d.min_redeem_points !== undefined ? { loyaltyMinRedeemPoints: d.min_redeem_points } : {}),
    ...(d.referral_bonus_points !== undefined ? { referralBonusPoints: d.referral_bonus_points } : {}),
    ...(d.referral_friend_bonus_points !== undefined ? { referralFriendBonusPoints: d.referral_friend_bonus_points } : {}),
  }),
});

const store = section({
  schema: z.object({ store_enabled: z.boolean(), gift_cards_online: z.boolean(), shipping_flat_cents: money }).partial().strict(),
  serialize: (b) => ({ store_enabled: b.storeEnabled, gift_cards_online: b.giftCardsOnline, shipping_flat_cents: b.shippingFlatCents }),
  columns: (d) => ({
    ...(d.store_enabled !== undefined ? { storeEnabled: d.store_enabled } : {}),
    ...(d.gift_cards_online !== undefined ? { giftCardsOnline: d.gift_cards_online } : {}),
    ...(d.shipping_flat_cents !== undefined ? { shippingFlatCents: d.shipping_flat_cents } : {}),
  }),
});

const reviews = section({
  schema: z.object({ google_review_url: url }).partial().strict(),
  serialize: (b) => ({ google_review_url: b.googleReviewUrl }),
  columns: (d) => (d.google_review_url !== undefined ? { googleReviewUrl: d.google_review_url } : {}),
});

const templateShape = Object.fromEntries(SMS_TEMPLATE_KEYS.map((k) => [k, z.string().trim().max(500).nullable()]));
const notifications = section({
  schema: z.object({ templates: z.object(templateShape).partial().strict() }).partial().strict(),
  serialize: (b) => ({
    templates: Object.fromEntries(SMS_TEMPLATE_KEYS.map((k) => [k, { text: b.smsTemplates?.[k] || SMS_DEFAULTS[k], is_default: !b.smsTemplates?.[k] }])),
    placeholders: [...SMS_PLACEHOLDERS],
  }),
  columns: (d, b) => {
    if (d.templates === undefined) return {};
    // A blank or null wording goes back to the default; other templates keep what is stored.
    const next: Record<string, string> = { ...(b.smsTemplates ?? {}) };
    for (const [k, v] of Object.entries(d.templates as Record<string, string | null>)) {
      if (v) next[k] = v;
      else delete next[k];
    }
    return { smsTemplates: next };
  },
});

export const SETTINGS = { profile, booking, loyalty, store, reviews, notifications } as const;
export type SettingsKey = keyof typeof SETTINGS;

export async function getSettingsApi(ctx: ApiContext, key: SettingsKey) {
  // Fresh read: ctx.business was loaded when the request started.
  const b = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, ctx.business.id) });
  return b ? NextResponse.json({ data: SETTINGS[key].serialize(b) }) : ApiErrors.notFound("business");
}

export async function patchSettingsApi(ctx: ApiContext, req: Request, key: SettingsKey) {
  const sec = SETTINGS[key] as Section<z.ZodTypeAny>;
  const body = await readBody(req, sec.schema);
  if ("error" in body) return body.error;
  const cur = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, ctx.business.id) });
  if (!cur) return ApiErrors.notFound("business");
  const set = sec.columns(body.data, cur);
  if ("error" in set) return ApiErrors.invalid(set.error.message, [set.error]);
  let row = cur;
  if (Object.keys(set).length) {
    row = (await db.update(schema.businesses).set(set).where(eq(schema.businesses.id, ctx.business.id)).returning())[0]!;
    await apiAudit(ctx, `api.settings.${key}.update`, "business", ctx.business.id, body.data);
  }
  return NextResponse.json({ data: sec.serialize(row!) });
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

type WeeklyHours = Record<string, { open: string; close: string } | null>;
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM");
const day = z.object({ open: time, close: time }).strict().refine((h) => h.open < h.close, "open must be before close").nullable();
const hours = z.record(z.string().regex(/^[0-6]$/, "Keys are weekday numbers 0 (Sunday) to 6"), day).nullable();
const timezone = z.string().refine((v) => TIMEZONES.includes(v), "Pick a time zone from the list").nullable();
/** A missing weekday means closed, as in the app's editor. */
const fullWeek = (h: WeeklyHours | null): WeeklyHours | null => (h ? Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), h[String(d)] ?? null])) : null);

export const locationPatch = z.object({
  name: z.string().trim().min(1).max(80),
  address_line1: z.string().trim().max(120).nullable(),
  city: z.string().trim().max(60).nullable(),
  state: z.string().trim().max(40).nullable(),
  postal_code: z.string().trim().max(20).nullable(),
  phone: z.string().trim().max(30).nullable(),
  timezone,
  hours,
}).partial().strict();
export const locationCreate = locationPatch.required({ name: true });

function locationColumns(d: z.infer<typeof locationPatch>) {
  const set: Partial<typeof schema.locations.$inferInsert> = {};
  if (d.name !== undefined) set.name = d.name;
  if (d.address_line1 !== undefined) set.addressLine1 = blankToNull(d.address_line1);
  if (d.city !== undefined) set.city = blankToNull(d.city);
  if (d.state !== undefined) set.state = blankToNull(d.state);
  if (d.postal_code !== undefined) set.postalCode = blankToNull(d.postal_code);
  if (d.phone !== undefined) set.phone = blankToNull(d.phone);
  if (d.timezone !== undefined) set.timezone = d.timezone;
  if (d.hours !== undefined) set.hours = fullWeek(d.hours);
  return set;
}

export async function createLocationApi(ctx: ApiContext, req: Request) {
  const body = await readBody(req, locationCreate);
  if ("error" in body) return body.error;
  const [row] = await withTenant(ctx.business.id, (tx) => tx.insert(schema.locations).values({ ...locationColumns(body.data), businessId: ctx.business.id, name: body.data.name }).returning());
  await apiAudit(ctx, "api.location.create", "location", row!.id, { name: row!.name });
  return NextResponse.json({ data: serializeLocation(row!) }, { status: 201 });
}

export async function patchLocationApi(ctx: ApiContext, req: Request, id: string) {
  const body = await readBody(req, locationPatch);
  if ("error" in body) return body.error;
  // Only the columns above are ever written: never the payment account, the tax rate, the default flag or the clock-in token.
  const set = locationColumns(body.data);
  const row = await withTenant(ctx.business.id, async (tx) => {
    if (!Object.keys(set).length) return tx.query.locations.findFirst({ where: and(eq(schema.locations.id, id), eq(schema.locations.businessId, ctx.business.id)) });
    return (await tx.update(schema.locations).set(set).where(and(eq(schema.locations.id, id), eq(schema.locations.businessId, ctx.business.id))).returning())[0];
  });
  if (!row) return ApiErrors.notFound("location");
  await apiAudit(ctx, "api.location.update", "location", id, body.data);
  return NextResponse.json({ data: serializeLocation(row) });
}

export async function setDefaultLocationApi(ctx: ApiContext, id: string) {
  const row = await withTenant(ctx.business.id, async (tx) => {
    const l = await tx.query.locations.findFirst({ where: and(eq(schema.locations.id, id), eq(schema.locations.businessId, ctx.business.id)) });
    if (!l) return null;
    await tx.update(schema.locations).set({ isDefault: false }).where(eq(schema.locations.businessId, ctx.business.id));
    return (await tx.update(schema.locations).set({ isDefault: true }).where(and(eq(schema.locations.id, id), eq(schema.locations.businessId, ctx.business.id))).returning())[0]!;
  });
  if (!row) return ApiErrors.notFound("location");
  await apiAudit(ctx, "api.location.default", "location", id);
  return NextResponse.json({ data: serializeLocation(row) });
}

export async function deleteLocationApi(ctx: ApiContext, id: string) {
  const out = await withTenant(ctx.business.id, async (tx) => {
    const all = await tx.select({ id: schema.locations.id, isDefault: schema.locations.isDefault, stripe: schema.locations.stripeAccountId }).from(schema.locations).where(eq(schema.locations.businessId, ctx.business.id));
    const l = all.find((x) => x.id === id);
    if (!l) return "missing" as const;
    if (l.isDefault) return "default" as const;
    if (all.length <= 1) return "last" as const;
    // Removing a location that has its own payment account would silently disconnect it: that stays a deliberate step in the app.
    if (l.stripe) return "payments" as const;
    await tx.delete(schema.locations).where(and(eq(schema.locations.id, id), eq(schema.locations.businessId, ctx.business.id)));
    return "ok" as const;
  });
  if (out === "missing") return ApiErrors.notFound("location");
  if (out === "default") return ApiErrors.conflict("The default location can't be removed.");
  if (out === "last") return ApiErrors.conflict("A business needs at least one location.");
  if (out === "payments") return ApiErrors.conflict("This location has its own payment account. Remove it in the app first.");
  await apiAudit(ctx, "api.location.delete", "location", id);
  return NextResponse.json({ data: { id, deleted: true } });
}

// ---------------------------------------------------------------------------
// Refund reasons
// ---------------------------------------------------------------------------

type ReasonRow = typeof schema.refundReasons.$inferSelect;
export const serializeReason = (r: ReasonRow) => ({ id: r.id, name: r.name, sort_order: r.sortOrder, active: r.active, created_at: r.createdAt.toISOString() });

export const reasonCreate = z.object({ name: z.string().trim().min(1).max(60) }).strict();
export const reasonPatch = z.object({ name: z.string().trim().min(1).max(60), active: z.boolean() }).partial().strict();
export const reasonMove = z.object({ direction: z.enum(["up", "down"]) }).strict();

async function reasonList(businessId: string, activeOnly = false) {
  return withTenant(businessId, async (tx) => {
    await ensureRefundReasons(tx, businessId);
    const rows = await tx.select().from(schema.refundReasons).where(eq(schema.refundReasons.businessId, businessId)).orderBy(asc(schema.refundReasons.sortOrder), asc(schema.refundReasons.name));
    return activeOnly ? rows.filter((r) => r.active) : rows;
  });
}
const findReason = (businessId: string, id: string) => withTenant(businessId, (tx) => tx.query.refundReasons.findFirst({ where: and(eq(schema.refundReasons.id, id), eq(schema.refundReasons.businessId, businessId)) }));

export async function listReasonsApi(ctx: ApiContext, req: Request) {
  const activeOnly = new URL(req.url).searchParams.get("active_only") === "1";
  return NextResponse.json({ data: (await reasonList(ctx.business.id, activeOnly)).map(serializeReason) });
}

export async function createReasonApi(ctx: ApiContext, req: Request) {
  const body = await readBody(req, reasonCreate);
  if ("error" in body) return body.error;
  const row = await withTenant(ctx.business.id, async (tx) => {
    await ensureRefundReasons(tx, ctx.business.id);
    const [max] = await tx.select({ m: sql<number>`coalesce(max(${schema.refundReasons.sortOrder}), -1)` }).from(schema.refundReasons).where(eq(schema.refundReasons.businessId, ctx.business.id));
    return (await tx.insert(schema.refundReasons).values({ businessId: ctx.business.id, name: body.data.name, sortOrder: Number(max?.m ?? -1) + 1 }).returning())[0]!;
  });
  await apiAudit(ctx, "api.refund_reason.create", "refund_reason", row.id, { name: row.name });
  return NextResponse.json({ data: serializeReason(row) }, { status: 201 });
}

export async function patchReasonApi(ctx: ApiContext, req: Request, id: string) {
  const body = await readBody(req, reasonPatch);
  if ("error" in body) return body.error;
  const cur = await findReason(ctx.business.id, id);
  if (!cur) return ApiErrors.notFound("refund reason");
  try {
    if (body.data.name !== undefined) await renameRefundReason(ctx.business.id, id, body.data.name);
    // Only call when the state changes: retiring a retired reason must not trip the "keep at least one" count.
    if (body.data.active !== undefined && body.data.active !== cur.active) await setRefundReasonActive(ctx.business.id, id, body.data.active);
  } catch (e) {
    if (e instanceof RefundReasonError) return ApiErrors.conflict(e.message);
    throw e;
  }
  await apiAudit(ctx, "api.refund_reason.update", "refund_reason", id, body.data);
  return NextResponse.json({ data: serializeReason((await findReason(ctx.business.id, id))!) });
}

export async function moveReasonApi(ctx: ApiContext, req: Request, id: string) {
  const body = await readBody(req, reasonMove);
  if ("error" in body) return body.error;
  if (!(await findReason(ctx.business.id, id))) return ApiErrors.notFound("refund reason");
  await moveRefundReason(ctx.business.id, id, body.data.direction);
  await apiAudit(ctx, "api.refund_reason.move", "refund_reason", id, body.data);
  return NextResponse.json({ data: (await reasonList(ctx.business.id)).map(serializeReason) });
}
