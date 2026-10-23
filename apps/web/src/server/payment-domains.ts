/**
 * Apple Pay and Google Pay on the booking page and store. Salons take money on their own Stripe accounts (direct charges), and Stripe
 * shows a wallet button only on a domain registered with the payment method domains API on the account that takes the money. So every
 * account that sells online (the business's main account and any location's own account) gets every domain the booking site is shown on:
 * the app's own host and, once it is live, the business's custom domain. Apple's own check reads
 * /.well-known/apple-developer-merchantid-domain-association, served from public/ on every host (see proxy.ts).
 *
 * Runs when an account becomes able to take charges (syncConnectAccount) and when a custom domain becomes active (custom-domain.ts), and
 * by scripts/register-wallet-domains.ts for accounts that were connected before this existed. Failures are logged and kept in
 * stripe_payment_domains; they never stop a payment.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { appUrl, isStripeConfigured, stripe } from "@/lib/stripe";

type Business = typeof schema.businesses.$inferSelect;

/** Hosts Stripe can't register: local ones and bare IPs. */
export function registrableHost(host: string): boolean {
  const h = host.toLowerCase();
  if (!h.includes(".") || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".test") || h.endsWith(".local")) return false;
  return !/^\d+\.\d+\.\d+\.\d+$/.test(h) && !h.includes(":");
}

/** Every domain this business's booking site and store are shown on. */
export function walletDomainsFor(b: Pick<Business, "customDomain" | "customDomainStatus">): string[] {
  const out = new Set<string>();
  try {
    out.add(new URL(appUrl()).hostname.toLowerCase());
  } catch {
    // no app URL configured
  }
  if (b.customDomain && (b.customDomainStatus === "active" || b.customDomainStatus === "manual")) out.add(b.customDomain.toLowerCase());
  return [...out].filter(registrableHost);
}

type DomainResult = { domain: string; ok: boolean; applePay: string | null; googlePay: string | null; error?: string };

/** Register `domains` on one Stripe account (or find them already there) and record what Stripe says about each. */
export async function registerWalletDomains(accountId: string, domains: string[]): Promise<DomainResult[]> {
  if (!isStripeConfigured()) return [];
  const opts = { stripeAccount: accountId };
  const out: DomainResult[] = [];
  for (const domain of domains) {
    const known = await db.query.stripePaymentDomains.findFirst({ where: and(eq(schema.stripePaymentDomains.accountId, accountId), eq(schema.stripePaymentDomains.domain, domain), isNotNull(schema.stripePaymentDomains.stripeDomainId)) });
    if (known && known.applePayStatus === "active" && known.googlePayStatus === "active") {
      out.push({ domain, ok: true, applePay: known.applePayStatus, googlePay: known.googlePayStatus });
      continue;
    }
    try {
      let pmd = (await stripe().paymentMethodDomains.list({ domain_name: domain, limit: 1 }, opts)).data[0];
      pmd ??= await stripe().paymentMethodDomains.create({ domain_name: domain, enabled: true }, opts);
      if (!pmd.enabled) pmd = await stripe().paymentMethodDomains.update(pmd.id, { enabled: true }, opts);
      // Apple Pay checks the association file when the domain is added; a domain added before the file was served is checked again here.
      if (pmd.apple_pay.status !== "active") pmd = await stripe().paymentMethodDomains.validate(pmd.id, {}, opts);
      const row = { accountId, domain, livemode: pmd.livemode, stripeDomainId: pmd.id, applePayStatus: pmd.apple_pay.status, googlePayStatus: pmd.google_pay.status, error: pmd.apple_pay.status_details?.error_message ?? null, updatedAt: new Date() };
      await db.insert(schema.stripePaymentDomains).values(row).onConflictDoUpdate({ target: [schema.stripePaymentDomains.accountId, schema.stripePaymentDomains.domain, schema.stripePaymentDomains.livemode], set: row });
      out.push({ domain, ok: true, applePay: row.applePayStatus, googlePay: row.googlePayStatus, ...(row.error ? { error: row.error } : {}) });
    } catch (e) {
      const message = (e as Error).message;
      console.error("[wallet-domains] could not register", domain, "on", accountId, message);
      const livemode = (process.env.STRIPE_SECRET_KEY ?? "").includes("_live_");
      const row = { accountId, domain, livemode, error: message.slice(0, 500), updatedAt: new Date() };
      await db.insert(schema.stripePaymentDomains).values(row).onConflictDoUpdate({ target: [schema.stripePaymentDomains.accountId, schema.stripePaymentDomains.domain, schema.stripePaymentDomains.livemode], set: row }).catch(() => undefined);
      out.push({ domain, ok: false, applePay: null, googlePay: null, error: message });
    }
  }
  return out;
}

/** Every Stripe account this business sells on (main and per-location), each with every domain its booking site is shown on. */
export async function registerWalletDomainsForBusiness(businessId: string): Promise<{ accountId: string; results: DomainResult[] }[]> {
  const b = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, businessId) });
  if (!b || b.paymentProvider === "helcim") return [];
  const locs = await withTenant(businessId, (tx) => tx.select({ accountId: schema.locations.stripeAccountId, ready: schema.locations.stripeChargesEnabled }).from(schema.locations).where(isNotNull(schema.locations.stripeAccountId)));
  const accounts = new Set<string>();
  if (b.stripeAccountId && b.stripeChargesEnabled) accounts.add(b.stripeAccountId);
  for (const l of locs) if (l.accountId && l.ready) accounts.add(l.accountId);
  const domains = walletDomainsFor(b);
  if (!domains.length) return [];
  const out = [];
  for (const accountId of accounts) out.push({ accountId, results: await registerWalletDomains(accountId, domains) });
  return out;
}

/** Fire and forget, for the paths that must not wait on Stripe (a webhook, the onboarding return page, a domain check). */
export function registerWalletDomainsLater(businessId: string) {
  void registerWalletDomainsForBusiness(businessId).catch((e) => console.error("[wallet-domains] failed for", businessId, (e as Error).message));
}
