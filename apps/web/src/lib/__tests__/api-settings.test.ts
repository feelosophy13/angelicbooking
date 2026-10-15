/**
 * Integration test: the settings area of /api/v1 (business profile, booking, loyalty, store, reviews, text wording, locations, refund reasons).
 * Needs Postgres at DATABASE_URL; skipped otherwise. Uses throwaway businesses from the shared kit, never a real tenant.
 */
import "../../../../../packages/db/src/env"; // first: @angelic/db connects when imported, and must see DATABASE_URL (the RLS-bound app role)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, getSql, schema, withTenant } from "@angelic/db";
import { call, reachable, send, setupKit } from "./api-test-kit";

import { GET as getProfile, PATCH as patchProfile } from "@/app/api/v1/settings/profile/route";
import { GET as getBooking, PATCH as patchBooking } from "@/app/api/v1/settings/booking/route";
import { GET as getLoyalty, PATCH as patchLoyalty } from "@/app/api/v1/settings/loyalty/route";
import { GET as getStore, PATCH as patchStore } from "@/app/api/v1/settings/store/route";
import { GET as getReviews, PATCH as patchReviews } from "@/app/api/v1/settings/reviews/route";
import { GET as getNotif, PATCH as patchNotif } from "@/app/api/v1/settings/notifications/route";
import { GET as getLocations, POST as postLocation } from "@/app/api/v1/locations/route";
import { GET as getLocation, PATCH as patchLocation, DELETE as deleteLocation } from "@/app/api/v1/locations/[id]/route";
import { POST as postDefault } from "@/app/api/v1/locations/[id]/default/route";
import { GET as getReasons, POST as postReason } from "@/app/api/v1/refund-reasons/route";
import { PATCH as patchReason } from "@/app/api/v1/refund-reasons/[id]/route";
import { POST as moveReason } from "@/app/api/v1/refund-reasons/[id]/move/route";
import { SMS_DEFAULTS } from "@/lib/notify/sms";

const up = await reachable();
type Kit = Awaited<ReturnType<typeof setupKit>>;
let kit: Kit;
let key = "";
let noScope = "";
let readOnly = "";
const id: Record<string, string> = {};
const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as any });
const noParams = {} as Record<string, never>;
const biz = (b: string) => db.query.businesses.findFirst({ where: eq(schema.businesses.id, b) });
const locs = (b: string) => withTenant(b, (tx) => tx.select().from(schema.locations).where(eq(schema.locations.businessId, b)));
const reasons = (b: string) => withTenant(b, (tx) => tx.select().from(schema.refundReasons).where(eq(schema.refundReasons.businessId, b)));

beforeAll(async () => {
  if (!up) return;
  kit = await setupKit(["settings:write"]);
  noScope = await kit.mkKey(kit.A, ["catalog:write", "staff:write"]);
  readOnly = await kit.mkKey(kit.A, ["settings:read"]);
  for (const b of [kit.A, kit.B]) {
    const t = b === kit.A ? "A" : "B";
    const [def] = await withTenant(b, (tx) => tx.insert(schema.locations).values({ businessId: b, name: `Main ${t}`, isDefault: true }).returning());
    const [second] = await withTenant(b, (tx) => tx.insert(schema.locations).values({ businessId: b, name: `Second ${t}` }).returning());
    const [reason] = await withTenant(b, (tx) => tx.insert(schema.refundReasons).values({ businessId: b, name: `Reason ${t}`, sortOrder: 0 }).returning());
    Object.assign(id, { [`def${t}`]: def!.id, [`second${t}`]: second!.id, [`reason${t}`]: reason!.id });
  }
});

// A key may make 120 requests a minute: each test gets its own.
beforeEach(async () => {
  if (up) key = await kit.mkKey(kit.A, ["settings:write"]);
});

afterAll(async () => {
  if (!up) return;
  await kit.teardown();
  await getSql().end();
});

