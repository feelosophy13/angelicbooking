// Add-ons: the add-on price and time rules, booking one online at its add-on terms with the "(add-on)" label through to the ticket,
// and the add-on going back to its usual price when the service it came with is removed.
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined }), headers: async () => new Headers({ host: "kit.test" }) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("next/navigation", async (orig) => ({ ...(await orig<typeof import("next/navigation")>()), redirect: (url: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { url }); } }));
import { asc, eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { addDays, instantToISODate, zonedToInstant } from "@angelic/core";
import { addonTerms, AddonError, saveAddons } from "@/server/addons";
import { bookOnline } from "@/app/book/[slug]/actions";
import { removeServiceFromAppointment } from "@/server/booking";
import { openSaleForAppointment, getSale } from "@/server/sales";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

const up = await reachable();

describe("add-on terms", () => {
  const usual = { priceCents: 2500, durationMin: 25 };
  it("uses a fixed add-on price, an amount off the stylist's price, or the usual price", () => {
    expect(addonTerms({ priceCents: 1500, discountCents: null, durationMin: 15 }, usual)).toMatchObject({ priceCents: 1500, durationMin: 15, regularPriceCents: 2500, discounted: true });
    expect(addonTerms({ priceCents: null, discountCents: 1000, durationMin: null }, { priceCents: 3000, durationMin: 25 })).toMatchObject({ priceCents: 2000, durationMin: 25 });
    expect(addonTerms({ priceCents: null, discountCents: 9000, durationMin: null }, usual).priceCents).toBe(0);
    expect(addonTerms({ priceCents: null, discountCents: null, durationMin: null }, usual)).toMatchObject({ priceCents: 2500, discounted: false });
  });
});

describe.skipIf(!up)("add-ons in a booking", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let staffId: string;
  let waxId: string;
  let tintId: string;
  let userId: string;
  let tz = "America/New_York";
  beforeAll(async () => {
    kit = await setupKit([]);
    userId = `u_${kit.A}`;
    await db.insert(schema.user).values({ id: userId, name: "Tester", email: `${userId}@example.test`, emailVerified: true });
    await db.update(schema.businesses).set({ onlineBookingEnabled: true, verifyBookingContact: false, publishRequiresVerified: false }).where(eq(schema.businesses.id, kit.A));
    tz = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }))!.timezone;
    await withTenant(kit.A, async (tx) => {
      const [st] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Sam" }).returning();
      staffId = st!.id;
      for (let weekday = 0; weekday < 7; weekday++) await tx.insert(schema.staffSchedules).values({ businessId: kit.A, staffId, weekday, startTime: "09:00", endTime: "17:00" });
      const [w] = await tx.insert(schema.services).values({ businessId: kit.A, name: "Eyebrow Wax", durationMin: 15, priceCents: 1300 }).returning();
      const [t] = await tx.insert(schema.services).values({ businessId: kit.A, name: "Brow Tint", durationMin: 25, priceCents: 2500 }).returning();
      waxId = w!.id;
      tintId = t!.id;
    });
  });
  afterAll(async () => {
    await kit?.teardown();
    if (userId) await db.delete(schema.user).where(eq(schema.user.id, userId));
  });

  it("refuses more than three add-ons and a price given both ways", async () => {
    await expect(saveAddons(kit.A, waxId, ["a", "b", "c", "d"].map((x) => ({ addonServiceId: x, priceCents: null, discountCents: null, durationMin: null })))).rejects.toThrow(AddonError);
    await expect(saveAddons(kit.A, waxId, [{ addonServiceId: tintId, priceCents: 1500, discountCents: 500, durationMin: null }])).rejects.toThrow(/not both/);
  });

  it("books an add-on at its add-on price and time, labelled, and the ticket shows it", async () => {
    await saveAddons(kit.A, waxId, [{ addonServiceId: tintId, priceCents: 1500, discountCents: null, durationMin: 15 }]);
    const startAt = zonedToInstant(addDays(instantToISODate(new Date(), tz), 10), "10:00", tz);
    const fd = new FormData();
    for (const [k, v] of Object.entries({ slug: kit.A, serviceId: waxId, staffId, startAt: startAt.toISOString(), extraServiceIds: tintId, firstName: "Pat", lastName: "Lee", phone: "(571) 555-0190", email: "pat@example.test", notes: "" })) fd.set(k, v);
    const out = await bookOnline(undefined, fd).catch((e: Error & { url?: string }) => e);
    expect((out as { url?: string }).url).toMatch(/\/confirmed\//);
    const appt = (await withTenant(kit.A, (tx) => tx.query.appointments.findFirst()))!;
    const items = await withTenant(kit.A, (tx) => tx.select().from(schema.appointmentItems).where(eq(schema.appointmentItems.appointmentId, appt.id)).orderBy(asc(schema.appointmentItems.sortOrder)));
    expect(items.map((i) => [i.serviceName, i.priceCents, (i.endAt.getTime() - i.startAt.getTime()) / 60_000])).toEqual([["Eyebrow Wax", 1300, 15], ["Brow Tint (add-on)", 1500, 15]]);
    const saleId = await openSaleForAppointment({ businessId: kit.A, appointmentId: appt.id, actorUserId: userId, taxRateBps: 0, currency: "usd" });
    const lines = (await getSale(kit.A, typeof saleId === "string" ? saleId : (saleId as { saleId: string }).saleId))!.lines.filter((l) => l.kind === "service");
    expect(lines.map((l) => [l.name, l.amountCents])).toEqual([["Eyebrow Wax", 1300], ["Brow Tint (add-on)", 1500]]);
  });

  it("puts an add-on back to its usual price when the service it came with is removed", async () => {
    const appt = (await withTenant(kit.A, (tx) => tx.query.appointments.findFirst()))!;
    const wax = (await withTenant(kit.A, (tx) => tx.query.appointmentItems.findFirst({ where: eq(schema.appointmentItems.serviceId, waxId) })))!;
    await removeServiceFromAppointment({ businessId: kit.A, itemId: wax.id, actorUserId: userId });
    const tint = (await withTenant(kit.A, (tx) => tx.query.appointmentItems.findFirst({ where: eq(schema.appointmentItems.serviceId, tintId) })))!;
    expect([tint.serviceName, tint.priceCents, tint.appointmentId]).toEqual(["Brow Tint", 2500, appt.id]);
  });
});
