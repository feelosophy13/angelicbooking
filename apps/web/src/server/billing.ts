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
import { and, inArray, sql } from "drizzle-orm";
import type { PriceBook } from "@angelic/core/platform-pricing";
import { canBuyNumber, configFromBook, isDelinquent, isSubscribed, lookupKeys, NUMBER_KEY_PREFIX, SMS_METER_EVENT, smsPausedReason, type BillingConfig } from "@/lib/billing-config";
import { checkoutTrial } from "@/lib/access";
import { desiredItems, pauseAction, planChanges, priceKey, SUSPEND_PAUSE_MARKER, type ManagedKind } from "@/lib/billing-plan";
import { platformPriceBook, priceBookFor } from "@/server/price-book";

type Business = typeof schema.businesses.$inferSelect;

export class BillingError extends Error {}

export function billingEnabled(): boolean {
  return isStripeConfigured();
}

// ---------------------------------------------------------------------------
// Catalog (idempotent)
// ---------------------------------------------------------------------------

const PRODUCT_IDS = { base: "angelic_platform", number: "angelic_sms_number", usage: "angelic_sms_usage", location: "angelic_extra_location", staff: "angelic_extra_staff" } as const;

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
  /** Stripe price id for a per-location or per-staff monthly amount (created on first use). */
  priceFor(kind: ManagedKind, cents: number): Promise<string>;
}

const catalogCache = new Map<string, Catalog>();

/** Products, prices and the meter for a price book. Cached per process and per set of amounts. */
export async function ensureCatalog(book: PriceBook): Promise<Catalog> {
  const config: BillingConfig = configFromBook(book);
  const keys = lookupKeys(config);
  const cacheKey = `${process.env.STRIPE_SECRET_KEY?.slice(0, 12)}:${keys.base}:${keys.number}:${keys.usage}`;
  const cached = catalogCache.get(cacheKey);
  if (cached) return cached;

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
  const priceFor = async (kind: ManagedKind, cents: number): Promise<string> => {
    if (kind === "base") return ensurePrice(priceKey("base", cents), () => ({ product: baseProduct, currency: "usd", unit_amount: cents, recurring: { interval: "month" } }));
    const product = await ensureProduct(kind, kind === "location" ? "Additional location" : "Additional staff member", kind === "location" ? "Each location beyond the ones included in your plan." : "Each active staff member beyond the ones included in your plan.");
    return ensurePrice(priceKey(kind, cents), () => ({ product, currency: "usd", unit_amount: cents, recurring: { interval: "month" } }));
  };
  const value: Catalog = { config, basePriceId, numberPriceId, usagePriceId, meterId, priceFor };
  catalogCache.set(cacheKey, value);
  return value;
}

/** What the business uses that the price book charges for. */
export async function billableUsage(businessId: string): Promise<{ locations: number; activeStaff: number }> {
  return withTenant(businessId, async (tx) => {
    const [l] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.locations);
    const [st] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.staff).where(eq(schema.staff.active, true));
    return { locations: Number(l?.n ?? 0), activeStaff: Number(st?.n ?? 0) };
  });
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
  const numberItem = sub.items.data.find((i) => i.price.lookup_key?.startsWith(NUMBER_KEY_PREFIX));
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
  if (business.comped) throw new BillingError("This account is complimentary: there is nothing to pay.");
  const book = await priceBookFor(business.id);
  const catalog = await ensureCatalog(book);
  const customer = await ensureCustomer(business);
  const number = await withTenant(business.id, (tx) => tx.query.messagingNumbers.findFirst({ where: (t, { isNull }) => isNull(t.releasedAt) }));
  const wanted = desiredItems(book, await billableUsage(business.id));
  const items: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
  for (const d of wanted) items.push({ price: await catalog.priceFor(d.kind, d.cents), quantity: d.quantity });
  items.push({ price: catalog.usagePriceId });
  if (number) items.push({ price: catalog.numberPriceId, quantity: 1 });
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: items,
    payment_method_collection: "always",
    allow_promotion_codes: true,
    subscription_data: {
      metadata: { businessId: business.id, slug },
      ...checkoutTrial(business.trialEndsAt, catalog.config.trialDays),
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

export async function billingState(business: Business) {
  const config = configFromBook(await priceBookFor(business.id));
  const enabled = billingEnabled();
  return {
    enabled,
    config,
    status: business.subscriptionStatus,
    subscribed: isSubscribed(business.subscriptionStatus),
    delinquent: isDelinquent(business.subscriptionStatus),
    comped: business.comped,
    /** Why texts are paused for this business, or null. */
    smsPausedReason: smsPausedReason({ billingEnabled: enabled, comped: business.comped, status: business.subscriptionStatus, smsUsageCents: config.smsUsageCents }),
    canBuyNumber: business.comped || canBuyNumber({ billingEnabled: enabled, status: business.subscriptionStatus, config }),
  };
}

/** Add the monthly number fee to the subscription (prorated). No-op when billing is off or the fee is $0. */
export async function attachNumberItem(business: Business, numberId: string): Promise<void> {
  if (!billingEnabled() || !business.stripeSubscriptionId || business.comped) return;
  const catalog = await ensureCatalog(await priceBookFor(business.id));
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
  const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, businessId), columns: { stripeCustomerId: true, subscriptionStatus: true, comped: true } });
  if (!business?.stripeCustomerId || business.comped || !isSubscribed(business.subscriptionStatus)) return 0;
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
// Keep the subscription in line with the price book
// ---------------------------------------------------------------------------

