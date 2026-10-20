// Helcim as the card processor, against a fake Helcim API (fetch is replaced): terminal sale, webhook and poll settle, card form hash,
// saved-card charge, refunds, and the webhook signature. Nothing here talks to Helcim.
import "../../../../../packages/db/src/env";
import { createHash, createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { addProductLine, chargeHelcimSavedCard, getSale, openWalkInSale, refundPayment } from "@/server/sales";
import { checkHelcimTerminalPayment, finishHelcimDeskCheckout, handleHelcimCardTransaction, handleHelcimTerminalCancel, startHelcimDeskCheckout, startHelcimTerminalPayment } from "@/server/helcim/payments";
import { verifyCheckoutHash, verifyWebhookSignature } from "@/server/helcim/client";
import { helcimTokenOf } from "@/server/helcim/account";
import { encryptSecret } from "@/lib/secrets";
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

  it("checks webhook signatures with the verifier token", () => {
    const verifier = Buffer.from("verifier-secret").toString("base64");
    const body = JSON.stringify({ id: "1", type: "cardTransaction" });
    const sig = createHmac("sha256", Buffer.from(verifier, "base64")).update(`msg_1.1700000000.${body}`).digest("base64");
    expect(verifyWebhookSignature({ id: "msg_1", timestamp: "1700000000", signature: `v1,${sig}` }, body, verifier)).toBe(true);
    expect(verifyWebhookSignature({ id: "msg_1", timestamp: "1700000000", signature: `v1,${sig}` }, body + " ", verifier)).toBe(false);
    expect(verifyCheckoutHash({ a: "é" }, createHash("sha256").update('{"a":"\\u00e9"}s').digest("hex"), "s")).toBe(true);
  });
});
