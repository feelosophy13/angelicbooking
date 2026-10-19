/**
 * What Stripe knows about a business's platform subscription, read for the Billing page: the subscription (period,
 * trial, card on file), the upcoming-invoice preview and the invoice history. No database import, so a test can stand
 * in a fake Stripe client (vi.mock("@/lib/stripe")) and the page's loaders in server/billing.ts stay the only writers.
 * Every call has a short timeout and never throws: the page shows the price-book figures with a quiet notice instead.
 */
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { INVOICE_PAGE_SIZE, invoiceRow, type InvoiceRow, type Preview } from "@/lib/billing-breakdown";

/** Long enough for Stripe on a slow day, short enough that a page never hangs on it. */
const TIMEOUT_MS = 8_000;
const opts = { timeout: TIMEOUT_MS } as const;

type BillingIds = { stripeCustomerId: string | null; stripeSubscriptionId: string | null };

export interface SubscriptionSnapshot {
  status: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  trialEnd: Date | null;
  /** Set when the owner cancelled in the Customer Portal: the plan ends at the period end. */
  cancelAt: Date | null;
  /** The card Stripe will charge, or null when none is saved. */
  card: { brand: string; last4: string } | null;
}

export interface StripeOverview {
  /** false when Stripe could not be reached (or there is no subscription): the page falls back to the price book. */
  reachable: boolean;
  subscription: SubscriptionSnapshot | null;
  preview: Preview | null;
}

function cardOf(pm: string | Stripe.PaymentMethod | null | undefined): SubscriptionSnapshot["card"] {
  if (!pm || typeof pm === "string" || !pm.card) return null;
  return { brand: pm.card.display_brand ?? pm.card.brand, last4: pm.card.last4 ?? "" };
}

function at(sec: number | null | undefined): Date | null {
  return typeof sec === "number" ? new Date(sec * 1000) : null;
}

function snapshot(sub: Stripe.Subscription, customer: Stripe.Customer | null): SubscriptionSnapshot {
  const starts = sub.items.data.map((i) => i.current_period_start).filter((n): n is number => typeof n === "number");
  const ends = sub.items.data.map((i) => i.current_period_end).filter((n): n is number => typeof n === "number");
  return {
    status: sub.status,
    periodStart: starts.length ? new Date(Math.min(...starts) * 1000) : null,
    periodEnd: ends.length ? new Date(Math.max(...ends) * 1000) : null,
    trialEnd: at(sub.trial_end),
    cancelAt: sub.cancel_at_period_end ? (ends.length ? new Date(Math.max(...ends) * 1000) : null) : at(sub.cancel_at),
    card: cardOf(sub.default_payment_method) ?? cardOf(customer?.invoice_settings.default_payment_method),
  };
}

function previewOf(inv: Stripe.Invoice): Preview {
  return {
    totalCents: inv.total,
    lines: inv.lines.data.map((l) => ({
      product: l.pricing?.price_details?.product ?? null,
      description: l.description,
      amountCents: l.amount,
      quantity: l.quantity,
      unitAmountDecimal: l.pricing?.unit_amount_decimal != null ? String(l.pricing.unit_amount_decimal) : null,
      proration: l.parent?.subscription_item_details?.proration ?? l.parent?.invoice_item_details?.proration ?? false,
    })),
  };
}

/**
 * The subscription and Stripe's preview of the next invoice. Null subscription when the business has none; `reachable`
 * false when Stripe errored or timed out (logged once, never thrown).
 */
export async function stripeOverview(b: BillingIds): Promise<StripeOverview> {
  if (!b.stripeSubscriptionId || !b.stripeCustomerId) return { reachable: true, subscription: null, preview: null };
  try {
    const s = stripe();
    const sub = await s.subscriptions.retrieve(b.stripeSubscriptionId, { expand: ["default_payment_method"] }, opts);
    // The card lives on the customer when it was saved by Checkout without being pinned to the subscription.
    const customer = sub.default_payment_method ? null : await s.customers.retrieve(b.stripeCustomerId, { expand: ["invoice_settings.default_payment_method"] }, opts).then((c) => (c.deleted ? null : c));
    let preview: Preview | null = null;
    if (!["canceled", "incomplete_expired"].includes(sub.status)) {
      // A paused or just-cancelled subscription has no upcoming invoice; that is a plain "nothing due", not an outage.
      preview = await s.invoices.createPreview({ customer: b.stripeCustomerId, subscription: b.stripeSubscriptionId }, opts).then(previewOf, (e: Stripe.errors.StripeError) => {
        if (e.code === "invoice_upcoming_none") return null;
        throw e;
      });
    }
    return { reachable: true, subscription: snapshot(sub, customer), preview };
  } catch (e) {
    console.error("[billing] overview unavailable", (e as Error).message);
    return { reachable: false, subscription: null, preview: null };
  }
}

export interface InvoicePage {
  rows: InvoiceRow[];
  /** Cursor for the next (older) page, or null on the last one. */
  olderAfter: string | null;
  /** Cursor for the previous (newer) page, or null on the first one. */
  newerBefore: string | null;
  /** false when Stripe could not be reached. */
  reachable: boolean;
}

const EMPTY: InvoicePage = { rows: [], olderAfter: null, newerBefore: null, reachable: true };

/**
 * The business's invoices, newest first, a page at a time. Pass `after` (the last id shown) for the older page and
 * `before` (the first id shown) for the newer one; both come from the page's own links. Drafts are left out: Stripe
 * makes one an hour before each charge and a person cannot act on it.
 */
export async function listInvoices(b: Pick<BillingIds, "stripeCustomerId">, cursor: { after?: string | null; before?: string | null } = {}): Promise<InvoicePage> {
  if (!b.stripeCustomerId) return EMPTY;
  try {
    const params: Stripe.InvoiceListParams = { customer: b.stripeCustomerId, limit: INVOICE_PAGE_SIZE };
    if (cursor.before) params.ending_before = cursor.before;
    else if (cursor.after) params.starting_after = cursor.after;
    const list = await stripe().invoices.list(params, opts);
    const rows = list.data.map(invoiceRow).filter((r) => r.status !== "draft");
    const first = list.data[0]?.id ?? null;
    const last = list.data[list.data.length - 1]?.id ?? null;
    if (cursor.before) {
      // Walking back towards the newest: `has_more` says whether newer pages remain before this one.
      return { rows, olderAfter: last, newerBefore: list.has_more ? first : null, reachable: true };
    }
    return { rows, olderAfter: list.has_more ? last : null, newerBefore: cursor.after ? first : null, reachable: true };
  } catch (e) {
    console.error("[billing] invoices unavailable", (e as Error).message);
    return { ...EMPTY, reachable: false };
  }
}
