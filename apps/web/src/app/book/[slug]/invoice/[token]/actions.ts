"use server";
import { getBusinessForLinks } from "@/server/public-booking";
import { finishInvoicePayment, InvoiceError, startInvoicePayment, type StartPaymentResult } from "@/server/invoices";
import { SaleError } from "@/server/sales";

export async function startInvoicePaymentAction(slug: string, token: string, amountCents: number): Promise<StartPaymentResult | { error: string }> {
  const business = await getBusinessForLinks(slug);
  if (!business) return { error: "This invoice isn't available." };
  try {
    return await startInvoicePayment(business, token, Math.round(amountCents));
  } catch (e) {
    if (e instanceof InvoiceError || e instanceof SaleError) return { error: e.message };
    throw e;
  }
}

export async function finishInvoicePaymentAction(slug: string, token: string, intentId: string, /** Helcim: HelcimPay.js's answer (intentId is then the checkout id). */ helcimEvent?: unknown): Promise<{ ok?: boolean; error?: string }> {
  const business = await getBusinessForLinks(slug);
  if (!business) return { error: "This invoice isn't available." };
  try {
    await finishInvoicePayment(business, token, intentId, helcimEvent);
    return { ok: true };
  } catch (e) {
    if (e instanceof InvoiceError || e instanceof SaleError) return { error: e.message };
    throw e;
  }
}
