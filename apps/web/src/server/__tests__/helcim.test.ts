// Helcim as the card processor, against a fake Helcim API (fetch is replaced): terminal sale, webhook and poll settle, card form hash,
// saved-card charge, refunds, and the webhook signature. Nothing here talks to Helcim.
import "../../../../../packages/db/src/env";
import { createHash, createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
// Order emails go out in `after`, which needs a request scope.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { addProductLine, chargeHelcimSavedCard, getSale, openWalkInSale, refundPayment } from "@/server/sales";
import { checkHelcimTerminalPayment, finishHelcimDeskCheckout, handleHelcimCardTransaction, handleHelcimTerminalCancel, startHelcimDeskCheckout, startHelcimTerminalPayment } from "@/server/helcim/payments";
import { verifyCheckoutHash, verifyWebhookSignature } from "@/server/helcim/client";
import { helcimTokenOf } from "@/server/helcim/account";
import { encryptSecret } from "@/lib/secrets";
import { openHelcimCheckout, sweepHelcimCheckouts, verifyHelcimCheckout } from "@/server/helcim/online";
import { finishOrder, startOrder } from "@/server/store";
import { refundDeposit } from "@/server/online-payments";
import { renewHelcimMemberships } from "@/server/membership-billing";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

const up = await reachable();
const TOKEN = "helcim-test-token-1234567890";

type Call = { method: string; path: string; body: Record<string, unknown> | null; headers: Record<string, string> };
const calls: Call[] = [];
let transactions: Record<string, unknown>[] = [];
let nextId = 9000;
const realFetch = globalThis.fetch;

function fakeHelcim(handlers: Partial<Record<string, (c: Call) => unknown>> = {}) {
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const c: Call = { method: init?.method ?? "GET", path: u.pathname.replace(/^\/v2/, "") + u.search, body: init?.body ? JSON.parse(String(init.body)) : null, headers: (init?.headers ?? {}) as Record<string, string> };
    calls.push(c);
    const key = `${c.method} ${c.path.split("?")[0]!.replace(/\/[A-Z0-9]{4}\//, "/{code}/").replace(/\/\d+$/, "/{id}").replace(/\/customers\/\d+\/cards/, "/customers/{id}/cards")}`;
    const h = handlers[key];
    const out = h ? h(c) : defaults(c, key);
    return new Response(out === undefined ? "" : JSON.stringify(out), { status: out === undefined ? 202 : 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

function defaults(c: Call, key: string): unknown {
  if (key === "POST /devices/{code}/payment/purchase") return undefined;
  if (key === "POST /customers") return { id: 77, customerCode: (c.body as { customerCode: string }).customerCode };
  if (key === "GET /card-transactions/{id}") return transactions.find((t) => String(t.transactionId) === c.path.split("/").pop()) ?? { errors: ["not found"] };
  if (key === "GET /card-transactions") return transactions.filter((t) => c.path.includes(`invoiceNumber=${t.invoiceNumber}`));
  if (key === "POST /helcim-pay/initialize") return { checkoutToken: "chk_123", secretToken: "sec_456" };
  if (key === "POST /payment/purchase") {
    const t = { transactionId: nextId++, status: "APPROVED", type: "purchase", amount: (c.body as { amount: number }).amount, cardType: "VI", cardNumber: "4242424242", invoiceNumber: (c.body as { invoiceNumber?: string }).invoiceNumber };
    transactions.push(t);
    return t;
  }
  if (key === "POST /payment/refund") return { transactionId: nextId++, status: "APPROVED", type: "refund", amount: (c.body as { amount: number }).amount };
  if (key === "POST /payment/capture") return { transactionId: nextId++, status: "APPROVED", type: "purchase", amount: (c.body as { amount: number }).amount, cardType: "VI", cardNumber: "4242424242" };
  if (key === "POST /payment/reverse") return { transactionId: nextId++, status: "APPROVED", type: "reverse", amount: 0 };
  return { errors: [`unexpected ${key}`] };
}

describe.skipIf(!up)("Helcim as the card processor", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let userId: string;
  let productId: string;
  let deviceId: string;
  let clientId: string;
  beforeAll(async () => {
    kit = await setupKit([]);
    userId = `u_${kit.A}`;
    await db.insert(schema.user).values({ id: userId, name: "Tester", email: `${userId}@example.test`, emailVerified: true });
    await db.update(schema.businesses).set({ paymentProvider: "helcim", helcimApiToken: encryptSecret(TOKEN), helcimWebhookVerifier: encryptSecret(Buffer.from("verifier-secret").toString("base64")) }).where(eq(schema.businesses.id, kit.A));
    await withTenant(kit.A, async (tx) => {
      await tx.insert(schema.locations).values({ businessId: kit.A, name: "Main", isDefault: true });
      const [p] = await tx.insert(schema.products).values({ businessId: kit.A, name: "Serum", priceCents: 10_000, taxable: false, kind: "retail" }).returning({ id: schema.products.id });
      productId = p!.id;
      const [dv] = await tx.insert(schema.helcimDevices).values({ businessId: kit.A, code: "AB12", name: "Front desk" }).returning({ id: schema.helcimDevices.id });
      deviceId = dv!.id;
      const [cl] = await tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Pat", lastName: "Lee" }).returning({ id: schema.clients.id });
      clientId = cl!.id;
    });
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    calls.length = 0;
    transactions = [];
  });
  afterAll(async () => {
    await kit?.teardown();
    if (userId) await db.delete(schema.user).where(eq(schema.user.id, userId));
  });

  const ticket = async (withClient = false) => {
    const saleId = await openWalkInSale({ businessId: kit.A, actorUserId: userId, currency: "usd", clientId: withClient ? clientId : null });
    await addProductLine({ businessId: kit.A, saleId, productId, quantity: 1, staffId: null, actorUserId: userId, taxRateBps: 0 });
    return saleId;
  };

  it("decrypts the business's token only when Helcim is its processor", async () => {
    const b = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }))!;
    expect(helcimTokenOf(b)).toBe(TOKEN);
    expect(helcimTokenOf({ ...b, paymentProvider: "stripe" })).toBeNull();
  });

  it("sends a sale to the terminal and settles it from the webhook, once", async () => {
    fakeHelcim();
    const saleId = await ticket(true);
    const { paymentId, invoice } = await startHelcimTerminalPayment({ businessId: kit.A, token: TOKEN, saleId, deviceId, amountCents: 10_000, actorUserId: userId });
    const push = calls.find((c) => c.path === "/devices/AB12/payment/purchase")!;
    expect(push.body).toMatchObject({ transactionAmount: 100, currency: "USD", invoiceNumber: invoice, customerCode: clientId });
    expect(push.headers["api-token"]).toBe(TOKEN);
    expect(String(push.headers["idempotency-key"]).length).toBeGreaterThanOrEqual(25);
    let d = (await getSale(kit.A, saleId))!;
    expect(d.payments.map((p) => [p.method, p.status, p.provider])).toEqual([["terminal", "pending", "helcim"]]);
    // The client taps; Helcim's webhook reports the transaction by id.
    transactions.push({ transactionId: 5001, status: "APPROVED", type: "purchase", amount: 100, cardType: "MC", cardNumber: "5454545454", invoiceNumber: invoice });
    expect(await handleHelcimCardTransaction({ businessId: kit.A, token: TOKEN, transactionId: "5001", taxRateBps: 0 })).toBe("paid");
    expect(await handleHelcimCardTransaction({ businessId: kit.A, token: TOKEN, transactionId: "5001", taxRateBps: 0 })).toBe("already");
    d = (await getSale(kit.A, saleId))!;
    expect(d.sale.status).toBe("paid");
    expect(d.payments[0]).toMatchObject({ id: paymentId, status: "succeeded", providerPaymentId: "5001", cardBrand: "mastercard", cardLast4: "5454" });
  });

  it("settles a terminal sale by polling when the webhook is late, and a cancel on the terminal fails it", async () => {
    fakeHelcim();
    const a = await ticket();
    const first = await startHelcimTerminalPayment({ businessId: kit.A, token: TOKEN, saleId: a, deviceId, amountCents: 10_000, actorUserId: userId });
    expect(await checkHelcimTerminalPayment({ businessId: kit.A, token: TOKEN, paymentId: first.paymentId, taxRateBps: 0 })).toBe("pending");
    transactions.push({ transactionId: 5002, status: "APPROVED", type: "purchase", amount: 100, cardType: "VI", cardNumber: "4242424242", invoiceNumber: first.invoice });
    expect(await checkHelcimTerminalPayment({ businessId: kit.A, token: TOKEN, paymentId: first.paymentId, taxRateBps: 0 })).toBe("paid");
    const b = await ticket();
    const second = await startHelcimTerminalPayment({ businessId: kit.A, token: TOKEN, saleId: b, deviceId, amountCents: 10_000, actorUserId: userId });
    expect(await handleHelcimTerminalCancel(kit.A, second.invoice)).toBe("cancelled");
    expect(await checkHelcimTerminalPayment({ businessId: kit.A, token: TOKEN, paymentId: second.paymentId, taxRateBps: 0 })).toBe("cancelled");
    expect((await getSale(kit.A, b))!.sale.status).toBe("open");
  });

  it("drops the pending row when the terminal can't be reached", async () => {
    fakeHelcim({ "POST /devices/{code}/payment/purchase": () => ({ errors: ["Device Not Listening"] }) });
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ errors: ["Device Not Listening"] }), { status: 409 })) as typeof fetch;
    const saleId = await ticket();
    await expect(startHelcimTerminalPayment({ businessId: kit.A, token: TOKEN, saleId, deviceId, amountCents: 10_000, actorUserId: userId })).rejects.toThrow(/isn't ready/);
    expect((await getSale(kit.A, saleId))!.payments).toEqual([]);
  });

  it("accepts a card-form result only when its hash checks out, then confirms it with Helcim", async () => {
    fakeHelcim();
    const saleId = await ticket();
    const { paymentId, checkoutToken } = await startHelcimDeskCheckout({ businessId: kit.A, token: TOKEN, saleId, amountCents: 10_000, saveCard: false, actorUserId: userId, brandColor: "#0f766e" });
    expect(checkoutToken).toBe("chk_123");
    expect(calls.find((c) => c.path === "/helcim-pay/initialize")!.body).toMatchObject({ paymentType: "purchase", amount: 100, currency: "USD", customStyling: { brandColor: "0f766e" } });
    const data = { transactionId: 5003, status: "APPROVED", amount: "100.00", cardNumber: "4111111111", cardType: "VI" };
    transactions.push({ ...data, type: "purchase", amount: 100 });
    await expect(finishHelcimDeskCheckout({ businessId: kit.A, token: TOKEN, paymentId, eventMessage: { data, hash: "forged" }, taxRateBps: 0 })).rejects.toThrow(/didn't verify/);
    const hash = createHash("sha256").update(JSON.stringify(data) + "sec_456").digest("hex");
    expect(await finishHelcimDeskCheckout({ businessId: kit.A, token: TOKEN, paymentId, eventMessage: JSON.stringify({ data, hash }), taxRateBps: 0 })).toBe("paid");
    const p = (await getSale(kit.A, saleId))!.payments[0]!;
    expect(p).toMatchObject({ status: "succeeded", providerPaymentId: "5003", cardLast4: "1111", providerSession: null });
  });

  it("charges a saved card and refunds part of it through Helcim", async () => {
    fakeHelcim();
    const saleId = await ticket(true);
    expect(await chargeHelcimSavedCard({ businessId: kit.A, saleId, token: TOKEN, cardToken: "tok_card", customerCode: clientId, amountCents: 10_000, actorUserId: userId, taxRateBps: 0, ipAddress: "203.0.113.5" })).toBe("paid");
    const purchase = calls.find((c) => c.path === "/payment/purchase")!;
    expect(purchase.body).toMatchObject({ amount: 100, cardData: { cardToken: "tok_card" }, customerCode: clientId, ipAddress: "203.0.113.5" });
    let p = (await getSale(kit.A, saleId))!.payments[0]!;
    expect([p.method, p.status]).toEqual(["card_on_file", "succeeded"]);
    await refundPayment({ businessId: kit.A, accountId: null, paymentId: p.id, amountCents: 2500, reason: null, actorUserId: userId, taxRateBps: 0, helcimToken: TOKEN, ipAddress: "203.0.113.5" });
    expect(calls.find((c) => c.path === "/payment/refund")!.body).toMatchObject({ originalTransactionId: Number(p.providerPaymentId), amount: 25 });
    const d = (await getSale(kit.A, saleId))!;
    p = d.payments[0]!;
    expect([p.refundedCents, p.status]).toEqual([2500, "partially_refunded"]);
    expect(d.refunds[0]!.providerRefundId).toBeTruthy();
  });

  const business = async () => (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }))!;
  /** What HelcimPay.js hands the browser after a checkout, signed with that checkout's secret. */
  const paid = (transactionId: number, extra: Record<string, unknown> = {}) => {
    const data = { transactionId, status: "APPROVED", ...extra };
    return { data, hash: createHash("sha256").update(JSON.stringify(data) + "sec_456").digest("hex") };
  };

  it("verifies an online deposit once, and refunds a paid checkout nobody booked with after 20 minutes", async () => {
    fakeHelcim();
    const b = await business();
    const client = { id: clientId, firstName: "Pat", lastName: "Lee", phone: null };
    const c = await openHelcimCheckout(b, { purpose: "deposit", meta: { businessId: kit.A, clientId }, amountCents: 5000, client });
    expect(calls.find((x) => x.path === "/helcim-pay/initialize")!.body).toMatchObject({ paymentType: "purchase", amount: 50, customerCode: clientId });
    transactions.push({ transactionId: 6001, status: "APPROVED", type: "purchase", amount: 50, cardType: "VI", cardNumber: "4242424242" });
    await expect(verifyHelcimCheckout(b, c.id, { data: { transactionId: 6001 }, hash: "nope" })).rejects.toThrow(/couldn't be verified/);
    const row = await verifyHelcimCheckout(b, c.id, paid(6001));
    expect([row.status, row.transactionId, row.cardLabel]).toEqual(["paid", "6001", "VISA •••• 4242"]);
    expect((await verifyHelcimCheckout(b, c.id, null)).status).toBe("paid"); // a refresh gets the verified checkout
    // Twenty minutes later and no booking holds it: refunded.
    await withTenant(kit.A, (tx) => tx.update(schema.helcimCheckouts).set({ paidAt: new Date(Date.now() - 25 * 60_000) }).where(eq(schema.helcimCheckouts.id, c.id)));
    const swept = await sweepHelcimCheckouts();
    expect(swept.refunded).toBeGreaterThanOrEqual(1);
    expect(calls.find((x) => x.path === "/payment/refund")!.body).toMatchObject({ originalTransactionId: 6001, amount: 50 });
    expect((await withTenant(kit.A, (tx) => tx.query.helcimCheckouts.findFirst({ where: eq(schema.helcimCheckouts.id, c.id) })))!.status).toBe("refunded");
  });

  it("refunds part of a Helcim deposit still on its appointment", async () => {
    fakeHelcim();
    const [appt] = await withTenant(kit.A, (tx) => tx.insert(schema.appointments).values({ businessId: kit.A, clientId, depositCents: 5000, depositStatus: "paid", depositPaymentIntentId: "chk_x", depositProvider: "helcim", depositProviderPaymentId: "6100" }).returning());
    expect(await refundDeposit({ businessId: kit.A, accountId: null, appointmentId: appt!.id, actorUserId: userId, reason: "test", amountCents: 2000, as: "original" })).toBe(true);
    expect(calls.find((x) => x.path === "/payment/refund")!.body).toMatchObject({ originalTransactionId: 6100, amount: 20 });
    const after = (await withTenant(kit.A, (tx) => tx.query.appointments.findFirst({ where: eq(schema.appointments.id, appt!.id) })))!;
    expect([after.depositStatus, after.depositCents]).toEqual(["paid", 3000]);
  });

  it("authorises a store order, captures it when the stock is there, and releases it when it sold out", async () => {
    fakeHelcim();
    await db.update(schema.businesses).set({ storeEnabled: true }).where(eq(schema.businesses.id, kit.A));
    await withTenant(kit.A, (tx) => tx.update(schema.products).set({ sellOnline: true }).where(eq(schema.products.id, productId)));
    const b = await business();
    const order = { items: [{ productId, quantity: 1 }], giftCard: null, buyer: { firstName: "Pat", lastName: "Lee", email: "pat@example.test", phone: null }, fulfillment: { method: "pickup" as const, address: null } };
    const r = await startOrder(b, order);
    expect(r.provider).toBe("helcim");
    expect(calls.find((x) => x.path === "/helcim-pay/initialize")!.body).toMatchObject({ paymentType: "preauth", amount: 100 });
    transactions.push({ transactionId: 7001, status: "APPROVED", type: "preauth", amount: 100, cardType: "VI", cardNumber: "4242424242" });
    await finishOrder(b, r.saleId, r.checkoutId!, paid(7001));
    expect(calls.find((x) => x.path === "/payment/capture")!.body).toMatchObject({ preAuthTransactionId: 7001, amount: 100 });
    expect((await getSale(kit.A, r.saleId))!.sale.status).toBe("paid");
    // Second order: the product is tracked with nothing left by the time the card is authorised.
    const r2 = await startOrder(b, order);
    await withTenant(kit.A, (tx) => tx.update(schema.products).set({ trackStock: true }).where(eq(schema.products.id, productId)));
    transactions.push({ transactionId: 7002, status: "APPROVED", type: "preauth", amount: 100, cardType: "VI", cardNumber: "4242424242" });
    await expect(finishOrder(b, r2.saleId, r2.checkoutId!, paid(7002))).rejects.toThrow(/sold out|left/);
    expect(calls.find((x) => x.path === "/payment/reverse")!.body).toMatchObject({ cardTransactionId: 7002 });
    expect((await getSale(kit.A, r2.saleId))!.sale.status).toBe("void");
    await withTenant(kit.A, (tx) => tx.update(schema.products).set({ trackStock: false }).where(eq(schema.products.id, productId)));
  });

  it("renews a Helcim membership from the app when its period ends, once", async () => {
    fakeHelcim();
    await withTenant(kit.A, (tx) => tx.insert(schema.clientHelcimCustomers).values({ businessId: kit.A, clientId, helcimCustomerId: 77, customerCode: clientId }).onConflictDoNothing());
    const [plan] = await withTenant(kit.A, (tx) => tx.insert(schema.membershipPlans).values({ businessId: kit.A, name: "Glow club", priceCents: 4900, includedSessions: 1 }).returning());
    const [m] = await withTenant(kit.A, (tx) => tx.insert(schema.clientMemberships).values({ businessId: kit.A, clientId, planId: plan!.id, currentPeriodEnd: new Date(Date.now() - 3_600_000), autoRenew: true, helcimCardToken: "tok_card" }).returning());
    const r = await renewHelcimMemberships();
    expect(r.renewed).toBeGreaterThanOrEqual(1);
    expect(calls.filter((x) => x.path === "/payment/purchase").map((x) => x.body)).toEqual([expect.objectContaining({ amount: 49, cardData: { cardToken: "tok_card" } })]);
    const after = (await withTenant(kit.A, (tx) => tx.query.clientMemberships.findFirst({ where: eq(schema.clientMemberships.id, m!.id) })))!;
    expect(after.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());
    expect(after.cyclesBilled).toBe(2);
    calls.length = 0;
    await renewHelcimMemberships();
    expect(calls.filter((x) => x.path === "/payment/purchase")).toEqual([]);
  });

  it("checks webhook signatures with the verifier token", () => {
    const verifier = Buffer.from("verifier-secret").toString("base64");
    const body = JSON.stringify({ id: "1", type: "cardTransaction" });
    const sig = createHmac("sha256", Buffer.from(verifier, "base64")).update(`msg_1.1700000000.${body}`).digest("base64");
    expect(verifyWebhookSignature({ id: "msg_1", timestamp: "1700000000", signature: `v1,${sig}` }, body, verifier)).toBe(true);
    expect(verifyWebhookSignature({ id: "msg_1", timestamp: "1700000000", signature: `v1,${sig}` }, body + " ", verifier)).toBe(false);
    expect(verifyCheckoutHash({ a: "é" }, createHash("sha256").update('{"a":"\\u00e9"}s').digest("hex"), "s")).toBe(true);
  });
});