describe.skipIf(!up)("API settings: scopes", () => {
  it("answers 403 without the scope and 401 without a key", async () => {
    const cases: [string, Promise<Response>][] = [
      ["GET profile", call(getProfile, noScope)],
      ["PATCH profile", call(patchProfile, noScope, noParams, send("PATCH", {}))],
      ["PATCH booking", call(patchBooking, readOnly, noParams, send("PATCH", {}))],
      ["PATCH loyalty", call(patchLoyalty, readOnly, noParams, send("PATCH", {}))],
      ["PATCH store", call(patchStore, readOnly, noParams, send("PATCH", {}))],
      ["PATCH reviews", call(patchReviews, readOnly, noParams, send("PATCH", {}))],
      ["PATCH notifications", call(patchNotif, readOnly, noParams, send("PATCH", {}))],
      ["POST location", call(postLocation, readOnly, noParams, send("POST", { name: "X" }))],
      ["PATCH location", call(patchLocation, readOnly, { id: id.secondA! }, send("PATCH", {}))],
      ["DELETE location", call(deleteLocation, readOnly, { id: id.secondA! }, send("DELETE"))],
      ["POST default", call(postDefault, readOnly, { id: id.secondA! }, send("POST"))],
      ["POST reason", call(postReason, readOnly, noParams, send("POST", { name: "X" }))],
      ["PATCH reason", call(patchReason, readOnly, { id: id.reasonA! }, send("PATCH", {}))],
      ["move reason", call(moveReason, readOnly, { id: id.reasonA! }, send("POST", { direction: "up" }))],
      ["GET reasons", call(getReasons, noScope)],
      ["GET notifications", call(getNotif, noScope)],
    ];
    for (const [name, p] of cases) expect((await p).status, name).toBe(403);
    expect((await call(getProfile, null)).status).toBe(401);
    // The read scope reads.
    expect((await call(getBooking, readOnly)).status).toBe(200);
    expect((await call(getReasons, readOnly)).status).toBe(200);
    // Locations: the existing GET stays on catalog:read; writes need settings:write.
    expect((await call(getLocations, readOnly)).status).toBe(403);
  });
});

