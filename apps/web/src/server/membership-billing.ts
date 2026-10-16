/**
 * Membership auto-renewal with Stripe subscriptions on the business's own
 * Connect account. Setting it up creates a recurring price for the plan (once,
 * at the plan's cadence) and a subscription anchored to the current period end,
 * charging the client's saved card. Renewal invoices arrive on the Connect
 * webhook and extend the membership, top up its credits (plus any rollover)
 * and record a paid sale. Fixed-length plans get a Stripe cancel-at date so the
 * card stops being charged after the last period. A freeze pauses collection
 * in Stripe (invoices in the window are voided) until the thaw date.
 */
import { triggerWorkflows } from "@/server/workflows";
import type Stripe from "stripe";
import { eq, sql } from "drizzle-orm";
import { db, schema, withJobs, withTenant } from "@angelic/db";
import { stripe } from "@/lib/stripe";
import { addMembershipPeriod, isMembershipInterval, renewedCredits } from "@angelic/core";
import { ensureStripeCustomer } from "./stripe-connect";
import { locationOrDefault, paymentContextFor } from "./locations";

export class MembershipBillingError extends Error {}

type Business = typeof schema.businesses.$inferSelect;

async function ensurePlanPrice(accountId: string, businessId: string, plan: typeof schema.membershipPlans.$inferSelect, currency: string): Promise<string> {
  if (plan.stripePriceId) return plan.stripePriceId;
  const product = await stripe().products.create({ name: `${plan.name} membership`, metadata: { planId: plan.id, businessId } }, { stripeAccount: accountId });
  const price = await stripe().prices.create({ product: product.id, currency, unit_amount: plan.priceCents, recurring: { interval: isMembershipInterval(plan.interval) ? plan.interval : "month", interval_count: Math.max(1, plan.intervalCount) }, metadata: { planId: plan.id } }, { stripeAccount: accountId });
  await withTenant(businessId, (tx) => tx.update(schema.membershipPlans).set({ stripePriceId: price.id }).where(eq(schema.membershipPlans.id, plan.id)));
  return price.id;
}

