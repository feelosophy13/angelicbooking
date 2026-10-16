/**
 * Integration test for the 2026-10-16 money fixes: fee tickets with a paid deposit, re-ringing after a void, late cash tips, refunds of card
 * payments with no Stripe reference, and the webhook settling a payment by its metadata id. Needs Postgres at DATABASE_URL (the app role,
 * RLS forced); skipped otherwise. Nothing here calls Stripe.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { addTipAfterPayment, getSale, markCardPaymentSucceeded, openFeeSaleForAppointment, openSaleForAppointment, recordManualPayment, refundPayment, voidSale } from "@/server/sales";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

// Closing a visit ticket queues its automations with next/server's after(), which only exists inside a request.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

const up = await reachable();
const TAX = 0;

describe.skipIf(!up)("money fixes", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let userId: string;
  let staffId: string;
  let serviceId: string;
  let clientId: string;
  let n = 0;
  beforeAll(async () => {
    kit = await setupKit([]);
    userId = `u_${kit.A}`;
    await db.insert(schema.user).values({ id: userId, name: "Tester", email: `${userId}@example.test`, emailVerified: true });
    await withTenant(kit.A, async (tx) => {
      await tx.insert(schema.locations).values({ businessId: kit.A, name: "Main", isDefault: true });
      const [s] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Sam" }).returning({ id: schema.staff.id });
      staffId = s!.id;
      const [sv] = await tx.insert(schema.services).values({ businessId: kit.A, name: "Cut", durationMin: 60, priceCents: 8000 }).returning({ id: schema.services.id });
      serviceId = sv!.id;
      const [c] = await tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Ana" }).returning({ id: schema.clients.id });
      clientId = c!.id;
    });
  });
  afterAll(async () => {
    await kit?.teardown();
    if (userId) await db.delete(schema.user).where(eq(schema.user.id, userId));
  });

  /** An appointment (each on its own day so none overlap), optionally with a $25 deposit paid online. */
  async function appointment(deposit = false) {
    const start = new Date(Date.UTC(2031, 0, 1 + n++, 15));
    return withTenant(kit.A, async (tx) => {
      const [a] = await tx
        .insert(schema.appointments)
        .values({ businessId: kit.A, clientId, ...(deposit ? { depositCents: 2500, depositStatus: "paid" as const, depositPaymentIntentId: `pi_dep_${n}_${kit.A}` } : {}) })
        .returning({ id: schema.appointments.id });
      await tx.insert(schema.appointmentItems).values({ businessId: kit.A, appointmentId: a!.id, staffId, serviceId, serviceName: "Cut", startAt: start, endAt: new Date(start.getTime() + 3_600_000), priceCents: 8000 });
      return a!.id;
    });
  }
  const appt = (id: string) => withTenant(kit.A, (tx) => tx.query.appointments.findFirst({ where: eq(schema.appointments.id, id) }));
  const fee = (appointmentId: string, cents: number) =>
    openFeeSaleForAppointment({ businessId: kit.A, appointmentId, name: "No-show fee", feeCents: cents, actorUserId: userId, taxRateBps: TAX, currency: "usd", auditAction: "appointment.no_show_fee" });

  it("turns an open visit ticket that took the deposit into a fee ticket, and puts the deposit back on the appointment", async () => {
    const id = await appointment(true);
    const visit = await openSaleForAppointment({ businessId: kit.A, appointmentId: id, actorUserId: userId, taxRateBps: TAX, currency: "usd" });
    expect((await appt(id))!.depositStatus).toBe("applied");
    const saleId = await fee(id, 3000);
    expect(saleId).toBe(visit);
    const d = (await getSale(kit.A, saleId))!;
    expect(d.lines.map((l) => [l.kind, l.amountCents])).toEqual([["fee", 3000]]);
    expect([d.sale.totalCents, d.sale.paidCents]).toEqual([3000, 0]);
    expect(d.payments).toHaveLength(0);
    expect((await appt(id))!.depositStatus).toBe("paid");
  });

  it("paying a fee ticket doesn't complete the visit or award points", async () => {
    const id = await appointment(true);
    const saleId = await fee(id, 4000);
    await recordManualPayment({ businessId: kit.A, saleId, method: "cash", amountCents: 4000, note: null, actorUserId: userId, taxRateBps: TAX });
    expect((await getSale(kit.A, saleId))!.sale.status).toBe("paid");
    const a = (await appt(id))!;
    expect(a.status).toBe("booked");
    expect(a.depositStatus).toBe("paid");
    const earned = await withTenant(kit.A, (tx) => tx.select().from(schema.loyaltyLedger).where(and(eq(schema.loyaltyLedger.saleId, saleId), eq(schema.loyaltyLedger.reason, "earn"))));
    expect(earned).toHaveLength(0);
  });

  it("refuses to turn a ticket with a real payment into a fee", async () => {
    const id = await appointment();
    const saleId = await openSaleForAppointment({ businessId: kit.A, appointmentId: id, actorUserId: userId, taxRateBps: TAX, currency: "usd" });
    await recordManualPayment({ businessId: kit.A, saleId, method: "cash", amountCents: 1000, note: null, actorUserId: userId, taxRateBps: TAX });
    await expect(fee(id, 3000)).rejects.toThrow(/already has a payment/);
  });

  it("rings a visit up again after its ticket was voided", async () => {
    const id = await appointment();
    const first = await openSaleForAppointment({ businessId: kit.A, appointmentId: id, actorUserId: userId, taxRateBps: TAX, currency: "usd" });
    await voidSale({ businessId: kit.A, saleId: first, actorUserId: userId });
    const second = await openSaleForAppointment({ businessId: kit.A, appointmentId: id, actorUserId: userId, taxRateBps: TAX, currency: "usd" });
    expect(second).not.toBe(first);
    expect((await getSale(kit.A, second))!.sale.status).toBe("open");
  });

  it("adds a cash tip after payment as one tip line and a matching payment", async () => {
    const id = await appointment();
    const saleId = await openSaleForAppointment({ businessId: kit.A, appointmentId: id, actorUserId: userId, taxRateBps: TAX, currency: "usd" });
    await recordManualPayment({ businessId: kit.A, saleId, method: "cash", amountCents: 8000, note: null, actorUserId: userId, taxRateBps: TAX });
    await addTipAfterPayment({ businessId: kit.A, saleId, staffId, amountCents: 1500, method: "cash", actorUserId: userId, taxRateBps: TAX });
    const d = (await getSale(kit.A, saleId))!;
    expect(d.lines.filter((l) => l.kind === "tip").map((l) => [l.staffId, l.amountCents])).toEqual([[staffId, 1500]]);
    expect([d.sale.totalCents, d.sale.paidCents, d.sale.status]).toEqual([9500, 9500, "paid"]);
    expect(d.payments.every((p) => p.status === "succeeded")).toBe(true);
  });

  it("settles a card payment found only by the payment id in its metadata, once", async () => {
    const id = await appointment();
    const saleId = await openSaleForAppointment({ businessId: kit.A, appointmentId: id, actorUserId: userId, taxRateBps: TAX, currency: "usd" });
    const [p] = await withTenant(kit.A, (tx) => tx.insert(schema.payments).values({ businessId: kit.A, saleId, method: "card_on_file", status: "pending", amountCents: 8000 }).returning({ id: schema.payments.id }));
    const piId = `pi_meta_${kit.A}`;
    const call = () => markCardPaymentSucceeded({ businessId: kit.A, paymentIntentId: piId, chargeId: "ch_1", card: { brand: "visa", last4: "4242" }, taxRateBps: TAX, metadata: { businessId: kit.A, paymentId: p!.id } });
    await call();
    await call();
    const d = (await getSale(kit.A, saleId))!;
    expect(d.payments.map((x) => [x.status, x.stripePaymentIntentId, x.cardLast4])).toEqual([["succeeded", piId, "4242"]]);
    expect(d.sale.status).toBe("paid");
  });

  it("won't record a refund of a card payment that has no Stripe reference", async () => {
    const id = await appointment();
    const saleId = await openSaleForAppointment({ businessId: kit.A, appointmentId: id, actorUserId: userId, taxRateBps: TAX, currency: "usd" });
    const [p] = await withTenant(kit.A, (tx) => tx.insert(schema.payments).values({ businessId: kit.A, saleId, method: "card_on_file", status: "succeeded", amountCents: 8000 }).returning({ id: schema.payments.id }));
    await expect(refundPayment({ businessId: kit.A, accountId: "acct_x", paymentId: p!.id, amountCents: 8000, reason: null, actorUserId: userId, taxRateBps: TAX })).rejects.toThrow(/no Stripe reference/);
  });
});