describe.skipIf(!up)("API settings: sections", () => {
  it("profile: reads, patches only what is sent, normalises, validates", async () => {
    const g = await json(await call(getProfile, key));
    expect(g.status).toBe(200);
    expect(Object.keys(g.body.data).sort()).toEqual(["about", "brand_color", "cover_url", "hours_text", "instagram", "logo_url", "tagline", "website"]);
    const r = await json(await call(patchProfile, key, noParams, send("PATCH", { tagline: "Lashes & more", instagram: "@angelic.lash", website: "https://example.com", brand_color: "#112233" })));
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ tagline: "Lashes & more", instagram: "angelic.lash", website: "https://example.com", brand_color: "#112233" });
    await call(patchProfile, key, noParams, send("PATCH", { about: "About us" }));
    expect(await biz(kit.A)).toMatchObject({ tagline: "Lashes & more", about: "About us", instagram: "angelic.lash", brandColor: "#112233" });
    // Default violet is stored as "none"; blank clears; null clears.
    await call(patchProfile, key, noParams, send("PATCH", { brand_color: "#6D28D9", website: "", tagline: null }));
    expect(await biz(kit.A)).toMatchObject({ brandColor: null, website: null, tagline: null, about: "About us" });
    for (const bad of [{ brand_color: "purple" }, { website: "javascript:alert(1)" }, { website: "ftp://x.com" }, { tagline: "x".repeat(121) }, { about: "x".repeat(1501) }, { logo_url: "https://x.com/a.png" }, { name: "New name" }, { slug: "x" }])
      expect((await call(patchProfile, key, noParams, send("PATCH", bad))).status, JSON.stringify(bad)).toBe(422);
    // B is untouched.
    expect(await biz(kit.B)).toMatchObject({ tagline: null, about: null });
  });

  it("booking: patch keeps omitted fields and enforces the fee rules", async () => {
    const before = (await biz(kit.A))!;
    const r = await json(await call(patchBooking, key, noParams, send("PATCH", { min_notice_min: 30, cancel_window_hours: 48, booking_policy: "Be kind" })));
    expect(r.status).toBe(200);
    const after = (await biz(kit.A))!;
    expect(after).toMatchObject({ minNoticeMin: 30, cancelWindowHours: 48, bookingPolicy: "Be kind" });
    for (const k of ["onlineBookingEnabled", "requireCardOnline", "clientAccountsEnabled", "maxAdvanceDays", "noShowFeeCents", "lateCancelFeeType", "lateCancelFeeValue", "lateCancelDeposit", "depositRefundAs", "addressLine"] as const) expect(after[k], k).toEqual(before[k]);
    // A fee type needs a value; percent is capped at 100%.
    expect((await call(patchBooking, key, noParams, send("PATCH", { late_cancel_fee_type: "flat" }))).status).toBe(422);
    expect((await call(patchBooking, key, noParams, send("PATCH", { late_cancel_fee_type: "percent", late_cancel_fee_value: 10_001 }))).status).toBe(422);
    expect((await biz(kit.A))!.lateCancelFeeType).toBe("none");
    expect((await call(patchBooking, key, noParams, send("PATCH", { late_cancel_fee_type: "percent", late_cancel_fee_value: 2500, late_cancel_deposit: "extra", no_show_fee_cents: 3000, deposit_refund_as: "store_credit", online_booking_enabled: false }))).status).toBe(200);
    expect(await biz(kit.A)).toMatchObject({ lateCancelFeeType: "percent", lateCancelFeeValue: 2500, lateCancelDeposit: "extra", noShowFeeCents: 3000, depositRefundAs: "store_credit", onlineBookingEnabled: false, minNoticeMin: 30 });
    // Back to none zeroes the value.
    await call(patchBooking, key, noParams, send("PATCH", { late_cancel_fee_type: "none" }));
    expect(await biz(kit.A)).toMatchObject({ lateCancelFeeType: "none", lateCancelFeeValue: 0 });
    for (const bad of [{ min_notice_min: -1 }, { max_advance_days: 0 }, { max_advance_days: 366 }, { cancel_window_hours: 169 }, { late_cancel_fee_type: "huge" }, { deposit_refund_as: "cash" }, { booking_policy: "x".repeat(1001) }, { require_card_online: "yes" }, { stripe_account_id: "acct_1" }, { no_show_fee_cents: -5 }])
      expect((await call(patchBooking, key, noParams, send("PATCH", bad))).status, JSON.stringify(bad)).toBe(422);
    expect((await json(await call(getBooking, key))).body.data).toMatchObject({ late_cancel_fee_type: "none", min_notice_min: 30 });
    expect(await biz(kit.B)).toMatchObject({ minNoticeMin: 120, cancelWindowHours: 24 });
  });

  it("loyalty and store: patch semantics and bounds", async () => {
    const before = (await biz(kit.A))!;
    expect((await call(patchLoyalty, key, noParams, send("PATCH", { enabled: true, points_per_dollar: 2 }))).status).toBe(200);
    const after = (await biz(kit.A))!;
    expect(after).toMatchObject({ loyaltyEnabled: true, loyaltyPointsPerDollar: 2 });
    for (const k of ["loyaltyPointsPerVisit", "loyaltyPointValueCents", "loyaltyMinRedeemPoints", "referralBonusPoints", "referralFriendBonusPoints"] as const) expect(after[k], k).toEqual(before[k]);
    for (const bad of [{ points_per_dollar: 101 }, { point_value_cents: 0 }, { min_redeem_points: 0 }, { referral_bonus_points: -1 }, { enabled: "on" }, { points_per_dollar: 1.5 }, { balance: 5 }])
      expect((await call(patchLoyalty, key, noParams, send("PATCH", bad))).status, JSON.stringify(bad)).toBe(422);
    expect((await json(await call(getLoyalty, key))).body.data).toMatchObject({ enabled: true, points_per_dollar: 2 });

    const s0 = (await biz(kit.A))!;
    expect((await call(patchStore, key, noParams, send("PATCH", { store_enabled: true, shipping_flat_cents: 595 }))).status).toBe(200);
    expect(await biz(kit.A)).toMatchObject({ storeEnabled: true, shippingFlatCents: 595, giftCardsOnline: s0.giftCardsOnline });
    for (const bad of [{ shipping_flat_cents: -1 }, { store_enabled: 1 }, { shipping_flat_cents: 1.5 }]) expect((await call(patchStore, key, noParams, send("PATCH", bad))).status).toBe(422);
    expect((await json(await call(getStore, key))).body.data).toEqual({ store_enabled: true, gift_cards_online: s0.giftCardsOnline, shipping_flat_cents: 595 });
    expect(await biz(kit.B)).toMatchObject({ loyaltyEnabled: false, storeEnabled: false });
  });

  it("reviews: only the Google review link", async () => {
    expect((await call(patchReviews, key, noParams, send("PATCH", { google_review_url: "https://g.page/r/abc/review" }))).status).toBe(200);
    expect((await json(await call(getReviews, key))).body.data).toEqual({ google_review_url: "https://g.page/r/abc/review" });
    expect((await call(patchReviews, key, noParams, send("PATCH", {}))).status).toBe(200);
    expect((await biz(kit.A))!.googleReviewUrl).toBe("https://g.page/r/abc/review");
    for (const bad of [{ google_review_url: "not a url" }, { google_review_url: "javascript:1" }, { other: 1 }]) expect((await call(patchReviews, key, noParams, send("PATCH", bad))).status).toBe(422);
    await call(patchReviews, key, noParams, send("PATCH", { google_review_url: null }));
    expect((await biz(kit.A))!.googleReviewUrl).toBeNull();
  });

  it("notifications: wording per template with defaults, merge and reset", async () => {
    const g = await json(await call(getNotif, key));
    expect(g.body.data.templates.confirmation).toEqual({ text: SMS_DEFAULTS.confirmation, is_default: true });
    expect(g.body.data.placeholders).toContain("{first_name}");
    const r = await json(await call(patchNotif, key, noParams, send("PATCH", { templates: { confirmation: "{business}: see you {when}!", reminder: "Reminder {when}" } })));
    expect(r.body.data.templates.confirmation).toEqual({ text: "{business}: see you {when}!", is_default: false });
    // Another template keeps its wording when only one is sent; null puts one back to the default.
    await call(patchNotif, key, noParams, send("PATCH", { templates: { reminder: null, cancellation: "Cancelled {when}" } }));
    expect((await biz(kit.A))!.smsTemplates).toEqual({ confirmation: "{business}: see you {when}!", cancellation: "Cancelled {when}" });
    await call(patchNotif, key, noParams, send("PATCH", {}));
    expect(Object.keys((await biz(kit.A))!.smsTemplates)).toHaveLength(2);
    for (const bad of [{ templates: { confirmation: "x".repeat(501) } }, { templates: { unknown_key: "hi" } }, { templates: { confirmation: 5 } }, { templates: "hi" }, { extra: 1 }])
      expect((await call(patchNotif, key, noParams, send("PATCH", bad))).status, JSON.stringify(bad)).toBe(422);
    expect((await biz(kit.B))!.smsTemplates).toEqual({});
  });
});

