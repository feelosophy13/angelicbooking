import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { SaleError, discardHelcimPayment, openHelcimPayment, pendingHelcimPaymentByInvoice, settleHelcimPayment } from "../sales";
import { helcim, last4Of, newInvoiceNumber, verifyCheckoutHash, type HelcimTransaction } from "./client";

type Client = typeof schema.clients.$inferSelect;

export type HelcimSavedCard = { id: string; brand: string; last4: string; expMonth: number; expYear: number };

/** The client's Helcim customer, created on first use (customer code = our client id, so it is stable and unique per business). */
export async function ensureHelcimCustomer(businessId: string, token: string, client: Pick<Client, "id" | "firstName" | "lastName" | "phone">) {
  const known = await withTenant(businessId, (tx) => tx.query.clientHelcimCustomers.findFirst({ where: eq(schema.clientHelcimCustomers.clientId, client.id) }));
  if (known) return { id: known.helcimCustomerId, code: known.customerCode };
  const created = await helcim.createCustomer(token, { customerCode: client.id, contactName: `${client.firstName} ${client.lastName ?? ""}`.trim() || "Client", cellPhone: client.phone });
  await withTenant(businessId, (tx) => tx.insert(schema.clientHelcimCustomers).values({ businessId, clientId: client.id, helcimCustomerId: created.id, customerCode: created.customerCode }).onConflictDoNothing());
  return { id: created.id, code: created.customerCode };
}

/** The client's saved Helcim cards, shaped like the Stripe list the checkout screen uses (id = Helcim's card token). */
export async function savedHelcimCards(businessId: string, token: string | null, clientId: string | null | undefined): Promise<HelcimSavedCard[]> {
  if (!token || !clientId) return [];
  const known = await withTenant(businessId, (tx) => tx.query.clientHelcimCustomers.findFirst({ where: eq(schema.clientHelcimCustomers.clientId, clientId) }));
  if (!known) return [];
  const cards = await helcim.customerCards(token, known.helcimCustomerId).catch(() => []);
  return cards.map((c) => ({ id: c.cardToken, brand: "card", last4: last4Of(c.cardF6L4) ?? "????", expMonth: Number(c.cardExpiry?.slice(0, 2) ?? 0), expYear: 2000 + Number(c.cardExpiry?.slice(2, 4) ?? 0) }));
}

export async function customerCodeFor(businessId: string, clientId: string): Promise<{ id: number; code: string } | null> {
  const known = await withTenant(businessId, (tx) => tx.query.clientHelcimCustomers.findFirst({ where: eq(schema.clientHelcimCustomers.clientId, clientId) }));
  return known ? { id: known.helcimCustomerId, code: known.customerCode } : null;
}

// --- Smart Terminal ---------------------------------------------------------

export async function listHelcimDevices(businessId: string, locationId?: string | null) {
  const all = await withTenant(businessId, (tx) => tx.select().from(schema.helcimDevices).orderBy(schema.helcimDevices.name));
  return locationId ? all.filter((d) => !d.locationId || d.locationId === locationId) : all;
}

/**
 * Send the amount to a paired Smart Terminal. The pending row carries a fresh invoice number; Helcim pushes the purchase to the terminal,
 * the client taps or dips, and the result comes back by webhook (or the checkout screen's poll) under that invoice number.
 */
export async function startHelcimTerminalPayment(input: { businessId: string; token: string; saleId: string; deviceId: string; amountCents: number; actorUserId: string }) {
  const device = await withTenant(input.businessId, (tx) => tx.query.helcimDevices.findFirst({ where: eq(schema.helcimDevices.id, input.deviceId) }));
  if (!device) throw new SaleError("That terminal isn't paired any more. Pick another under Settings → Payments.");
  const invoice = newInvoiceNumber();
  const { sale, client, amount, paymentId } = await openHelcimPayment({ businessId: input.businessId, saleId: input.saleId, amountCents: input.amountCents, method: "terminal", actorUserId: input.actorUserId, invoice });
  try {
    const customer = client ? await ensureHelcimCustomer(input.businessId, input.token, client).catch(() => null) : null;
    await helcim.terminalPurchase(input.token, device.code, { amountCents: amount, currency: sale.currency, invoiceNumber: invoice, customerCode: customer?.code });
  } catch (e) {
    await discardHelcimPayment(input.businessId, paymentId);
    const msg = (e as Error).message;
    throw new SaleError(/listening|409/i.test(msg) ? `${device.name} isn't ready. Make sure it shows "Ready to take payment" and is online, then try again.` : `Couldn't reach the terminal: ${msg}`);
  }
  return { paymentId, amount, invoice };
}

/** Where a terminal payment stands: the webhook usually settles it; when it is late, ask Helcim for the invoice's transactions. */
export async function checkHelcimTerminalPayment(input: { businessId: string; token: string; paymentId: string; taxRateBps: number }): Promise<"pending" | "paid" | "declined" | "cancelled"> {
  const p = await withTenant(input.businessId, (tx) => tx.query.payments.findFirst({ where: and(eq(schema.payments.id, input.paymentId), eq(schema.payments.provider, "helcim")) }));
  if (!p) return "cancelled";
  if (p.status === "succeeded" || p.status === "partially_refunded" || p.status === "refunded") return "paid";
  if (p.status === "failed") return p.note?.startsWith("Cancelled") ? "cancelled" : "declined";
  if (!p.providerInvoice) return "pending";
  const found = await helcim.findByInvoice(input.token, p.providerInvoice).catch(() => [] as HelcimTransaction[]);
  const t = Array.isArray(found) ? found.find((x) => x.type === "purchase") : undefined;
  if (!t) return "pending";
  const outcome = await settleHelcimPayment({ businessId: input.businessId, paymentId: p.id, transaction: t, taxRateBps: input.taxRateBps });
  return outcome === "declined" ? "declined" : "paid";
}

