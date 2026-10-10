/**
 * Platform billing with Stripe Billing on the PLATFORM account (not the
 * business's Connect account, which cannot be debited by us for Standard
 * accounts). Each business is a Stripe Customer with one subscription:
 *   - base plan (flat monthly, may be $0),
 *   - metered text-message usage (meter "sms_sent"),
 *   - a licensed "text number" item added while the business holds a number.
 * Products, prices and the meter are created on first use from env amounts,
 * keyed by amount, so no dashboard setup is needed.
 */
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { appUrl, isStripeConfigured, stripe } from "@/lib/stripe";
import { billingConfig, canBuyNumber, isDelinquent, isSubscribed, lookupKeys, SMS_METER_EVENT, type BillingConfig } from "@/lib/billing-config";

type Business = typeof schema.businesses.$inferSelect;

export class BillingError extends Error {}

export function billingEnabled(): boolean {
  return isStripeConfigured();
}

// ---------------------------------------------------------------------------
// Catalog (idempotent)
// ---------------------------------------------------------------------------

const PRODUCT_IDS = { base: "angelic_platform", number: "angelic_sms_number", usage: "angelic_sms_usage" } as const;

async function ensureProduct(id: keyof typeof PRODUCT_IDS, name: string, description: string): Promise<string> {
  const s = stripe();
  try {
    const p = await s.products.retrieve(PRODUCT_IDS[id]);
    if (!p.deleted) return p.id;
  } catch (e) {
    if ((e as Stripe.errors.StripeError).code !== "resource_missing") throw e;
  }
  const p = await s.products.create({ id: PRODUCT_IDS[id], name, description });
  return p.id;
}

async function ensureMeter(): Promise<string> {
  const s = stripe();
  const existing = await s.billing.meters.list({ status: "active", limit: 100 });
  const found = existing.data.find((m) => m.event_name === SMS_METER_EVENT);
  if (found) return found.id;
  const m = await s.billing.meters.create({
    display_name: "Text messages sent",
    event_name: SMS_METER_EVENT,
    default_aggregation: { formula: "sum" },
    customer_mapping: { event_payload_key: "stripe_customer_id", type: "by_id" },
    value_settings: { event_payload_key: "value" },
  });
  return m.id;
}

async function ensurePrice(lookupKey: string, create: () => Stripe.PriceCreateParams): Promise<string> {
  const s = stripe();
  const found = await s.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  if (found.data[0]) return found.data[0].id;
  const p = await s.prices.create({ ...create(), lookup_key: lookupKey, transfer_lookup_key: true });
  return p.id;
}

export interface Catalog {
  config: BillingConfig;
  basePriceId: string;
  numberPriceId: string;
  usagePriceId: string;
  meterId: string;
}

let catalogCache: { key: string; value: Catalog } | null = null;

/** Products, prices and the meter for the current env amounts. Cached per process. */
export async function ensureCatalog(): Promise<Catalog> {
  const config = billingConfig();
  const keys = lookupKeys(config);
  const cacheKey = `${process.env.STRIPE_SECRET_KEY?.slice(0, 12)}:${keys.base}:${keys.number}:${keys.usage}`;
  if (catalogCache?.key === cacheKey) return catalogCache.value;

  const [baseProduct, numberProduct, usageProduct, meterId] = await Promise.all([
    ensureProduct("base", "Angelic Booking", "Online booking, calendar, clients, checkout and payroll for your salon."),
    ensureProduct("number", "Dedicated text number", "Your own toll-free number for appointment texts."),
    ensureProduct("usage", "Text messages", "Appointment confirmations and reminders sent by SMS."),
    ensureMeter(),
  ]);
  const basePriceId = await ensurePrice(keys.base, () => ({ product: baseProduct, currency: "usd", unit_amount: config.baseCents, recurring: { interval: "month" } }));
  const numberPriceId = await ensurePrice(keys.number, () => ({ product: numberProduct, currency: "usd", unit_amount: config.numberCents, recurring: { interval: "month" } }));
  const usagePriceId = await ensurePrice(keys.usage, () =>
    config.smsIncluded > 0
      ? {
          product: usageProduct,
          currency: "usd",
          recurring: { interval: "month", usage_type: "metered", meter: meterId },
          billing_scheme: "tiered",
          tiers_mode: "graduated",
          tiers: [
            { up_to: config.smsIncluded, unit_amount: 0 },
            { up_to: "inf", unit_amount: config.smsUsageCents },
          ],
        }
      : { product: usageProduct, currency: "usd", unit_amount: config.smsUsageCents, recurring: { interval: "month", usage_type: "metered", meter: meterId } },
  );
  const value: Catalog = { config, basePriceId, numberPriceId, usagePriceId, meterId };
  catalogCache = { key: cacheKey, value };
  return value;
}

// ---------------------------------------------------------------------------
// Customer + subscription
// ---------------------------------------------------------------------------

