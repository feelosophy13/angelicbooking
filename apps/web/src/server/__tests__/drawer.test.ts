/**
 * Integration test for the cash drawer and the closing report: cash payments and cash refunds land in the open drawer at the ticket's
 * location (the trigger from migration 0137) and card ones don't, expected cash follows float + cash − refunds − tip payouts + pay-ins −
 * payouts, a close that is off needs a note, and the day's report adds up across methods, refunds, deposits and open tickets.
 * Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise. Nothing here calls a third party.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { instantToISODate, zonedToInstant } from "@angelic/core";
import { addServiceLine, openWalkInSale, recordManualPayment, refundPayment, setTips } from "@/server/sales";
import { getPayrollInputs } from "@/server/payroll";
import { addDrawerMovement, closeDrawer, closingDay, correctClosedDrawer, DrawerError, drawerHistory, getDrawer, openDrawer, openDrawers } from "@/server/drawer";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";
import { shiftISODate } from "@/lib/utils";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

const up = await reachable();

describe.skipIf(!up)("cash drawer and closing report", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let userId: string;
  let main: string;
  let other: string;
  let stylist: string;
  let serviceId: string;
  let business: typeof schema.businesses.$inferSelect;
  let drawerId: string;
  const ids = {} as Record<"cash" | "ext" | "away" | "card" | "open", string>;
  beforeAll(async () => {
    kit = await setupKit([]);
    userId = `u_${kit.A}`;
    await db.insert(schema.user).values({ id: userId, name: "Dana Desk", email: `${userId}@example.test`, emailVerified: true });
    await withTenant(kit.A, async (tx) => {
      const [m] = await tx.insert(schema.locations).values({ businessId: kit.A, name: "Main", isDefault: true }).returning();
      const [o] = await tx.insert(schema.locations).values({ businessId: kit.A, name: "Other" }).returning();
      main = m!.id;
      other = o!.id;
      const [s] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Stylist" }).returning();
      stylist = s!.id;
      const [sv] = await tx.insert(schema.services).values({ businessId: kit.A, name: "Cut", durationMin: 60, priceCents: 10_000 }).returning();
      serviceId = sv!.id;
    });
    business = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }))!;
  });
  afterAll(async () => {
    await kit?.teardown();
    if (userId) await db.delete(schema.user).where(eq(schema.user.id, userId));
  });

  const base = () => ({ businessId: kit.A, actorUserId: userId, taxRateBps: 0 });
  async function ticket(locationId: string, tip?: { cents: number; method: "cash" | "card" | null }) {
    const saleId = await openWalkInSale({ businessId: kit.A, actorUserId: userId, currency: "usd", locationId });
    await addServiceLine({ ...base(), saleId, serviceId, staffId: stylist });
    if (tip) await setTips({ businessId: kit.A, saleId, tips: [{ staffId: stylist, amountCents: tip.cents, method: tip.method }], taxRateBps: 0 });
    return saleId;
  }
  const paymentsOf = (saleId: string) => withTenant(kit.A, (tx) => tx.select().from(schema.payments).where(eq(schema.payments.saleId, saleId)));

  it("opens one drawer per register at a location", async () => {
    drawerId = await openDrawer({ businessId: kit.A, locationId: main, register: "Main", openingFloatCents: 20_000, actorUserId: userId });
    await expect(openDrawer({ businessId: kit.A, locationId: main, register: "main", openingFloatCents: 0, actorUserId: userId })).rejects.toBeInstanceOf(DrawerError);
    expect((await openDrawers(kit.A, main)).map((d) => d.id)).toEqual([drawerId]);
    expect(await openDrawers(kit.A, other)).toEqual([]);
  });

  it("stamps cash taken at this location into the drawer, and leaves card and other sites' cash out", async () => {
    // $100 service + $10 tip in cash.
    ids.cash = await ticket(main, { cents: 1000, method: "cash" });
    await recordManualPayment({ ...base(), saleId: ids.cash, method: "cash", amountCents: 11_000, note: null });
    // Own-terminal card: not cash.
    ids.ext = await ticket(main, { cents: 2000, method: "card" });
    await recordManualPayment({ ...base(), saleId: ids.ext, method: "external_card", amountCents: 12_000, note: null });
    // Cash at the other site, where no drawer is open.
    ids.away = await ticket(other);
    await recordManualPayment({ ...base(), saleId: ids.away, method: "cash", amountCents: 10_000, note: null });
    expect((await paymentsOf(ids.cash))[0]!.drawerSessionId).toBe(drawerId);
    expect((await paymentsOf(ids.ext))[0]!.drawerSessionId).toBeNull();
    expect((await paymentsOf(ids.away))[0]!.drawerSessionId).toBeNull();
  });

  it("expected cash = float + cash − cash refunds − tips paid out + pay-ins − payouts", async () => {
    const pay = (await paymentsOf(ids.cash))[0]!;
    await refundPayment({ businessId: kit.A, accountId: null, paymentId: pay.id, amountCents: 3000, reason: "unhappy", actorUserId: userId, taxRateBps: 0 });
    await addDrawerMovement({ businessId: kit.A, sessionId: drawerId, kind: "pay_in", amountCents: 5000, reason: "Change run", actorUserId: userId });
    await addDrawerMovement({ businessId: kit.A, sessionId: drawerId, kind: "payout", amountCents: 1200, reason: "Coffee filters", actorUserId: userId });
    await addDrawerMovement({ businessId: kit.A, sessionId: drawerId, kind: "tip_payout", amountCents: 1000, reason: "Cash tip", staffId: stylist, actorUserId: userId });
    const d = (await getDrawer(kit.A, drawerId))!;
    expect(d.refunds).toHaveLength(1);
    expect(d.flows).toEqual({ openingFloatCents: 20_000, cashSalesCents: 11_000, cashRefundsCents: 3000, tipPayoutsCents: 1000, payInsCents: 5000, payoutsCents: 1200 });
    expect(d.expectedCents).toBe(20_000 + 11_000 - 3000 - 1000 + 5000 - 1200);
    expect(d.movements.find((m) => m.kind === "tip_payout")!.staffName).toBe("Stylist");
  });

  it("won't pay out more than the drawer holds", async () => {
    await expect(addDrawerMovement({ businessId: kit.A, sessionId: drawerId, kind: "payout", amountCents: 1_000_000, reason: "Too much", actorUserId: userId })).rejects.toThrow(/should only hold/);
  });

  it("a count that is off needs a note; the close stores expected, counted and the difference", async () => {
    const expected = 30_800;
    await expect(closeDrawer({ businessId: kit.A, sessionId: drawerId, countedCents: expected - 500, note: null, actorUserId: userId })).rejects.toThrow(/short by more than/);
    // By denomination: 15 × $20 + 1 × $5 + 2 × $1 + 4 × 25¢ = $308.00 − ... one dollar short is within the limit.
    const r = await closeDrawer({ businessId: kit.A, sessionId: drawerId, denominations: { "2000": 15, "500": 1, "100": 1, "25": 4 }, note: null, actorUserId: userId });
    expect(r).toEqual({ expectedCents: expected, countedCents: 30_700, overShortCents: -100 });
    const d = (await getDrawer(kit.A, drawerId))!;
    expect(d.status).toBe("closed");
    expect(d.closedByName).toBe("Dana Desk");
    expect(d.denominations).toEqual({ "2000": 15, "500": 1, "100": 1, "25": 4 });
    await expect(addDrawerMovement({ businessId: kit.A, sessionId: drawerId, kind: "pay_in", amountCents: 100, reason: "late", actorUserId: userId })).rejects.toThrow(/closed/);
    const today = instantToISODate(new Date(), business.timezone);
    const hist = await drawerHistory(kit.A, { from: zonedToInstant(today, "00:00", business.timezone), to: zonedToInstant(shiftISODate(today, 1), "00:00", business.timezone) });
    expect(hist.map((h) => [h.s.id, h.s.overShortCents, h.openedByName])).toEqual([[drawerId, -100, "Dana Desk"]]);
  });

  it("a closed drawer can be corrected: a recount and a movement missed while it was open, both kept on the record", async () => {
    await expect(correctClosedDrawer({ businessId: kit.A, sessionId: drawerId, countedCents: null, missed: null, reason: "x", actorUserId: userId, actorName: "Dana Desk" })).rejects.toThrow(/Change the count/);
    await expect(correctClosedDrawer({ businessId: kit.A, sessionId: drawerId, countedCents: 30_800, missed: null, reason: " ", actorUserId: userId, actorName: "Dana Desk" })).rejects.toThrow(/why/);
    // A $5 cash tip handed over but not entered: expected drops to $303; the count stands at $307, so $4 over.
    const r = await correctClosedDrawer({ businessId: kit.A, sessionId: drawerId, countedCents: null, missed: { kind: "tip_payout", amountCents: 500, reason: "Cash tip", staffId: stylist }, reason: "Forgot to enter Sam's tip", actorUserId: userId, actorName: "Dana Desk" });
    expect(r).toEqual({ expectedCents: 30_300, countedCents: 30_700, overShortCents: 400 });
    // Then a recount finds $303 exactly.
    const r2 = await correctClosedDrawer({ businessId: kit.A, sessionId: drawerId, countedCents: 30_300, missed: null, reason: "Recounted", actorUserId: userId, actorName: "Dana Desk" });
    expect(r2.overShortCents).toBe(0);
    const d = (await getDrawer(kit.A, drawerId))!;
    expect(d.status).toBe("closed");
    expect(d.denominations).toBeNull();
    expect(d.closeNote).toBe("Corrected by Dana Desk: Forgot to enter Sam's tip\nCorrected by Dana Desk: Recounted");
    expect(d.movements.filter((m) => m.kind === "tip_payout").map((m) => m.reason)).toContain("Cash tip (added after closing)");
  });

  it("payroll takes tips paid out of the drawer off the pay sheet, so they aren't paid twice", async () => {
    const today = instantToISODate(new Date(), business.timezone);
    const inputs = await getPayrollInputs(business, { start: today, end: today });
    const mine = inputs.adjustments.filter((a) => a.staffId === stylist && a.label.startsWith("Tip paid out from the drawer"));
    expect(mine.map((a) => [a.amountCents, a.countsAsPay]).sort()).toEqual([[-1000, false], [-500, false]]);
    const split = await getPayrollInputs(business, { start: today, end: today }, main, { split: true });
    expect(split.adjustments).toEqual([]);
  });

  it("the closing report adds up the day by method, with refunds, card totals per processor, deposits and open tickets", async () => {
    // A Stripe card payment, a deposit applied today (charged online on another day), a deposit taken online today and an unpaid ticket.
    ids.card = await ticket(main);
    const dep = await withTenant(kit.A, async (tx) => {
      const [booked] = await tx.insert(schema.appointments).values({ businessId: kit.A, locationId: main, depositCents: 2500, depositStatus: "paid", depositPaymentIntentId: `pi_today_${kit.A}` }).returning();
      const [old] = await tx.insert(schema.appointments).values({ businessId: kit.A, locationId: main, depositCents: 4000, depositStatus: "applied", depositPaymentIntentId: `pi_old_${kit.A}`, createdAt: new Date(Date.now() - 5 * 86_400_000) }).returning();
      await tx.update(schema.sales).set({ appointmentId: old!.id }).where(eq(schema.sales.id, ids.card));
      await tx.insert(schema.payments).values([
        { businessId: kit.A, saleId: ids.card, method: "card", status: "succeeded", amountCents: 4000, stripePaymentIntentId: `pi_old_${kit.A}`, note: "Deposit paid online" },
        { businessId: kit.A, saleId: ids.card, method: "card", status: "succeeded", amountCents: 6000, stripePaymentIntentId: `pi_desk_${kit.A}` },
      ]);
      await tx.update(schema.sales).set({ status: "paid", paidCents: 10_000, closedAt: new Date() }).where(eq(schema.sales.id, ids.card));
      // A deposit refunded to the card today after a cancellation: $10 back through Stripe.
      const [cancelled] = await tx.insert(schema.appointments).values({ businessId: kit.A, locationId: main, depositCents: 1000, depositStatus: "refunded", depositProvider: "stripe", createdAt: new Date(Date.now() - 3 * 86_400_000) }).returning();
      await tx.insert(schema.auditLog).values({ businessId: kit.A, actorUserId: userId, action: "deposit.refund", entity: "appointment", entityId: cancelled!.id, diff: JSON.stringify({ cents: 1000, kept: 0 }) });
      return booked!;
    });
    expect(dep.depositCents).toBe(2500);
    ids.open = await ticket(main);
    const tz = business.timezone;
    const today = instantToISODate(new Date(), tz);
    const r = await closingDay(kit.A, main, zonedToInstant(today, "00:00", tz), zonedToInstant(shiftISODate(today, 1), "00:00", tz));
    const by = Object.fromEntries(r.methods.map((m) => [m.method, m]));
    expect(by.cash).toMatchObject({ count: 1, amountCents: 11_000, refundsCents: 3000, netCents: 8000, tipsCents: 1000 });
    expect(by.card).toMatchObject({ count: 2, amountCents: 10_000, refundsCents: 0, tipsCents: 0 });
    expect(by.external_card).toMatchObject({ amountCents: 12_000, tipsCents: 2000 });
    expect(r.totals).toMatchObject({ amountCents: 33_000, refundsCents: 3000, netCents: 30_000 });
    // Stripe: $60 at the desk + $25 deposit booked online today; the $40 deposit applied today was charged on its booking day.
    expect(r.processors).toEqual([{ provider: "stripe", chargedCents: 6000, depositsCents: 2500, refundsCents: 0, depositRefundsCents: 1000, netCents: 7500 }]);
    expect(r.deposits).toEqual({ count: 1, amountCents: 2500 });
    expect(r.tickets).toMatchObject({ count: 3, servicesCents: 30_000, productsCents: 0, tipCents: 3000 });
    expect(r.openTickets.map((t) => [t.id, t.dueCents])).toEqual([[ids.open, 10_000]]);
    expect(r.drawers.map((d) => d.s.id)).toEqual([drawerId]);
    expect(r.unstampedCashCents).toBe(0);
    // The other site's cash was taken with no drawer open.
    const away = await closingDay(kit.A, other, zonedToInstant(today, "00:00", tz), zonedToInstant(shiftISODate(today, 1), "00:00", tz));
    expect(away.unstampedCashCents).toBe(10_000);
  });
});
