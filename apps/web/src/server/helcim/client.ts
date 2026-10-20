import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Helcim API v2 (https://devdocs.helcim.com), the calls the app makes. Every request carries the merchant's api-token, and the
 * partner-token when HELCIM_PARTNER_TOKEN is set (Integration Partner Program revenue share is credited per request and can't be
 * reconciled afterwards). Payment calls carry an idempotency key, so a retry is one charge.
 */
const BASE = process.env.HELCIM_API_URL ?? "https://api.helcim.com/v2";

export class HelcimError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export type HelcimTransaction = {
  transactionId: number;
  dateCreated?: string;
  status: "APPROVED" | "DECLINED" | string;
  type: "purchase" | "preauth" | "verify" | "refund" | string;
  amount: number;
  currency?: string;
  cardType?: string | null;
  cardNumber?: string | null; // first 6 + last 4
  cardToken?: string | null;
  customerCode?: string | null;
  invoiceNumber?: string | null;
  approvalCode?: string | null;
};

export type HelcimCard = { id: number; cardToken: string; cardF6L4: string; cardExpiry?: string | null; cardHolderName?: string | null };

async function call<T>(token: string, method: "GET" | "POST" | "DELETE", path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json", "api-token": token };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  if (process.env.HELCIM_PARTNER_TOKEN) headers["partner-token"] = process.env.HELCIM_PARTNER_TOKEN;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const errors = (data as { errors?: unknown } | null)?.errors;
    const msg = Array.isArray(errors) ? errors.join("; ") : typeof errors === "object" && errors ? Object.values(errors as Record<string, string>).join("; ") : `Helcim answered ${res.status}`;
    throw new HelcimError(msg, res.status);
  }
  return data as T;
}

/** Idempotency keys must be 25–36 characters: derive one from our own id so a retry of the same step is the same request. */
export const idemKey = (scope: string, id: string) => createHash("sha256").update(`${scope}:${id}`).digest("hex").slice(0, 32);

const dollars = (cents: number) => Math.round(cents) / 100;

export const helcim = {
  /** A cheap authenticated call, to check a pasted token works. */
  ping: (token: string) => call<unknown>(token, "GET", "/connection-test"),

  // --- Smart Terminal (Payment Hardware API) ---
  listDevices: (token: string) => call<{ code: string; dateCreated?: string }[]>(token, "GET", "/devices"),
  /** Shows a message on the terminal's screen: proves the code is right and the device is listening. */
  pingDevice: (token: string, code: string) => call<unknown>(token, "GET", `/devices/${encodeURIComponent(code)}/ping`),
  /** Push a purchase to a terminal. Helcim answers 202; the result arrives by webhook (cardTransaction / terminalCancel). */
  terminalPurchase: (token: string, code: string, p: { amountCents: number; currency: string; invoiceNumber: string; customerCode?: string | null }) =>
    call<unknown>(token, "POST", `/devices/${encodeURIComponent(code)}/payment/purchase`, { transactionAmount: dollars(p.amountCents), currency: p.currency.toUpperCase(), invoiceNumber: p.invoiceNumber, ...(p.customerCode ? { customerCode: p.customerCode } : {}) }, idemKey("terminal", p.invoiceNumber)),

  // --- Transactions ---
  getTransaction: (token: string, id: number | string) => call<HelcimTransaction>(token, "GET", `/card-transactions/${encodeURIComponent(String(id))}`),
  /** Recent transactions for an invoice number (the fallback when a terminal's webhook is late). */
  findByInvoice: (token: string, invoiceNumber: string) => call<HelcimTransaction[]>(token, "GET", `/card-transactions?invoiceNumber=${encodeURIComponent(invoiceNumber)}`),
  /** Charge a saved card (no-show fee, card on file, late tip). */
  purchaseWithToken: (token: string, p: { key: string; amountCents: number; currency: string; cardToken: string; customerCode: string; ipAddress: string; invoiceNumber?: string }) =>
    call<HelcimTransaction>(token, "POST", "/payment/purchase", { ipAddress: p.ipAddress, ecommerce: false, currency: p.currency.toUpperCase(), amount: dollars(p.amountCents), customerCode: p.customerCode, cardData: { cardToken: p.cardToken }, ...(p.invoiceNumber ? { invoiceNumber: p.invoiceNumber } : {}) }, idemKey("purchase", p.key)),
  capture: (token: string, p: { key: string; preAuthTransactionId: number; amountCents: number; ipAddress: string }) =>
    call<HelcimTransaction>(token, "POST", "/payment/capture", { preAuthTransactionId: p.preAuthTransactionId, amount: dollars(p.amountCents), ipAddress: p.ipAddress, ecommerce: true }, idemKey("capture", p.key)),
  /** Undo a transaction that hasn't settled (a preauth that won't be captured, an order that can't be filled). */
  reverse: (token: string, p: { key: string; transactionId: number; ipAddress: string }) =>
    call<HelcimTransaction>(token, "POST", "/payment/reverse", { cardTransactionId: p.transactionId, ipAddress: p.ipAddress }, idemKey("reverse", p.key)),
  refund: (token: string, p: { key: string; transactionId: number; amountCents: number; ipAddress: string }) =>
    call<HelcimTransaction>(token, "POST", "/payment/refund", { originalTransactionId: p.transactionId, amount: dollars(p.amountCents), ipAddress: p.ipAddress }, idemKey("refund", p.key)),

  // --- HelcimPay.js ---
  initializeCheckout: (token: string, p: { paymentType: "purchase" | "preauth" | "verify"; amountCents: number; currency: string; customerCode?: string | null; brandColor?: string | null }) =>
    call<{ checkoutToken: string; secretToken: string }>(token, "POST", "/helcim-pay/initialize", {
      paymentType: p.paymentType,
      amount: dollars(p.amountCents),
      currency: p.currency.toUpperCase(),
      paymentMethod: "cc",
      ...(p.customerCode ? { customerCode: p.customerCode } : {}),
      ...(p.brandColor ? { customStyling: { brandColor: p.brandColor.replace("#", "") } } : {}),
    }),

  // --- Customers and saved cards ---
  createCustomer: (token: string, p: { customerCode: string; contactName: string; cellPhone?: string | null }) =>
    call<{ id: number; customerCode: string }>(token, "POST", "/customers", { customerCode: p.customerCode, contactName: p.contactName, ...(p.cellPhone ? { cellPhone: p.cellPhone.replace(/\D/g, "").slice(-15) } : {}) }),
  customerCards: (token: string, customerId: number) => call<HelcimCard[]>(token, "GET", `/customers/${customerId}/cards`),
  deleteCard: (token: string, customerId: number, cardId: number) => call<unknown>(token, "DELETE", `/customers/${customerId}/cards/${cardId}`),
};