export async function ensureCustomer(business: Business): Promise<string> {
  if (business.stripeCustomerId) return business.stripeCustomerId;
  const c = await stripe().customers.create({ name: business.name, email: business.email ?? undefined, metadata: { businessId: business.id, slug: business.slug } });
  await db.update(schema.businesses).set({ stripeCustomerId: c.id }).where(eq(schema.businesses.id, business.id));
  return c.id;
}

/** Copy the subscription's state onto the business row. */
export async function syncSubscription(businessId: string, sub: Stripe.Subscription): Promise<void> {
  const periodEnd = sub.items.data.map((i) => i.current_period_end).filter((n): n is number => typeof n === "number").sort((a, b) => b - a)[0];
  await db
    .update(schema.businesses)
    .set({
      stripeSubscriptionId: sub.id,
      stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      subscriptionStatus: sub.status,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
      plan: sub.status === "canceled" || sub.status === "incomplete_expired" ? "cancelled" : "standard",
    })
    .where(eq(schema.businesses.id, businessId));
  // Keep the number item id in sync in case it was added/removed outside the app.
  const numberKey = lookupKeys(billingConfig()).number.replace(/_\d+$/, "");
  const numberItem = sub.items.data.find((i) => i.price.lookup_key?.startsWith(numberKey));
  await withTenant(businessId, async (tx) => {
    const active = await tx.query.messagingNumbers.findFirst({ where: (t, { isNull }) => isNull(t.releasedAt) });
    if (active && active.stripeItemId !== (numberItem?.id ?? null)) {
      await tx.update(schema.messagingNumbers).set({ stripeItemId: numberItem?.id ?? null }).where(eq(schema.messagingNumbers.id, active.id));
    }
  });
}

export async function refreshSubscription(business: Business): Promise<void> {
  if (!business.stripeSubscriptionId) {
    if (!business.stripeCustomerId) return;
    // A subscription may exist from a Checkout we never heard back about.
    const list = await stripe().subscriptions.list({ customer: business.stripeCustomerId, status: "all", limit: 1 });
    if (list.data[0]) await syncSubscription(business.id, list.data[0]);
    return;
  }
  const sub = await stripe().subscriptions.retrieve(business.stripeSubscriptionId);
  await syncSubscription(business.id, sub);
}

/**
 * Where "Set up billing" sends the owner: Stripe Checkout to collect a card
 * and start the subscription, or the Customer Portal if one already exists.
 */
export async function startBilling(business: Business, slug: string): Promise<string> {
  if (!billingEnabled()) throw new BillingError("Billing is not configured on this platform yet.");
  if (business.stripeSubscriptionId && isSubscribed(business.subscriptionStatus)) return portalUrl(business, slug);
  const catalog = await ensureCatalog();
  const customer = await ensureCustomer(business);
  const number = await withTenant(business.id, (tx) => tx.query.messagingNumbers.findFirst({ where: (t, { isNull }) => isNull(t.releasedAt) }));
  const items: Stripe.Checkout.SessionCreateParams.LineItem[] = [{ price: catalog.basePriceId, quantity: 1 }, { price: catalog.usagePriceId }];
  if (number) items.push({ price: catalog.numberPriceId, quantity: 1 });
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: items,
    payment_method_collection: "always",
    allow_promotion_codes: true,
    subscription_data: {
      metadata: { businessId: business.id, slug },
      ...(catalog.config.trialDays > 0 ? { trial_period_days: catalog.config.trialDays } : {}),
    },
    success_url: appUrl(`/app/${slug}/settings/billing?session_id={CHECKOUT_SESSION_ID}`),
    cancel_url: appUrl(`/app/${slug}/settings/billing`),
  });
  if (!session.url) throw new BillingError("Stripe did not return a checkout URL.");
  return session.url;
}

/** Called from the Checkout success URL so state is right even before the webhook arrives. */
export async function completeCheckout(business: Business, sessionId: string): Promise<void> {
  const session = await stripe().checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
  const sub = session.subscription;
  if (!sub || typeof sub === "string") return;
  if (sub.metadata?.businessId && sub.metadata.businessId !== business.id) throw new BillingError("That checkout belongs to another business.");
  await syncSubscription(business.id, sub);
}

async function ensurePortalConfiguration(): Promise<string | undefined> {
  const s = stripe();
  const list = await s.billingPortal.configurations.list({ is_default: true, active: true, limit: 1 });
  if (list.data[0]) return undefined; // Stripe uses the default automatically
  const c = await s.billingPortal.configurations.create({
    business_profile: { headline: "Angelic Booking billing" },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ["email", "address", "name"] },
      subscription_cancel: { enabled: true, mode: "at_period_end" },
    },
  });
  return c.id;
}

export async function portalUrl(business: Business, slug: string): Promise<string> {
  const customer = await ensureCustomer(business);
  const configuration = await ensurePortalConfiguration();
  const session = await stripe().billingPortal.sessions.create({ customer, return_url: appUrl(`/app/${slug}/settings/billing`), ...(configuration ? { configuration } : {}) });
  return session.url;
}

