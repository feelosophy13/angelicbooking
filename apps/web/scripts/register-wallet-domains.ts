/**
 * Register the booking site's domains for Apple Pay and Google Pay on every connected Stripe account that can take charges (each business's
 * main account and each location's own), for accounts connected before this ran on its own (see src/server/payment-domains.ts). Safe to
 * run again: a domain already registered and active is skipped. Prints what Stripe said for each. Usage (from apps/web):
 *   ../../packages/db/node_modules/.bin/tsx --env-file=../../.env scripts/register-wallet-domains.ts [business-slug]
 * On Render, run it from the web service's shell with the same command (no --env-file there).
 */
import { createRequire } from "node:module";
import { registerWalletDomains, walletDomainsFor } from "../src/server/payment-domains";

// `postgres` is the db package's driver; apps/web does not depend on it directly, so it is loaded at run time.
const postgres = createRequire(import.meta.url)("postgres") as (url: string, opts: object) => any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function main() {
  const only = process.argv[2] ?? null;
  // The owner connection: the app role is row-level-security scoped and can't read every business's locations.
  const sql = postgres(process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL!, { max: 1, prepare: false });
  const rows = (await sql`
    select b.slug, b.custom_domain as "customDomain", b.custom_domain_status as "customDomainStatus", a.account_id as "accountId"
    from businesses b
    join lateral (
      select b.stripe_account_id as account_id where b.stripe_account_id is not null and b.stripe_charges_enabled
      union
      select l.stripe_account_id from locations l where l.business_id = b.id and l.stripe_account_id is not null and l.stripe_charges_enabled
    ) a on true
    where b.payment_provider <> 'helcim' and (${only}::text is null or b.slug = ${only})
    order by b.slug`) as { slug: string; customDomain: string | null; customDomainStatus: string; accountId: string }[];
  await sql.end();
  if (!rows.length) console.log("No connected Stripe accounts that can take charges.");
  for (const r of rows) {
    const domains = walletDomainsFor(r);
    if (!domains.length) {
      console.log(`${r.slug} ${r.accountId}: no public domain to register (NEXT_PUBLIC_APP_URL is local?)`);
      continue;
    }
    for (const d of await registerWalletDomains(r.accountId, domains)) {
      console.log(`${r.slug} ${r.accountId} ${d.domain}: ${d.ok ? `Apple Pay ${d.applePay}, Google Pay ${d.googlePay}` : "failed"}${d.error ? ` (${d.error})` : ""}`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