describe.skipIf(!up)("API settings: locations", () => {
  it("creates, patches and reads a location; the existing GET stays catalog:read", async () => {
    const r = await json(await call(postLocation, key, noParams, send("POST", { name: "Downtown", address_line1: "1 Main St", city: "Austin", state: "TX", postal_code: "78701", phone: "555-1111", timezone: "America/Chicago", hours: { "1": { open: "09:00", close: "17:00" }, "0": null } })));
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ name: "Downtown", city: "Austin", timezone: "America/Chicago", is_default: false });
    expect(r.body.data.hours).toEqual({ "0": null, "1": { open: "09:00", close: "17:00" }, "2": null, "3": null, "4": null, "5": null, "6": null });
    expect(JSON.stringify(r.body)).not.toMatch(/stripe|tax|clock_token/);
    const lid = r.body.data.id;
    // Patch keeps the rest.
    const p = await json(await call(patchLocation, key, { id: lid }, send("PATCH", { phone: "555-2222" })));
    expect(p.status).toBe(200);
    const stored = (await locs(kit.A)).find((l) => l.id === lid)!;
    expect(stored).toMatchObject({ phone: "555-2222", name: "Downtown", city: "Austin", timezone: "America/Chicago", addressLine1: "1 Main St" });
    await call(patchLocation, key, { id: lid }, send("PATCH", { city: "", hours: null, timezone: null }));
    expect((await locs(kit.A)).find((l) => l.id === lid)).toMatchObject({ city: null, hours: null, timezone: null, name: "Downtown" });
    const reader = await kit.mkKey(kit.A, ["catalog:read"]);
    const one = await json(await call(getLocation, reader, { id: lid }));
    expect(one.body.data.name).toBe("Downtown");
    expect((await json(await call(getLocations, reader))).body.data.map((l: any) => l.id)).toContain(lid);
  });

  it("never writes payment or tax columns and rejects them in the body", async () => {
    const before = (await locs(kit.A)).find((l) => l.id === id.secondA)!;
    for (const bad of [{ stripe_account_id: "acct_x" }, { tax_rate_bps: 900 }, { is_default: true }, { clock_token: "x" }, { country: "FR" }])
      expect((await call(patchLocation, key, { id: id.secondA! }, send("PATCH", bad))).status, JSON.stringify(bad)).toBe(422);
    await call(patchLocation, key, { id: id.secondA! }, send("PATCH", { name: "Second renamed" }));
    const after = (await locs(kit.A)).find((l) => l.id === id.secondA)!;
    for (const k of ["stripeAccountId", "stripeChargesEnabled", "stripeDetailsSubmitted", "taxRateBps", "clockToken", "isDefault", "country"] as const) expect(after[k], k).toEqual(before[k]);
    expect(after.name).toBe("Second renamed");
    for (const bad of [{}, { name: "" }, { name: "x".repeat(81) }, { name: "Ok", timezone: "Mars/Base" }, { name: "Ok", hours: { "7": null } }, { name: "Ok", hours: { "1": { open: "17:00", close: "09:00" } } }, { name: "Ok", hours: { "1": { open: "9", close: "17:00" } } }, { name: "Ok", phone: "x".repeat(31) }])
      expect((await call(postLocation, key, noParams, send("POST", bad))).status, JSON.stringify(bad)).toBe(422);
  });

  it("moves the default and keeps the delete rules", async () => {
    const r = await json(await call(postDefault, key, { id: id.secondA! }));
    expect(r.status).toBe(200);
    expect(r.body.data.is_default).toBe(true);
    const all = await locs(kit.A);
    expect(all.filter((l) => l.isDefault).map((l) => l.id)).toEqual([id.secondA]);
    // The default cannot be deleted; a regular one can.
    expect((await call(deleteLocation, key, { id: id.secondA! })).status).toBe(409);
    expect((await locs(kit.A)).some((l) => l.id === id.secondA)).toBe(true);
    const made = await json(await call(postLocation, key, noParams, send("POST", { name: "Temp" })));
    expect((await call(deleteLocation, key, { id: made.body.data.id })).status).toBe(200);
    expect((await locs(kit.A)).some((l) => l.id === made.body.data.id)).toBe(false);
    expect((await call(deleteLocation, key, { id: made.body.data.id })).status).toBe(404);
    // A location with its own payment account is not removed from here.
    const [paid] = await withTenant(kit.A, (tx) => tx.insert(schema.locations).values({ businessId: kit.A, name: "Paid", stripeAccountId: "acct_test_123" }).returning());
    expect((await call(deleteLocation, key, { id: paid!.id })).status).toBe(409);
    expect((await locs(kit.A)).find((l) => l.id === paid!.id)!.stripeAccountId).toBe("acct_test_123");
    // Put the original default back for the other tests.
    await call(postDefault, key, { id: id.defA! });
  });

  it("answers 404 for another business's location and changes nothing there", async () => {
    const before = await locs(kit.B);
    expect((await call(patchLocation, key, { id: id.secondB! }, send("PATCH", { name: "Hacked", phone: "1" }))).status).toBe(404);
    expect((await call(deleteLocation, key, { id: id.secondB! })).status).toBe(404);
    expect((await call(postDefault, key, { id: id.secondB! })).status).toBe(404);
    expect(await locs(kit.B)).toEqual(before);
    // A's default flags are unchanged by the failed call.
    expect((await locs(kit.A)).filter((l) => l.isDefault)).toHaveLength(1);
  });

  it("refuses to delete the only location", async () => {
    const soloKit = await setupKit(["settings:write"]);
    try {
      const [only] = await withTenant(soloKit.A, (tx) => tx.insert(schema.locations).values({ businessId: soloKit.A, name: "Only" }).returning());
      expect((await call(deleteLocation, soloKit.key, { id: only!.id })).status).toBe(409);
      expect(await locs(soloKit.A)).toHaveLength(1);
    } finally {
      await soloKit.teardown();
    }
  });
});