// ---------------------------------------------------------------------------
// Add-ons and usage
// ---------------------------------------------------------------------------

export function billingState(business: Business) {
  const config = billingConfig();
  const enabled = billingEnabled();
  return {
    enabled,
    config,
    status: business.subscriptionStatus,
    subscribed: isSubscribed(business.subscriptionStatus),
    delinquent: isDelinquent(business.subscriptionStatus),
    canBuyNumber: canBuyNumber({ billingEnabled: enabled, status: business.subscriptionStatus, config }),
  };
}

/** Add the monthly number fee to the subscription (prorated). No-op when billing is off or the fee is $0. */
export async function attachNumberItem(business: Business, numberId: string): Promise<void> {
  if (!billingEnabled() || !business.stripeSubscriptionId) return;
  const catalog = await ensureCatalog();
  if (catalog.config.numberCents === 0) return;
  const item = await stripe().subscriptionItems.create({ subscription: business.stripeSubscriptionId, price: catalog.numberPriceId, quantity: 1, proration_behavior: "create_prorations" });
  await withTenant(business.id, (tx) => tx.update(schema.messagingNumbers).set({ stripeItemId: item.id }).where(eq(schema.messagingNumbers.id, numberId)));
}

/** Remove the number fee from the subscription, crediting the unused part of the month. */
export async function detachNumberItem(business: Business, number: { id: string; stripeItemId: string | null }): Promise<void> {
  if (!billingEnabled() || !number.stripeItemId) return;
  try {
    await stripe().subscriptionItems.del(number.stripeItemId, { proration_behavior: "create_prorations" });
  } catch (e) {
    if ((e as Stripe.errors.StripeError).code !== "resource_missing") throw e;
  }
  await withTenant(business.id, (tx) => tx.update(schema.messagingNumbers).set({ stripeItemId: null }).where(eq(schema.messagingNumbers.id, number.id)));
}

/**
 * Report sent text messages to the usage meter, one event per message with the
 * notification id as the idempotency identifier. Never throws: billing must not
 * block delivery.
 */
export async function reportSmsUsage(businessId: string, notificationIds: string[]): Promise<number> {
  if (!billingEnabled() || !notificationIds.length) return 0;
  const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, businessId), columns: { stripeCustomerId: true, subscriptionStatus: true } });
  if (!business?.stripeCustomerId || !isSubscribed(business.subscriptionStatus)) return 0;
  let n = 0;
  for (const id of notificationIds) {
    try {
      await stripe().billing.meterEvents.create({ event_name: SMS_METER_EVENT, identifier: `sms_${id}`, payload: { stripe_customer_id: business.stripeCustomerId, value: "1" } });
      n++;
    } catch (e) {
      console.error("[billing] meter event failed", id, (e as Error).message);
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// Webhook (account-level events)
// ---------------------------------------------------------------------------

export async function handleBillingEvent(event: Stripe.Event): Promise<"processed" | "duplicate" | "ignored"> {
  const inserted = await db
    .insert(schema.webhookEvents)
    .values({ id: event.id, type: event.type, accountId: null, payload: event as unknown as Record<string, unknown> })
    .onConflictDoNothing()
    .returning({ id: schema.webhookEvents.id });
  if (inserted.length === 0) {
    const existing = await db.query.webhookEvents.findFirst({ where: eq(schema.webhookEvents.id, event.id) });
    if (existing?.processedAt) return "duplicate";
  }
  try {
    let outcome: "processed" | "ignored" = "ignored";
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode === "subscription" && session.subscription) {
          const sub = await stripe().subscriptions.retrieve(typeof session.subscription === "string" ? session.subscription : session.subscription.id);
          const businessId = await businessIdFor(sub);
          if (businessId) {
            await syncSubscription(businessId, sub);
            outcome = "processed";
          }
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed": {
        const sub = event.data.object;
        const businessId = await businessIdFor(sub);
        if (businessId) {
          await syncSubscription(businessId, sub);
          outcome = "processed";
        }
        break;
      }
      case "invoice.payment_failed":
      case "invoice.paid": {
        // Subscription status changes arrive as customer.subscription.updated; nothing extra needed.
        outcome = "ignored";
        break;
      }
    }
    await db.update(schema.webhookEvents).set({ processedAt: new Date() }).where(eq(schema.webhookEvents.id, event.id));
    return outcome;
  } catch (e) {
    await db.update(schema.webhookEvents).set({ error: (e as Error).message }).where(eq(schema.webhookEvents.id, event.id));
    throw e;
  }
}

async function businessIdFor(sub: Stripe.Subscription): Promise<string | null> {
  if (sub.metadata?.businessId) return sub.metadata.businessId;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const b = await db.query.businesses.findFirst({ where: eq(schema.businesses.stripeCustomerId, customerId), columns: { id: true } });
  return b?.id ?? null;
}