/**
 * HelcimPay.js: the browser hands back the transaction data and a hash; it is genuine when sha256(JSON of the data + secretToken)
 * matches. Helcim hashes compact JSON with non-ASCII characters escaped (\uXXXX), the way PHP's json_encode writes it.
 */
export function verifyCheckoutHash(data: unknown, hash: string, secretToken: string): boolean {
  const json = JSON.stringify(data).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).replace(/\//g, "\\/");
  const plain = JSON.stringify(data);
  const ok = (s: string) => {
    const mine = createHash("sha256").update(s + secretToken).digest("hex");
    return mine.length === hash.length && timingSafeEqual(Buffer.from(mine), Buffer.from(hash));
  };
  return ok(json) || ok(plain);
}

/** Webhook signature: HMAC-SHA256 over "id.timestamp.body" keyed with the base64-decoded verifier token; the header may hold several "v1,<sig>". */
export function verifyWebhookSignature(h: { id: string | null; timestamp: string | null; signature: string | null }, body: string, verifierToken: string): boolean {
  if (!h.id || !h.timestamp || !h.signature) return false;
  const expected = createHmac("sha256", Buffer.from(verifierToken, "base64")).update(`${h.id}.${h.timestamp}.${body}`).digest("base64");
  return h.signature.split(" ").some((part) => {
    const sig = part.includes(",") ? part.split(",")[1]! : part;
    return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  });
}

export const newInvoiceNumber = () => `AB-${randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;

/** "4242" from Helcim's first-6/last-4 card number. */
export const last4Of = (cardNumber: string | null | undefined) => (cardNumber ? cardNumber.replace(/\D/g, "").slice(-4) || null : null);

/** Helcim's card type codes as the brand names the app shows. */
export function brandOf(cardType: string | null | undefined): string | null {
  if (!cardType) return null;
  const t = cardType.toUpperCase();
  return ({ VI: "visa", VISA: "visa", MC: "mastercard", MASTERCARD: "mastercard", AX: "amex", AMEX: "amex", DI: "discover", DISCOVER: "discover" } as Record<string, string>)[t] ?? cardType.toLowerCase();
}
