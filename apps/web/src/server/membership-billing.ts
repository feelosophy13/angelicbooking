/**
 * Membership auto-renewal with Stripe subscriptions on the business's own
 * Connect account. Setting it up creates a monthly price for the plan (once)
 * and a subscription anchored to the current period end, charging the
 * client's saved card. Renewal invoices arrive on the Connect webhook and
 * extend the membership, reset its credits and record a paid sale.
 */
import { triggerWorkflows } from "@/server/workflows";
import type Stripe from "stripe";
import { eq, sql } from "drizzle-orm";
import { db, schema, withJobs, withTenant } from "@angelic/db";
import { stripe } from "@/lib/stripe";
import { ensureStripeCustomer } from "./stripe-connect";
import { locationOrDefault, paymentContextFor } from "./locations";

export class MembershipBillingError extends Error {}

type Business = typeof schema.businesses.$inferSelect;

async function ensurePlanPrice(accountId: string, businessId: string, plan: typeof schema.membershipPlans.$inferSelect, currency: string): Promise<string> {
  if (plan.stripePriceId) return plan.stripePriceId;
  const product = await stripe().products.create({ name: `${plan.name} membership`, metadata: { planId: plan.id, businessId } }, { stripeAccount: accountId });
  const price = await stripe().prices.create({ product: product.id, currency, unit_amount: plan.priceCents, recurring: { interval: "month" }, metadata: { planId: plan.id } }, { stripeAccount: accountId });
  await withTenant(businessId, (tx) => tx.update(schema.membershipPlans).set({ stripePriceId: price.id }).where(eq(schema.membershipPlans.id, plan.id)));
  return price.id;
}

/** Start charging the saved card every month from the end of the current period. */
export async function enableAutoRenew(business: Business, membershipId: string, paymentMethodId: string, actorUserId: string) {
  const m = await withTenant(business.id, (tx) => tx.query.clientMemberships.findFirst({ where: eq(schema.clientMemberships.id, membershipId) }));
  if (!m || m.status !== "active") throw new MembershipBillingError("Membership is not active.");
  if (m.stripeSubscriptionId) throw new MembershipBillingError("Auto-renew is already on.");
  const [plan, client] = await withTenant(business.id, async (tx) => [await tx.query.membershipPlans.findFirst({ where: eq(schema.membershipPlans.id, m.planId) }), await tx.query.clients.findFirst({ where: eq(schema.clients.id, m.clientId) })] as const);
  if (!plan || !client) throw new MembershipBillingError("Plan or client not found.");
  // The subscription lives on the account of the site that sold the membership (else the client's home site, else the default).
  const pay = await paymentContextFor(business, m.locationId ?? client.homeLocationId);
  const accountId = pay.accountId;
  if (!accountId || !pay.ready) throw new MembershipBillingError("Connect Stripe under Settings → Payments first.");
  const customer = await withTenant(business.id, (tx) => ensureStripeCustomer({ accountId, businessId: business.id, client, tx }));
  const priceId = await ensurePlanPrice(accountId, business.id, plan, business.currency);
  const anchor = Math.max(Math.floor(m.currentPeriodEnd.getTime() / 1000), Math.floor(Date.now() / 1000) + 300);
  const sub = await stripe().subscriptions.create(
    {
      customer,
      items: [{ price: priceId }],
      default_payment_method: paymentMethodId,
      billing_cycle_anchor: anchor,
      proration_behavior: "none",
      collection_method: "charge_automatically",
      metadata: { businessId: business.id, membershipId: m.id, planId: plan.id, clientId: client.id },
    },
    { stripeAccount: accountId, idempotencyKey: `membership_sub_${m.id}` },
  );
  await withTenant(business.id, async (tx) => {
    await tx.update(schema.clientMemberships).set({ stripeSubscriptionId: sub.id, autoRenew: true, paymentFailedAt: null, locationId: m.locationId ?? pay.location?.id ?? null }).where(eq(schema.clientMemberships.id, m.id));
    await tx.insert(schema.auditLog).values({ businessId: business.id, actorUserId, action: "membership.autorenew_on", entity: "client_membership", entityId: m.id, diff: JSON.stringify({ subscription: sub.id }) });
  });
}

export async function disableAutoRenew(business: Business, membershipId: string, actorUserId: string, cancelMembership = false) {
  const m = await withTenant(business.id, (tx) => tx.query.clientMemberships.findFirst({ where: eq(schema.clientMemberships.id, membershipId) }));
  if (!m) throw new MembershipBillingError("Membership not found.");
  const pay = await paymentContextFor(business, m.locationId);
  if (m.stripeSubscriptionId && pay.accountId) {
    try {
      await stripe().subscriptions.cancel(m.stripeSubscriptionId, {}, { stripeAccount: pay.accountId });
    } catch (e) {
      if ((e as Stripe.errors.StripeError).code !== "resource_missing") throw e;
    }
  }
  await withTenant(business.id, async (tx) => {
    await tx
      .update(schema.clientMemberships)
      .set({ stripeSubscriptionId: null, autoRenew: false, ...(cancelMembership ? { status: "cancelled" as const, cancelledAt: new Date() } : {}) })
      .where(eq(schema.clientMemberships.id, m.id));
    await tx.insert(schema.auditLog).values({ businessId: business.id, actorUserId, action: cancelMembership ? "membership.cancel" : "membership.autorenew_off", entity: "client_membership", entityId: m.id });
  });
}