/** Start charging the saved card every period from the end of the current one. */
export async function enableAutoRenew(business: Business, membershipId: string, paymentMethodId: string, actorUserId: string) {
  const m = await withTenant(business.id, (tx) => tx.query.clientMemberships.findFirst({ where: eq(schema.clientMemberships.id, membershipId) }));
  // A membership paused by a failed card comes back to life here; a frozen one has to be resumed first.
  const revivable = m?.status === "paused" && !m.frozenUntil;
  if (!m || (m.status !== "active" && !revivable)) throw new MembershipBillingError(m?.status === "paused" ? "Resume the membership first." : "Membership is not active.");
  if (m.stripeSubscriptionId) throw new MembershipBillingError("Auto-renew is already on.");
  const [plan, client] = await withTenant(business.id, async (tx) => [await tx.query.membershipPlans.findFirst({ where: eq(schema.membershipPlans.id, m.planId) }), await tx.query.clients.findFirst({ where: eq(schema.clients.id, m.clientId) })] as const);
  if (!plan || !client) throw new MembershipBillingError("Plan or client not found.");
  const interval = isMembershipInterval(plan.interval) ? plan.interval : "month";
  const periodsLeft = plan.cycleCount ? plan.cycleCount - m.cyclesBilled : null;
  if (periodsLeft !== null && periodsLeft <= 0) throw new MembershipBillingError("This plan's last period is already paid; there is nothing left to renew.");
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
      // Fixed-length plans: charge the remaining periods, then stop on their own.
      ...(periodsLeft !== null ? { cancel_at: Math.floor(addMembershipPeriod(new Date(anchor * 1000), interval, plan.intervalCount, periodsLeft).getTime() / 1000) } : {}),
      proration_behavior: "none",
      collection_method: "charge_automatically",
      metadata: { businessId: business.id, membershipId: m.id, planId: plan.id, clientId: client.id },
    },
    { stripeAccount: accountId, idempotencyKey: `membership_sub_${m.id}` },
  );
  await withTenant(business.id, async (tx) => {
    await tx.update(schema.clientMemberships).set({ stripeSubscriptionId: sub.id, autoRenew: true, status: "active", paymentFailedAt: null, locationId: m.locationId ?? pay.location?.id ?? null }).where(eq(schema.clientMemberships.id, m.id));
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

/** Pause a membership until a date: no charges, no credits. It resumes on its own when the date passes. */
export async function freezeMembership(business: Business, membershipId: string, until: Date, actorUserId: string) {
  const m = await withTenant(business.id, (tx) => tx.query.clientMemberships.findFirst({ where: eq(schema.clientMemberships.id, membershipId) }));
  if (!m || m.status !== "active") throw new MembershipBillingError("Only an active membership can be frozen.");
  if (until.getTime() <= Date.now()) throw new MembershipBillingError("Pick a date in the future.");
  if (m.stripeSubscriptionId) {
    const pay = await paymentContextFor(business, m.locationId);
    if (pay.accountId) await stripe().subscriptions.update(m.stripeSubscriptionId, { pause_collection: { behavior: "void", resumes_at: Math.floor(until.getTime() / 1000) } }, { stripeAccount: pay.accountId });
  }
  await withTenant(business.id, async (tx) => {
    await tx.update(schema.clientMemberships).set({ status: "paused", frozenAt: new Date(), frozenUntil: until }).where(eq(schema.clientMemberships.id, m.id));
    await tx.insert(schema.auditLog).values({ businessId: business.id, actorUserId, action: "membership.freeze", entity: "client_membership", entityId: m.id, diff: JSON.stringify({ until: until.toISOString() }) });
  });
}

/** End a freeze early. Members without card billing get the frozen time added to their period. */
export async function resumeMembership(business: Business, membershipId: string, actorUserId: string) {
  const m = await withTenant(business.id, (tx) => tx.query.clientMemberships.findFirst({ where: eq(schema.clientMemberships.id, membershipId) }));
  if (!m || m.status !== "paused" || !m.frozenUntil) throw new MembershipBillingError("This membership isn't frozen.");
  let periodEnd = m.currentPeriodEnd;
  if (m.stripeSubscriptionId) {
    const pay = await paymentContextFor(business, m.locationId);
    if (pay.accountId) {
      const sub = await stripe().subscriptions.update(m.stripeSubscriptionId, { pause_collection: "" }, { stripeAccount: pay.accountId });
      const end = (sub as unknown as { current_period_end?: number }).current_period_end ?? (sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end;
      if (end) periodEnd = new Date(end * 1000);
    }
  } else if (m.frozenAt) {
    periodEnd = new Date(m.currentPeriodEnd.getTime() + Math.max(0, Date.now() - m.frozenAt.getTime()));
  }
  await withTenant(business.id, async (tx) => {
    await tx.update(schema.clientMemberships).set({ status: "active", frozenAt: null, frozenUntil: null, currentPeriodEnd: periodEnd }).where(eq(schema.clientMemberships.id, m.id));
    await tx.insert(schema.auditLog).values({ businessId: business.id, actorUserId, action: "membership.resume", entity: "client_membership", entityId: m.id });
  });
}

/** Connect webhook: a renewal invoice was paid. Extends the period, resets credits, records the sale. Idempotent per invoice. */
export async function handleRenewalInvoice(business: Business, invoice: Stripe.Invoice, locationId: string | null = null, accountId: string | null = null) {
  const subId = subscriptionIdOf(invoice);
  if (!subId) return false;
  const m = await withJobs((tx) => tx.query.clientMemberships.findFirst({ where: eq(schema.clientMemberships.stripeSubscriptionId, subId) }));
  if (!m || m.businessId !== business.id) return false;
  if (invoice.billing_reason === "subscription_create") {
    // First invoice at creation is $0 (anchored, no proration); nothing to record.
    return true;
  }
  // Fetched before the transaction: the renewal's PaymentIntent is what a later refund sends money back through.
  const piId = (invoice.amount_paid ?? 0) > 0 ? await paymentIntentOfInvoice(invoice, accountId) : null;
  await withTenant(business.id, async (tx) => {
    const fresh = await tx.query.clientMemberships.findFirst({ where: eq(schema.clientMemberships.id, m.id) });
    if (!fresh || fresh.lastInvoiceId === invoice.id) return;
    const plan = await tx.query.membershipPlans.findFirst({ where: eq(schema.membershipPlans.id, fresh.planId) });
    const periodEnd = invoice.lines.data[0]?.period?.end;
    const base = fresh.currentPeriodEnd > new Date() ? fresh.currentPeriodEnd : new Date();
    const fallbackEnd = addMembershipPeriod(base, plan && isMembershipInterval(plan.interval) ? plan.interval : "month", plan?.intervalCount ?? 1);
    await tx
      .update(schema.clientMemberships)
      .set({
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : fallbackEnd,
        creditsRemaining: renewedCredits(fresh.creditsRemaining, plan?.includedSessions ?? 0, plan?.rolloverCap ?? 0),
        cyclesBilled: fresh.cyclesBilled + 1,
        status: "active",
        paymentFailedAt: null,
        lastInvoiceId: invoice.id,
      })
      .where(eq(schema.clientMemberships.id, fresh.id));
    const amount = invoice.amount_paid ?? 0;
    if (amount > 0) {
      const rows = await tx.execute<{ n: number }>(sql`select next_sale_number(${business.id}) as n`);
      const [sale] = await tx
        .insert(schema.sales)
        .values({ businessId: business.id, number: Number(rows[0]?.n ?? 1001), clientId: fresh.clientId, locationId: fresh.locationId ?? locationId ?? (await locationOrDefault(tx, null))?.id ?? null, currency: invoice.currency, source: "membership", status: "paid", subtotalCents: amount, totalCents: amount, paidCents: amount, closedAt: new Date() })
        .returning();
      await tx.insert(schema.saleLines).values({ businessId: business.id, saleId: sale!.id, kind: "membership", productId: fresh.planId, name: `${plan?.name ?? "Membership"} renewal`, quantity: 1, unitCents: amount, amountCents: amount, taxable: false });
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

/**
 * The PaymentIntent that paid an invoice. Older API versions put it on the invoice (`payment_intent`); the pinned one lists it under the
 * invoice's payments, which the event doesn't include, so they are fetched. Null when it can't be found (the refund then refuses rather
 * than recording money going back that didn't).
 */
async function paymentIntentOfInvoice(invoice: Stripe.Invoice, accountId: string | null): Promise<string | null> {
  const idOf = (x: unknown) => (typeof x === "string" ? x : x && typeof x === "object" && "id" in x ? String((x as { id: string }).id) : null);
  const legacy = idOf((invoice as unknown as { payment_intent?: unknown }).payment_intent);
  if (legacy) return legacy;
  const embedded = (invoice as unknown as { payments?: { data?: { status?: string; payment?: { payment_intent?: unknown } }[] } }).payments?.data ?? [];
  const fromEvent = embedded.filter((p) => p.status === "paid").map((p) => idOf(p.payment?.payment_intent)).find(Boolean);
  if (fromEvent) return fromEvent;
  if (!accountId || !invoice.id) return null;
  try {
    const list = await stripe().invoicePayments.list({ invoice: invoice.id, status: "paid", limit: 5 }, { stripeAccount: accountId });
    return list.data.map((p) => idOf(p.payment.payment_intent)).find(Boolean) ?? null;
  } catch (e) {
    console.error("[membership] could not look up the invoice's payment", invoice.id, (e as Error).message);
    return null;
  }
}

function subscriptionIdOf(invoice: Stripe.Invoice): string | null {
  const parent = (invoice as unknown as { parent?: { subscription_details?: { subscription?: string | { id: string } } } }).parent;
  const s = parent?.subscription_details?.subscription ?? (invoice as unknown as { subscription?: string | { id: string } }).subscription;
  return typeof s === "string" ? s : s?.id ?? null;
}

// Unscoped lookups used by the webhook (business by account id) live in webhooks.ts.
void db;
