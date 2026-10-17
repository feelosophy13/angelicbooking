/**
 * Integration test: refunds call Stripe with no transaction open (the payment and appointment rows are free while Stripe answers), a
 * double click records one refund, and a refund the webhook already booked isn't booked twice. Needs Postgres at DATABASE_URL (the app
 * role, RLS forced); skipped otherwise. Stripe is mocked.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

let rowFreeDuringCall: boolean[] = [];
let probe: (() => Promise<boolean>) | null = null;
const refunds = new Map<string, { id: string }>();
// For a double click: hold each Stripe call until `waitFor` calls are in flight (so the two clicks really overlap), at most 2 s.
let waitFor = 1;
let inFlight = 0;
vi.mock("@/lib/stripe", async (orig) => ({
  ...(await orig<typeof import("@/lib/stripe")>()),
  stripe: () => ({
    refunds: {
      create: async (_params: unknown, opts: { idempotencyKey: string }) => {
        if (probe) rowFreeDuringCall.push(await probe());
        inFlight++;
        for (let t = 0; inFlight < waitFor && t < 200; t++) await new Promise((r) => setTimeout(r, 10));
        await new Promise((r) => setTimeout(r, 20));
        if (!refunds.has(opts.idempotencyKey)) refunds.set(opts.idempotencyKey, { id: `re_${refunds.size + 1}` });
        return refunds.get(opts.idempotencyKey)!;
      },
    },
  }),
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

const { addServiceLine, getSale, openWalkInSale, refundPayment, recordStripeSideRefund } = await import("@/server/sales");
const { refundDeposit } = await import("@/server/online-payments");
const up = await reachable();

/** Can another connection lock this row right now? (False if a transaction still holds it.) */
const free = (businessId: string, table: "payments" | "appointments", id: string) => () =>
  withTenant(businessId, (tx) => tx.execute(sql`select 1 from ${sql.identifier(table)} where id = ${id} for update nowait`)).then(
    () => true,
    () => false,
  );

describe.skipIf(!up)("Stripe calls outside transactions", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let userId: string;
  let serviceId: string;
  let staffId: string;
  beforeAll(async () => {
    kit = await setupKit([]);
    userId = `u_${kit.A}`;
    await db.insert(schema.user).values({ id: userId, name: "Tester", email: `${userId}@example.test`, emailVerified: true });
    await withTenant(kit.A, async (tx) => {
      await tx.update(schema.businesses).set({ depositRefundAs: "original" }).where(eq(schema.businesses.id, kit.A));
      staffId = (await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Sam" }).returning())[0]!.id;
      serviceId = (await tx.insert(schema.services).values({ businessId: kit.A, name: "Cut", durationMin: 30, priceCents: 5000 }).returning())[0]!.id;
    });
  });
  afterAll(async () => {
    await kit?.teardown();
    if (userId) await db.delete(schema.user).where(eq(schema.user.id, userId));
  });

  it("refunds a card payment without holding the row, once per double click, and not again when the webhook reports it", async () => {
    const saleId = await openWalkInSale({ businessId: kit.A, actorUserId: userId, currency: "usd", clientId: null });
    await addServiceLine({ businessId: kit.A, actorUserId: userId, taxRateBps: 0, saleId, serviceId, staffId });
    const [p] = await withTenant(kit.A, async (tx) => {
      await tx.update(schema.sales).set({ status: "paid", paidCents: 5000, closedAt: new Date() }).where(eq(schema.sales.id, saleId));
      return tx.insert(schema.payments).values({ businessId: kit.A, saleId, method: "card", status: "succeeded", amountCents: 5000, stripePaymentIntentId: `pi_${kit.A}`, stripeAccountId: "acct_test" }).returning();
    });
    const refund = (cents: number) => refundPayment({ businessId: kit.A, accountId: "acct_test", paymentId: p!.id, amountCents: cents, reason: null, actorUserId: userId, taxRateBps: 0 });
    // One refund: the payment row is free while Stripe answers. (With two at once, one may hold it while the other calls Stripe.)
    probe = free(kit.A, "payments", p!.id);
    await refund(1000);
    probe = null;
    expect(rowFreeDuringCall).toEqual([true]);
    // A double click: one refund.
    waitFor = 2;
    inFlight = 0;
    await Promise.allSettled([refund(1000), refund(1000)]);
    waitFor = 1;
    const d = (await getSale(kit.A, saleId))!;
    expect(d.refunds.map((r) => [r.amountCents, r.stripeRefundId]).sort((x, y) => String(x[1]).localeCompare(String(y[1])))).toEqual([[1000, "re_1"], [1000, "re_2"]]);
    // The webhook for that same refund: already booked, nothing added.
    expect(await recordStripeSideRefund({ businessId: kit.A, paymentIntentId: `pi_${kit.A}`, refundedTotalCents: 2000, refundId: "re_2", taxRateBps: 0 })).toBe(0);
    expect((await getSale(kit.A, saleId))!.refunds.length).toBe(2);
  });

  it("refunds a deposit without holding the appointment row", async () => {
    rowFreeDuringCall = [];
    const clientId = (await withTenant(kit.A, (tx) => tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Ana" }).returning()))[0]!.id;
    const deposit = async (n: number) => (await withTenant(kit.A, (tx) => tx.insert(schema.appointments).values({ businessId: kit.A, clientId, depositCents: 2500, depositStatus: "paid", depositPaymentIntentId: `pi_dep${n}_${kit.A}`, depositStripeAccountId: "acct_test" }).returning()))[0]!;
    const refund = (id: string) => refundDeposit({ businessId: kit.A, accountId: "acct_test", appointmentId: id, actorUserId: userId, reason: "test" });
    const one = await deposit(1);
    probe = free(kit.A, "appointments", one.id);
    await refund(one.id);
    probe = null;
    expect(rowFreeDuringCall).toEqual([true]);
    // A double click: refunded once, logged once.
    const two = await deposit(2);
    await Promise.all([refund(two.id), refund(two.id)]);
    const after = await withTenant(kit.A, (tx) => tx.query.appointments.findFirst({ where: eq(schema.appointments.id, two.id) }));
    expect(after!.depositStatus).toBe("refunded");
    const logged = await withTenant(kit.A, (tx) => tx.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, two.id)));
    expect(logged.filter((l) => l.action === "deposit.refund").length).toBe(1);
  });

  it("sends two equal partial deposit refunds as two refunds", async () => {
    const clientId = (await withTenant(kit.A, (tx) => tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Bo" }).returning()))[0]!.id;
    const appt = (await withTenant(kit.A, (tx) => tx.insert(schema.appointments).values({ businessId: kit.A, clientId, depositCents: 3000, depositStatus: "paid", depositPaymentIntentId: `pi_dep3_${kit.A}`, depositStripeAccountId: "acct_test" }).returning()))[0]!;
    const before = refunds.size;
    for (let n = 0; n < 2; n++) await refundDeposit({ businessId: kit.A, accountId: "acct_test", appointmentId: appt.id, actorUserId: userId, reason: "partial", amountCents: 1000 });
    expect(refunds.size - before).toBe(2);
    const after = await withTenant(kit.A, (tx) => tx.query.appointments.findFirst({ where: eq(schema.appointments.id, appt.id) }));
    expect([after!.depositStatus, after!.depositCents]).toEqual(["paid", 1000]);
  });
});
