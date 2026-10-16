import { eq, and } from "drizzle-orm";
import { db, schema, withTenant, type TenantDb } from "@angelic/db";
import { appUrl, stripe } from "@/lib/stripe";

type Business = typeof schema.businesses.$inferSelect;
type Location = typeof schema.locations.$inferSelect;

/**
 * Each business connects its OWN Stripe account, created with the Accounts v2
 * API in the SaaS configuration: full Stripe Dashboard, Stripe collects its own
 * fees from the account and carries negative-balance liability, and we create
 * direct charges on the account (the business is the merchant of record).
 * Stripe no longer allows `accounts.create({ type: "standard" })` for new
 * Connect integrations; v2 account ids still work with every v1 endpoint via
 * the Stripe-Account header, so the payment code is unchanged.
 *
 * A location that is a separate legal entity can connect its own account; it
 * is stored on the location row and used for everything sold at that location.
 */
export async function startConnectOnboarding(business: Business, slug: string, location?: Location | null) {
  const s = stripe();
  let accountId = location ? location.stripeAccountId : business.stripeAccountId;
  if (!accountId) {
    const acct = await s.v2.core.accounts.create({
      display_name: location ? location.name : business.name,
      contact_email: business.email ?? undefined,
      dashboard: "full",
      identity: { country: "us" },
      configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
      defaults: { currency: "usd", responsibilities: { fees_collector: "stripe", losses_collector: "stripe" }, locales: ["en-US"] },
      metadata: { businessId: business.id, slug, ...(location ? { locationId: location.id } : {}) },
    });
    accountId = acct.id;
    if (location) await withTenant(business.id, (tx) => tx.update(schema.locations).set({ stripeAccountId: accountId }).where(eq(schema.locations.id, location.id)));
    else await db.update(schema.businesses).set({ stripeAccountId: accountId }).where(eq(schema.businesses.id, business.id));
  }
  const q = location ? `location=${location.id}` : "";
  const link = await s.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        refresh_url: appUrl(`/app/${slug}/settings/payments?refresh=1${q ? `&${q}` : ""}`),
        return_url: appUrl(`/app/${slug}/settings/payments/return${q ? `?${q}` : ""}`),
      },
    },
  });
  return link.url;
}

/**
 * Pull the account's readiness from Stripe into whichever row holds it (the
 * business's main account or a location's own account).
 * - chargesEnabled: the merchant card_payments capability is active (v2 status path).
 * - detailsSubmitted: nothing is currently or past due from the user, i.e. onboarding
 *   is complete even if Stripe is still verifying.
 */
export async function syncConnectAccount(businessId: string, accountId: string) {
  const acct = await stripe().v2.core.accounts.retrieve(accountId, { include: ["configuration.merchant", "requirements"] });
  const chargesEnabled = acct.configuration?.merchant?.capabilities?.card_payments?.status === "active";
  const entries = acct.requirements?.entries ?? [];
  const outstanding = entries.some((e) => e.awaiting_action_from === "user" && (e.minimum_deadline.status === "currently_due" || e.minimum_deadline.status === "past_due"));
  const detailsSubmitted = chargesEnabled || (entries.length > 0 ? !outstanding : false);
  await db
    .update(schema.businesses)
    .set({ stripeChargesEnabled: chargesEnabled, stripeDetailsSubmitted: detailsSubmitted })
    .where(and(eq(schema.businesses.id, businessId), eq(schema.businesses.stripeAccountId, accountId)));
  await withTenant(businessId, (tx) => tx.update(schema.locations).set({ stripeChargesEnabled: chargesEnabled, stripeDetailsSubmitted: detailsSubmitted }).where(eq(schema.locations.stripeAccountId, accountId)));
  return { chargesEnabled, detailsSubmitted };
}

/** Forget the account (the business's main one, or a location's own so it falls back to the main account). */
export async function disconnectConnectAccount(businessId: string, locationId?: string | null) {
  if (locationId) {
    await withTenant(businessId, (tx) => tx.update(schema.locations).set({ stripeAccountId: null, stripeChargesEnabled: false, stripeDetailsSubmitted: false }).where(eq(schema.locations.id, locationId)));
    return;
  }
  await db
    .update(schema.businesses)
    .set({ stripeAccountId: null, stripeChargesEnabled: false, stripeDetailsSubmitted: false })
    .where(eq(schema.businesses.id, businessId));
}

/** The client's Stripe Customer on one connected account, if one exists. */
export async function customerIdFor(tx: TenantDb, clientId: string, accountId: string | null): Promise<string | null> {
  if (!accountId) return null;
  const row = await tx.query.clientStripeCustomers.findFirst({ where: and(eq(schema.clientStripeCustomers.clientId, clientId), eq(schema.clientStripeCustomers.stripeAccountId, accountId)) });
  return row?.customerId ?? null;
}

/** Find-or-create the Stripe Customer for a client ON THE GIVEN CONNECTED ACCOUNT. */
/** The client's Stripe customer on this account, created on first use. The Stripe call runs with no transaction open. */
export async function ensureStripeCustomer(opts: {
  accountId: string;
  businessId: string;
  client: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null };
}) {
  const existing = await withTenant(opts.businessId, (tx) => customerIdFor(tx, opts.client.id, opts.accountId));
  if (existing) return existing;
  const c = await stripe().customers.create(
    {
      name: `${opts.client.firstName} ${opts.client.lastName}`.trim(),
      email: opts.client.email ?? undefined,
      phone: opts.client.phone ?? undefined,
      metadata: { clientId: opts.client.id, businessId: opts.businessId },
    },
    { stripeAccount: opts.accountId, idempotencyKey: `customer_${opts.accountId}_${opts.client.id}` },
  );
  await withTenant(opts.businessId, (tx) =>
    tx.insert(schema.clientStripeCustomers).values({ businessId: opts.businessId, clientId: opts.client.id, stripeAccountId: opts.accountId, customerId: c.id }).onConflictDoNothing(),
  );
  // Two first uses at once: keep whichever was saved first.
  return (await withTenant(opts.businessId, (tx) => customerIdFor(tx, opts.client.id, opts.accountId))) ?? c.id;
}

export interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  /** Which connected account holds the card (set when listed across several). */
  accountId?: string;
  /** Merchant name for that account, for labelling. */
  siteName?: string;
}

/** Saved cards for a client (lives on the connected account). */
export async function listSavedCards(accountId: string, customerId: string): Promise<SavedCard[]> {
  const pms = await stripe().paymentMethods.list({ customer: customerId, type: "card", limit: 10 }, { stripeAccount: accountId });
  return pms.data.map((pm) => ({
    id: pm.id,
    brand: pm.card?.brand ?? "card",
    last4: pm.card?.last4 ?? "",
    expMonth: pm.card?.exp_month ?? 0,
    expYear: pm.card?.exp_year ?? 0,
  }));
}

/** Saved cards a client has on a payment context's account; empty when Stripe isn't ready there. */
export async function savedCardsFor(businessId: string, pay: { accountId: string | null; ready: boolean }, clientId: string | null | undefined): Promise<SavedCard[]> {
  if (!pay.ready || !pay.accountId || !clientId) return [];
  const customerId = await withTenant(businessId, (tx) => customerIdFor(tx, clientId, pay.accountId));
  if (!customerId) return [];
  return listSavedCards(pay.accountId, customerId).catch(() => []);
}
