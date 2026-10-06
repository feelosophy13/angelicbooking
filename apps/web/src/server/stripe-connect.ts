import { eq } from "drizzle-orm";
import { db, schema } from "@angelic/db";
import { appUrl, stripe } from "@/lib/stripe";

/**
 * Each business connects its OWN Stripe account (Standard). They keep their
 * dashboard, payouts and liability; we create direct charges on their account.
 */
export async function startConnectOnboarding(business: typeof schema.businesses.$inferSelect, slug: string) {
  const s = stripe();
  let accountId = business.stripeAccountId;
  if (!accountId) {
    const acct = await s.accounts.create({
      type: "standard",
      email: business.email ?? undefined,
      business_profile: { name: business.name, mcc: "7230" }, // 7230 = beauty & barber shops
      metadata: { businessId: business.id },
    });
    accountId = acct.id;
    await db.update(schema.businesses).set({ stripeAccountId: accountId }).where(eq(schema.businesses.id, business.id));
  }
  const link = await s.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: appUrl(`/app/${slug}/settings/payments?refresh=1`),
    return_url: appUrl(`/app/${slug}/settings/payments/return`),
  });
  return link.url;
}

/** Pull the latest account capabilities from Stripe into our row. */
export async function syncConnectAccount(businessId: string, accountId: string) {
  const acct = await stripe().accounts.retrieve(accountId);
  await db
    .update(schema.businesses)
    .set({
      stripeChargesEnabled: !!acct.charges_enabled,
      stripeDetailsSubmitted: !!acct.details_submitted,
      stripeAccountId: accountId,
    })
    .where(eq(schema.businesses.id, businessId));
  return { chargesEnabled: !!acct.charges_enabled, detailsSubmitted: !!acct.details_submitted };
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