describe.skipIf(!up)("API settings: refund reasons", () => {
  it("lists (seeding defaults), creates, renames, retires, restores and moves", async () => {
    // A third business has no reasons yet: the list seeds the defaults, like the app.
    const fresh = await setupKit(["settings:write"]);
    try {
      const seeded = await json(await call(getReasons, fresh.key));
      expect(seeded.body.data.map((x: any) => x.name)).toEqual(["Service issue", "Client changed mind", "Duplicate charge", "Late cancellation", "Goodwill", "Other"]);
    } finally {
      await fresh.teardown();
    }
    const c = await json(await call(postReason, key, noParams, send("POST", { name: "  Allergic reaction " })));
    expect(c.status).toBe(201);
    expect(c.body.data).toMatchObject({ name: "Allergic reaction", active: true });
    const rid = c.body.data.id;
    const sortOf = async (x: string) => (await reasons(kit.A)).find((r) => r.id === x)!.sortOrder;
    expect(await sortOf(rid)).toBeGreaterThan(await sortOf(id.reasonA!));
    const rn = await json(await call(patchReason, key, { id: rid }, send("PATCH", { name: "Reaction" })));
    expect(rn.body.data).toMatchObject({ name: "Reaction", active: true });
    expect((await json(await call(patchReason, key, { id: rid }, send("PATCH", { active: false })))).body.data).toMatchObject({ name: "Reaction", active: false });
    expect((await json(await call(getReasons, key, noParams, {}, "http://x/api/v1/t?active_only=1"))).body.data.map((x: any) => x.id)).not.toContain(rid);
    expect((await json(await call(getReasons, key))).body.data.map((x: any) => x.id)).toContain(rid);
    expect((await json(await call(patchReason, key, { id: rid }, send("PATCH", { active: true })))).body.data.active).toBe(true);
    // Move up swaps with the neighbour; at the top it is a no-op.
    const up1 = await json(await call(moveReason, key, { id: rid }, send("POST", { direction: "up" })));
    expect(up1.status).toBe(200);
    const order = up1.body.data.map((x: any) => x.id);
    expect(order.indexOf(rid)).toBeLessThan(order.indexOf(id.reasonA));
    await call(moveReason, key, { id: rid }, send("POST", { direction: "up" }));
    const again = await json(await call(moveReason, key, { id: rid }, send("POST", { direction: "up" })));
    expect(again.body.data[0].id).toBe(rid);
  });

  it("keeps at least one active reason, validates, and 404s across businesses", async () => {
    const mine = (await reasons(kit.A)).filter((r) => r.active);
    for (const r of mine.slice(1)) await call(patchReason, key, { id: r.id }, send("PATCH", { active: false }));
    const last = (await reasons(kit.A)).filter((r) => r.active);
    expect(last).toHaveLength(1);
    const blocked = await json(await call(patchReason, key, { id: last[0]!.id }, send("PATCH", { active: false })));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toBe("Keep at least one reason.");
    expect((await reasons(kit.A)).filter((r) => r.active)).toHaveLength(1);
    // Retiring an already retired reason is harmless.
    const retired = (await reasons(kit.A)).find((r) => !r.active)!;
    expect((await call(patchReason, key, { id: retired.id }, send("PATCH", { active: false }))).status).toBe(200);
    for (const bad of [{ name: "" }, { name: "x".repeat(61) }, { active: "no" }, { sort_order: 3 }]) expect((await call(patchReason, key, { id: id.reasonA! }, send("PATCH", bad))).status, JSON.stringify(bad)).toBe(422);
    for (const bad of [{}, { name: "" }, { name: "x".repeat(61) }, { name: "ok", active: false }]) expect((await call(postReason, key, noParams, send("POST", bad))).status, JSON.stringify(bad)).toBe(422);
    expect((await call(moveReason, key, { id: id.reasonA! }, send("POST", { direction: "sideways" }))).status).toBe(422);
    // Another business's reason: 404 and untouched.
    const before = await reasons(kit.B);
    expect((await call(patchReason, key, { id: id.reasonB! }, send("PATCH", { name: "Hacked", active: false }))).status).toBe(404);
    expect((await call(moveReason, key, { id: id.reasonB! }, send("POST", { direction: "down" }))).status).toBe(404);
    expect(await reasons(kit.B)).toEqual(before);
  });

  it("writes an audit row for each settings change", async () => {
    const rows = await withTenant(kit.A, (tx) => tx.select().from(schema.auditLog).where(and(eq(schema.auditLog.businessId, kit.A))));
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ["api.settings.profile.update", "api.settings.booking.update", "api.settings.loyalty.update", "api.settings.store.update", "api.settings.reviews.update", "api.settings.notifications.update", "api.location.create", "api.location.update", "api.location.default", "api.location.delete", "api.refund_reason.create", "api.refund_reason.update", "api.refund_reason.move"])
      expect(actions.has(a), a).toBe(true);
  });
});
