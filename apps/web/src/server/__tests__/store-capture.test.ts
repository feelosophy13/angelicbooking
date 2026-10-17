/**
 * Integration test: online store orders are authorized, then captured only once the stock is checked again. Sold out meanwhile: the
 * authorization is released (cancel), the order voided and the buyer told their card wasn't charged. Capture and cancel are idempotent and
 * cope with "already captured" / "already canceled". The sweep settles orders whose page closed after authorizing, and closes out abandoned
 * ones. Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise. Stripe is mocked.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

type FakePI = { id: string; status: string; metadata: Record<string, string>; latest_charge: unknown };
const intents = new Map<string, FakePI>();
const byKey = new Map<string, FakePI>();
const calls: { op: "capture" | "cancel"; id: string; key: string }[] = [];
const unexpectedState = () => Object.assign(new Error("This PaymentIntent's status is not what the request expects."), { code: "payment_intent_unexpected_state" });

vi.mock("@/lib/stripe", async (orig) => ({
  ...(await orig<typeof import("@/lib/stripe")>()),
  isStripeConfigured: () => true,
  stripe: () => ({
    paymentIntents: {
      retrieve: async (id: string) => {
        const pi = intents.get(id);
        if (!pi) throw new Error(`No such payment_intent: ${id}`);
        return structuredClone(pi);
      },
      capture: async (id: string, _params: unknown, opts: { idempotencyKey: string }) => {
        calls.push({ op: "capture", id, key: opts.idempotencyKey });
        await new Promise((r) => setTimeout(r, 10));
        if (byKey.has(opts.idempotencyKey)) return structuredClone(byKey.get(opts.idempotencyKey)!);
        const pi = intents.get(id)!;
        if (pi.status !== "requires_capture") throw unexpectedState();
        pi.status = "succeeded";
        pi.latest_charge = { id: `ch_${id}`, payment_method_details: { card: { brand: "visa", last4: "4242" } } };
        byKey.set(opts.idempotencyKey, structuredClone(pi));
        return structuredClone(pi);
      },
      cancel: async (id: string, _params: unknown, opts: { idempotencyKey: string }) => {
        calls.push({ op: "cancel", id, key: opts.idempotencyKey });
        if (byKey.has(opts.idempotencyKey)) return structuredClone(byKey.get(opts.idempotencyKey)!);
        const pi = intents.get(id)!;
        if (!["requires_capture", "requires_payment_method", "requires_confirmation", "requires_action"].includes(pi.status)) throw unexpectedState();
        pi.status = "canceled";
        byKey.set(opts.idempotencyKey, structuredClone(pi));
        return structuredClone(pi);
      },
    },
  }),
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

const { finishOrder, settleOrderPayment, sweepAuthorizedOrders, StoreError } = await import("@/server/store");
const up = await reachable();

describe.skipIf(!up)("online store: authorize, then capture after the stock check", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let business: typeof schema.businesses.$inferSelect;
  let locationId: string;
  let productId: string;
  let n = 0;

  const setStock = (qty: number) =>
    withTenant(kit.A, (tx) =>
      tx.insert(schema.productStock).values({ businessId: kit.A, productId, locationId, qty }).onConflictDoUpdate({ target: [schema.productStock.productId, schema.productStock.locationId], set: { qty } }),
    );
  const stockNow = async () => (await withTenant(kit.A, (tx) => tx.select().from(schema.productStock).where(and(eq(schema.productStock.productId, productId), eq(schema.productStock.locationId, locationId)))))[0]?.qty;

  /** An order as startOrder leaves it: open online sale, one product line, a pending card payment, and its PaymentIntent in `status`. */
  async function order(qty: number, status = "requires_capture", createdAt = new Date()) {
    n++;
    const piId = `pi_${n}_${kit.A}`;
    const saleId = await withTenant(kit.A, async (tx) => {
      const [sale] = await tx
        .insert(schema.sales)
        .values({ businessId: kit.A, number: 5000 + n, locationId, currency: "usd", source: "online", subtotalCents: 2000 * qty, taxCents: 0, totalCents: 2000 * qty, createdAt, fulfillment: { method: "pickup", status: "pending" } as never })
        .returning();
      await tx.insert(schema.saleLines).values({ businessId: kit.A, saleId: sale!.id, kind: "product", productId, name: "Serum", quantity: qty, unitCents: 2000, amountCents: 2000 * qty, taxable: false, sortOrder: 0 });
      await tx.insert(schema.payments).values({ businessId: kit.A, saleId: sale!.id, method: "card", status: "pending", amountCents: 2000 * qty, tipCents: 0, stripeAccountId: "acct_test", stripePaymentIntentId: piId });
      return sale!.id;
    });
    intents.set(piId, { id: piId, status, metadata: { businessId: kit.A, saleId, kind: "order" }, latest_charge: null });
    return { saleId, piId };
  }
  const saleOf = (id: string) => withTenant(kit.A, (tx) => tx.query.sales.findFirst({ where: eq(schema.sales.id, id) }));
  const paymentOf = (saleId: string) => withTenant(kit.A, (tx) => tx.query.payments.findFirst({ where: eq(schema.payments.saleId, saleId) }));

  beforeAll(async () => {
    kit = await setupKit([]);
    await withTenant(kit.A, async (tx) => {
      business = (await tx.update(schema.businesses).set({ stripeAccountId: "acct_test", stripeChargesEnabled: true, storeEnabled: true }).where(eq(schema.businesses.id, kit.A)).returning())[0]!;
      locationId = (await tx.insert(schema.locations).values({ businessId: kit.A, name: "Main", isDefault: true }).returning())[0]!.id;
      productId = (await tx.insert(schema.products).values({ businessId: kit.A, name: "Serum", priceCents: 2000, kind: "retail", trackStock: true, sellOnline: true }).returning())[0]!.id;
    });
  });
  beforeEach(async () => {
    calls.length = 0;
    // Each case starts with no other carts holding stock.
    if (kit) await withTenant(kit.A, (tx) => tx.update(schema.sales).set({ status: "void" }).where(eq(schema.sales.status, "open")));
  });
  afterAll(async () => {
    await kit?.teardown();
  });

  it("captures and closes the sale when the stock is still there", async () => {
    await setStock(1);
    const { saleId, piId } = await order(1);
    await finishOrder(business, saleId, piId);
    expect(calls).toEqual([{ op: "capture", id: piId, key: `order_capture_${piId}` }]);
    expect((await saleOf(saleId))!.status).toBe("paid");
    const p = await paymentOf(saleId);
    expect([p!.status, p!.stripeChargeId, p!.cardLast4]).toEqual(["succeeded", `ch_${piId}`, "4242"]);
    expect(await stockNow()).toBe(0);
  });

  it("releases the authorization, voids the order and tells the buyer when it sold out meanwhile", async () => {
    await setStock(1);
    // The buyer's hold ran out (checkout started 2 hours ago) and the last one went in the meantime.
    const { saleId, piId } = await order(1, "requires_capture", new Date(Date.now() - 2 * 3_600_000));
    await setStock(0);
    const err = await finishOrder(business, saleId, piId).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(StoreError);
    expect(err.message).toMatch(/Serum just sold out.*card wasn't charged/);
    expect(calls).toEqual([{ op: "cancel", id: piId, key: `order_cancel_${piId}` }]);
    expect(intents.get(piId)!.status).toBe("canceled");
    expect((await saleOf(saleId))!.status).toBe("void");
    expect((await paymentOf(saleId))!.status).toBe("failed");
    expect(await stockNow()).toBe(0);
    // The buyer tries again: still not charged, same answer about the canceled payment.
    await expect(finishOrder(business, saleId, piId)).rejects.toThrow(/wasn't charged/);
    expect(calls.filter((c) => c.op === "capture")).toEqual([]);
  });

  it("counts other buyers' holds but not the order's own", async () => {
    await setStock(2);
    const mine = await order(1);
    await order(1, "requires_payment_method"); // someone else is mid-checkout for the other one
    await finishOrder(business, mine.saleId, mine.piId);
    expect((await saleOf(mine.saleId))!.status).toBe("paid");
    // Now one left, held by the other buyer: a third order (hold expired) can't have it.
    const late = await order(1, "requires_capture", new Date(Date.now() - 2 * 3_600_000));
    await expect(finishOrder(business, late.saleId, late.piId)).rejects.toThrow(/just sold out/);
  });

  it("captures once when the browser and the sweep settle the same order at once", async () => {
    await setStock(1);
    const { saleId, piId } = await order(1);
    await Promise.all([finishOrder(business, saleId, piId), finishOrder(business, saleId, piId)]);
    expect(calls.every((c) => c.op === "capture" && c.key === `order_capture_${piId}`)).toBe(true);
    expect((await saleOf(saleId))!.status).toBe("paid");
    expect(await stockNow()).toBe(0);
    // Already captured: closes (again, harmlessly) without calling Stripe.
    calls.length = 0;
    expect(await settleOrderPayment(business, saleId, structuredClone(intents.get(piId)!) as never, "acct_test")).toEqual({ status: "paid" });
    expect(calls).toEqual([]);
    expect(await stockNow()).toBe(0);
  });

  it("records the sale when the cancel loses to a capture that already happened", async () => {
    await setStock(0);
    const { saleId, piId } = await order(1);
    const stale = structuredClone(intents.get(piId)!);
    intents.get(piId)!.status = "succeeded"; // captured elsewhere after we read it
    expect(await settleOrderPayment(business, saleId, stale as never, "acct_test")).toEqual({ status: "paid" });
    expect(calls.map((c) => c.op)).toEqual(["cancel"]);
    expect((await saleOf(saleId))!.status).toBe("paid");
  });

  it("voids when the capture finds the authorization already canceled", async () => {
    await setStock(1);
    const { saleId, piId } = await order(1);
    const stale = structuredClone(intents.get(piId)!);
    intents.get(piId)!.status = "canceled"; // released elsewhere (or expired) after we read it
    const out = await settleOrderPayment(business, saleId, stale as never, "acct_test");
    expect(out.status).toBe("released");
    expect(calls.map((c) => c.op)).toEqual(["capture"]);
    expect((await saleOf(saleId))!.status).toBe("void");
    expect(await stockNow()).toBe(1);
  });

  it("the sweep captures orders whose page closed, releases sold-out ones and closes out abandoned checkouts", async () => {
    await withTenant(kit.A, (tx) => tx.update(schema.sales).set({ status: "void" }).where(eq(schema.sales.status, "open")));
    // Three on the shelf, three buyers holding one each (closedPage, stillPaying, fresh). soldOut's hold ran out long ago.
    await setStock(3);
    const old = new Date(Date.now() - 20 * 60_000);
    const abandoned = await order(1, "requires_payment_method", new Date(Date.now() - 25 * 3_600_000));
    const soldOut = await order(1, "requires_capture", new Date(Date.now() - 2 * 3_600_000));
    const closedPage = await order(1, "requires_capture", old);
    const stillPaying = await order(1, "requires_payment_method", old);
    const fresh = await order(1, "requires_capture"); // the browser is about to finish this one itself
    const r = await sweepAuthorizedOrders({ businessIds: [kit.A] });
    expect(r).toMatchObject({ captured: 1, released: 1, abandoned: 1, failed: 0 });
    expect((await saleOf(closedPage.saleId))!.status).toBe("paid");
    expect((await saleOf(soldOut.saleId))!.status).toBe("void");
    expect(intents.get(soldOut.piId)!.status).toBe("canceled");
    expect((await saleOf(abandoned.saleId))!.status).toBe("void");
    expect(intents.get(abandoned.piId)!.status).toBe("canceled");
    expect((await saleOf(stillPaying.saleId))!.status).toBe("open");
    expect(intents.get(fresh.piId)!.status).toBe("requires_capture");
    expect(await stockNow()).toBe(2);
  });
});
