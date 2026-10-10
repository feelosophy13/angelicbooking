import { eq } from "drizzle-orm";
import { db, schema } from "@angelic/db";
import { appUrl, stripe } from "@/lib/stripe";

/**
 * Each business connects its OWN Stripe account, created with the Accounts v2
 * API in the SaaS configuration: full Stripe Dashboard, Stripe collects its own
 * fees from the account and carries negative-balance liability, and we create
 * direct charges on the account (the business is the merchant of record).
 * Stripe no longer allows `accounts.create({ type: "standard" })` for new
 * Connect integrations; v2 account ids still work with every v1 endpoint via
 * the Stripe-Account header, so the payment code is unchanged.
 */
export async function startConnectOnboarding(business: typeof schema.businesses.$inferSelect, slug: string) {
  const s = stripe();
  let accountId = business.stripeAccountId;
  if (!accountId) {
    const acct = await s.v2.core.accounts.create({
      display_name: business.name,
      contact_email: business.email ?? undefined,
      dashboard: "full",
      identity: { country: "us" },
      configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
      defaults: { currency: "usd", responsibilities: { fees_collector: "stripe", losses_collector: "stripe" }, locales: ["en-US"] },
      metadata: { businessId: business.id, slug },
    });
    accountId = acct.id;
    await db.update(schema.businesses).set({ stripeAccountId: accountId }).where(eq(schema.businesses.id, business.id));
  }
  const link = await s.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        refresh_url: appUrl(`/app/${slug}/settings/payments?refresh=1`),
        return_url: appUrl(`/app/${slug}/settings/payments/return`),
      },
    },
  });
  return link.url;
}

/**
 * Pull the account's readiness from Stripe into our row.
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
    .set({ stripeChargesEnabled: chargesEnabled, stripeDetailsSubmitted: detailsSubmitted, stripeAccountId: accountId })
    .where(eq(schema.businesses.id, businessId));
  return { chargesEnabled, detailsSubmitted };
}

export async function disconnectConnectAccount(businessId: string) {
  await db
    .update(schema.businesses)
    .set({ stripeAccountId: null, stripeChargesEnabled: false, stripeDetailsSubmitted: false })
    .where(eq(schema.businesses.id, businessId));
}

/** Find-or-create the Stripe Customer for a client ON THE BUSINESS'S account. */
export async function ensureStripeCustomer(opts: {
  accountId: string;
  businessId: string;
  client: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; stripeCustomerId: string | null };
  tx: { update: typeof db.update };
}) {
  if (opts.client.stripeCustomerId) return opts.client.stripeCustomerId;
  const c = await stripe().customers.create(
    {
      name: `${opts.client.firstName} ${opts.client.lastName}`.trim(),
      email: opts.client.email ?? undefined,
      phone: opts.client.phone ?? undefined,
      metadata: { clientId: opts.client.id, businessId: opts.businessId },
    },
    { stripeAccount: opts.accountId },
  );
  await opts.tx.update(schema.clients).set({ stripeCustomerId: c.id }).where(eq(schema.clients.id, opts.client.id));
  return c.id;
}

/** Saved cards for a client (lives on the connected account). */
export async function listSavedCards(accountId: string, customerId: string) {
  const pms = await stripe().paymentMethods.list({ customer: customerId, type: "card", limit: 10 }, { stripeAccount: accountId });
  return pms.data.map((pm) => ({
    id: pm.id,
    brand: pm.card?.brand ?? "card",
    last4: pm.card?.last4 ?? "",
    expMonth: pm.card?.exp_month ?? 0,
    expYear: pm.card?.exp_year ?? 0,
  }));
}
