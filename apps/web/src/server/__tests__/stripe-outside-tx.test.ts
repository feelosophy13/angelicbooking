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
vi.mock("@/lib/stripe", async (orig) => ({
  ...(await orig<typeof import("@/lib/stripe")>()),
  stripe: () => ({
    refunds: {
      create: async (_params: unknown, opts: { idempotencyKey: string }) => {
        if (probe) rowFreeDuringCall.push(await probe());
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
    probe = free(kit.A, "payments", p!.id);
    const refund = () => refundPayment({ businessId: kit.A, accountId: "acct_test", paymentId: p!.id, amountCents: 2000, reason: null, actorUserId: userId, taxRateBps: 0 });
    await Promise.allSettled([refund(), refund()]);
    expect(rowFreeDuringCall.every(Boolean)).toBe(true);
    const d = (await getSale(kit.A, saleId))!;
    expect(d.refunds.map((r) => [r.amountCents, r.stripeRefundId])).toEqual([[2000, "re_1"]]);
    // The webhook for that same refund: already booked, nothing added.
    expect(await recordStripeSideRefund({ businessId: kit.A, paymentIntentId: `pi_${kit.A}`, refundedTotalCents: 2000, refundId: "re_1", taxRateBps: 0 })).toBe(0);
    expect((await getSale(kit.A, saleId))!.refunds.length).toBe(1);
  });

  it("refunds a deposit without holding the appointment row", async () => {
    rowFreeDuringCall = [];
    const clientId = (await withTenant(kit.A, (tx) => tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Ana" }).returning()))[0]!.id;
    const [appt] = await withTenant(kit.A, (tx) => tx.insert(schema.appointments).values({ businessId: kit.A, clientId, depositCents: 2500, depositStatus: "paid", depositPaymentIntentId: `pi_dep_${kit.A}`, depositStripeAccountId: "acct_test" }).returning());
    probe = free(kit.A, "appointments", appt!.id);
    await Promise.all([1, 2].map(() => refundDeposit({ businessId: kit.A, accountId: "acct_test", appointmentId: appt!.id, actorUserId: userId, reason: "test" })));
    expect(rowFreeDuringCall.length).toBeGreaterThan(0);
    expect(rowFreeDuringCall.every(Boolean)).toBe(true);
    const after = await withTenant(kit.A, (tx) => tx.query.appointments.findFirst({ where: eq(schema.appointments.id, appt!.id) }));
    expect(after!.depositStatus).toBe("refunded");
    const logged = await withTenant(kit.A, (tx) => tx.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, appt!.id)));
    expect(logged.filter((l) => l.action === "deposit.refund").length).toBe(1);
  });
});