/** Connect webhook: a renewal invoice was paid. Extends the period, resets credits, records the sale. Idempotent per invoice. */
export async function handleRenewalInvoice(business: Business, invoice: Stripe.Invoice, locationId: string | null = null) {
  const subId = subscriptionIdOf(invoice);
  if (!subId) return false;
  const m = await withJobs((tx) => tx.query.clientMemberships.findFirst({ where: eq(schema.clientMemberships.stripeSubscriptionId, subId) }));
  if (!m || m.businessId !== business.id) return false;
  if (invoice.billing_reason === "subscription_create") {
    // First invoice at creation is $0 (anchored, no proration); nothing to record.
    return true;
  }
  await withTenant(business.id, async (tx) => {
    const fresh = await tx.query.clientMemberships.findFirst({ where: eq(schema.clientMemberships.id, m.id) });
    if (!fresh || fresh.lastInvoiceId === invoice.id) return;
    const plan = await tx.query.membershipPlans.findFirst({ where: eq(schema.membershipPlans.id, fresh.planId) });
    const periodEnd = invoice.lines.data[0]?.period?.end;
    const base = fresh.currentPeriodEnd > new Date() ? fresh.currentPeriodEnd.getTime() : Date.now();
    await tx
      .update(schema.clientMemberships)
      .set({ currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : new Date(base + 30 * 86_400_000), creditsRemaining: plan?.includedSessions ?? 0, status: "active", paymentFailedAt: null, lastInvoiceId: invoice.id })
      .where(eq(schema.clientMemberships.id, fresh.id));
    const amount = invoice.amount_paid ?? 0;
    if (amount > 0) {
      const rows = await tx.execute<{ n: number }>(sql`select next_sale_number(${business.id}) as n`);
      const [sale] = await tx
        .insert(schema.sales)
        .values({ businessId: business.id, number: Number(rows[0]?.n ?? 1001), clientId: fresh.clientId, locationId: fresh.locationId ?? locationId ?? (await locationOrDefault(tx, null))?.id ?? null, currency: invoice.currency, source: "membership", status: "paid", subtotalCents: amount, totalCents: amount, paidCents: amount, closedAt: new Date() })
        .returning();
      await tx.insert(schema.saleLines).values({ businessId: business.id, saleId: sale!.id, kind: "membership", productId: fresh.planId, name: `${plan?.name ?? "Membership"} renewal`, quantity: 1, unitCents: amount, amountCents: amount, taxable: false });
      const piId = typeof (invoice as unknown as { payment_intent?: string | { id: string } }).payment_intent === "string" ? ((invoice as unknown as { payment_intent: string }).payment_intent) : ((invoice as unknown as { payment_intent?: { id: string } }).payment_intent?.id ?? null);
      await tx.insert(schema.payments).values({ businessId: business.id, saleId: sale!.id, method: "card_on_file", status: "succeeded", amountCents: amount, tipCents: 0, stripePaymentIntentId: piId, note: `Membership renewal · invoice ${invoice.number ?? invoice.id}` }).onConflictDoNothing();
    }
  });
  return true;
}

export async function handleRenewalFailed(business: Business, invoice: Stripe.Invoice) {
  const subId = subscriptionIdOf(invoice);
  if (!subId) return false;
  const m = await withJobs((tx) => tx.query.clientMemberships.findFirst({ where: eq(schema.clientMemberships.stripeSubscriptionId, subId) }));
  if (!m || m.businessId !== business.id) return false;
  await withTenant(business.id, (tx) => tx.update(schema.clientMemberships).set({ paymentFailedAt: new Date(), status: "paused" }).where(eq(schema.clientMemberships.id, m.id)));
  await triggerWorkflows(business, "membership_payment_failed", { clientId: m.clientId, dedupeKey: `${m.id}:${invoice.id}`, context: { membershipId: m.id, locationId: m.locationId, reason: "Membership payment failed" } }).catch((e) => console.error("[workflows] membership_payment_failed failed", (e as Error).message));
  return true;
}

export async function handleSubscriptionDeleted(business: Business, sub: Stripe.Subscription) {
  const m = await withJobs((tx) => tx.query.clientMemberships.findFirst({ where: eq(schema.clientMemberships.stripeSubscriptionId, sub.id) }));
  if (!m || m.businessId !== business.id) return false;
  await withTenant(business.id, (tx) => tx.update(schema.clientMemberships).set({ stripeSubscriptionId: null, autoRenew: false }).where(eq(schema.clientMemberships.id, m.id)));
  return true;
}

function subscriptionIdOf(invoice: Stripe.Invoice): string | null {
  const parent = (invoice as unknown as { parent?: { subscription_details?: { subscription?: string | { id: string } } } }).parent;
  const s = parent?.subscription_details?.subscription ?? (invoice as unknown as { subscription?: string | { id: string } }).subscription;
  return typeof s === "string" ? s : s?.id ?? null;
}

// Unscoped lookups used by the webhook (business by account id) live in webhooks.ts.
void db;