/** The desk gave up waiting (the client walked off, the wrong terminal): stop waiting. A charge that still lands is recorded by the webhook. */
export async function cancelHelcimTerminalWait(businessId: string, paymentId: string) {
  await withTenant(businessId, (tx) => tx.update(schema.payments).set({ status: "failed", note: "Cancelled at the desk" }).where(and(eq(schema.payments.id, paymentId), eq(schema.payments.status, "pending"), eq(schema.payments.provider, "helcim"))));
}

// --- HelcimPay.js (a card typed in at the desk) ------------------------------

/** Open a HelcimPay.js checkout for an amount on the ticket. Saving the card ties the checkout to the client's Helcim customer. */
export async function startHelcimDeskCheckout(input: { businessId: string; token: string; saleId: string; amountCents: number; saveCard: boolean; actorUserId: string; brandColor: string | null }) {
  const { sale, client, amount, paymentId } = await openHelcimPayment({ businessId: input.businessId, saleId: input.saleId, amountCents: input.amountCents, method: "card", actorUserId: input.actorUserId });
  try {
    const customer = input.saveCard && client ? await ensureHelcimCustomer(input.businessId, input.token, client) : null;
    const s = await helcim.initializeCheckout(input.token, { paymentType: "purchase", amountCents: amount, currency: sale.currency, customerCode: customer?.code, brandColor: input.brandColor });
    await withTenant(input.businessId, (tx) => tx.update(schema.payments).set({ providerSession: encryptSecret(s.secretToken) }).where(eq(schema.payments.id, paymentId)));
    return { paymentId, checkoutToken: s.checkoutToken, amount };
  } catch (e) {
    await discardHelcimPayment(input.businessId, paymentId);
    throw new SaleError(`Couldn't open the card form: ${(e as Error).message}`);
  }
}

/**
 * The browser reports HelcimPay.js's result (eventMessage). It counts only when its hash checks out against the secret we kept for this
 * payment, and the transaction is then confirmed with Helcim before the ticket is marked paid.
 */
export async function finishHelcimDeskCheckout(input: { businessId: string; token: string; paymentId: string; eventMessage: unknown; taxRateBps: number }) {
  const p = await withTenant(input.businessId, (tx) => tx.query.payments.findFirst({ where: and(eq(schema.payments.id, input.paymentId), eq(schema.payments.provider, "helcim")) }));
  if (!p) throw new SaleError("Payment not found.");
  if (p.status !== "pending") return p.status === "failed" ? "declined" : "already";
  const msg = (typeof input.eventMessage === "string" ? JSON.parse(input.eventMessage) : input.eventMessage) as { data?: Record<string, unknown> & { transactionId?: number | string }; hash?: string };
  if (!msg?.data || !msg.hash || !p.providerSession) throw new SaleError("The card form's answer was incomplete. Check the payment in Helcim before charging again.");
  if (!verifyCheckoutHash(msg.data, msg.hash, decryptSecret(p.providerSession))) throw new SaleError("The card form's answer didn't verify. Check the payment in Helcim before charging again.");
  // Confirmed with Helcim itself, so the amount and status recorded are Helcim's.
  const t = await helcim.getTransaction(input.token, String(msg.data.transactionId));
  return settleHelcimPayment({ businessId: input.businessId, paymentId: p.id, transaction: t, taxRateBps: input.taxRateBps });
}

export async function abandonHelcimDeskCheckout(businessId: string, paymentId: string) {
  await discardHelcimPayment(businessId, paymentId);
}

// --- Webhook ----------------------------------------------------------------

/** A cardTransaction webhook: fetch the transaction and settle the pending payment that sent its invoice number. */
export async function handleHelcimCardTransaction(input: { businessId: string; token: string; transactionId: string; taxRateBps: number }): Promise<string> {
  const t = await helcim.getTransaction(input.token, input.transactionId);
  if (!t.invoiceNumber) return "no invoice number: not ours";
  const p = await pendingHelcimPaymentByInvoice(input.businessId, t.invoiceNumber);
  if (!p) return `no payment for invoice ${t.invoiceNumber}`;
  if (t.type === "refund") return "refund: recorded when made from the app";
  if (p.status === "failed" && p.note === "Cancelled at the desk" && t.status === "APPROVED") {
    // The desk stopped waiting but the client paid anyway: the money was taken, so the payment stands.
    await withTenant(input.businessId, (tx) => tx.update(schema.payments).set({ status: "pending", note: null }).where(eq(schema.payments.id, p.id)));
  }
  return settleHelcimPayment({ businessId: input.businessId, paymentId: p.id, transaction: t, taxRateBps: input.taxRateBps });
}

/** A terminalCancel webhook: the client or the desk cancelled on the terminal before paying. */
export async function handleHelcimTerminalCancel(businessId: string, invoiceNumber: string): Promise<string> {
  const p = await pendingHelcimPaymentByInvoice(businessId, invoiceNumber);
  if (!p || p.status !== "pending") return "nothing pending";
  await withTenant(businessId, (tx) => tx.update(schema.payments).set({ status: "failed", note: "Cancelled on the terminal" }).where(and(eq(schema.payments.id, p.id), eq(schema.payments.status, "pending"))));
  return "cancelled";
}