export interface ReconcileResult {
  created: number;
  updated: number;
  removed: number;
}

/**
 * Make the subscription's base / extra-location / extra-staff items match what the business uses now (quantities)
 * and, for a business with its own pricing deal, the price it was given. Platform-wide price changes deliberately do
 * NOT re-price existing subscribers: they keep the price they signed up at. Changes are prorated.
 */
export async function reconcileSubscription(business: Business): Promise<ReconcileResult> {
  const result: ReconcileResult = { created: 0, updated: 0, removed: 0 };
  if (!billingEnabled() || !business.stripeSubscriptionId || business.comped || !isSubscribed(business.subscriptionStatus)) return result;
  // A suspended business is not charged: pause invoice collection (invoices are voided) until it is reactivated.
  const pausing = await syncSuspendPause(business);
  if (pausing || business.suspendedAt) return result;
  const [book, usage, hasDeal] = await Promise.all([
    priceBookFor(business.id),
    billableUsage(business.id),
    withTenant(business.id, async (tx) => (await tx.select({ id: schema.businessPricing.businessId }).from(schema.businessPricing))[0] !== undefined),
  ]);
  const s = stripe();
  const sub = await s.subscriptions.retrieve(business.stripeSubscriptionId);
  const existing = sub.items.data.map((i) => ({ id: i.id, lookupKey: i.price.lookup_key, quantity: i.quantity ?? 1 }));
  const catalog = await ensureCatalog(book);
  const plan = planChanges(desiredItems(book, usage), existing);
  const proration = "create_prorations" as const;
  for (const c of plan.create) {
    await s.subscriptionItems.create({ subscription: sub.id, price: await catalog.priceFor(c.kind, c.cents), quantity: c.quantity, proration_behavior: proration });
    result.created++;
  }
  for (const u of plan.update) {
    const switchPrice = u.priceChanged && hasDeal;
    if (!u.quantityChanged && !switchPrice) continue;
    await s.subscriptionItems.update(u.id, { quantity: u.desired.quantity, ...(switchPrice ? { price: await catalog.priceFor(u.desired.kind, u.desired.cents) } : {}), proration_behavior: proration });
    result.updated++;
  }
  for (const id of plan.remove) {
    await s.subscriptionItems.del(id, { proration_behavior: proration });
    result.removed++;
  }
  if (result.created + result.updated + result.removed > 0) await refreshSubscription(business);
  return result;
}

/** Pause or resume collection to match the business's suspended state. Returns true when it changed the subscription. */
async function syncSuspendPause(business: Business): Promise<boolean> {
  if (!business.stripeSubscriptionId) return false;
  const s = stripe();
  const sub = await s.subscriptions.retrieve(business.stripeSubscriptionId);
  const action = pauseAction({ suspended: !!business.suspendedAt, paused: !!sub.pause_collection, pausedBySuspend: sub.metadata?.[SUSPEND_PAUSE_MARKER] === "1" });
  if (action === "pause") await s.subscriptions.update(sub.id, { pause_collection: { behavior: "void" }, metadata: { [SUSPEND_PAUSE_MARKER]: "1" } });
  else if (action === "resume") await s.subscriptions.update(sub.id, { pause_collection: "", metadata: { [SUSPEND_PAUSE_MARKER]: "" } });
  return action !== null;
}

/** Daily sweep (called from the jobs route): reconcile every paying business. One failure never stops the rest. */
export async function reconcileAllSubscriptions(): Promise<{ checked: number; changed: number; failed: number }> {
  if (!billingEnabled()) return { checked: 0, changed: 0, failed: 0 };
  const rows = await db.select().from(schema.businesses).where(and(inArray(schema.businesses.subscriptionStatus, ["active", "trialing", "past_due"]), eq(schema.businesses.comped, false)));
  const out = { checked: 0, changed: 0, failed: 0 };
  for (const b of rows) {
    if (!b.stripeSubscriptionId) continue;
    out.checked++;
    try {
      const r = await reconcileSubscription(b);
      if (r.created + r.updated + r.removed > 0) out.changed++;
    } catch (e) {
      out.failed++;
      console.error("[billing] reconcile failed", b.slug, (e as Error).message);
    }
  }
  return out;
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
