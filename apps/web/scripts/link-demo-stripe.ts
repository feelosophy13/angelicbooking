/**
 * Point both demo businesses at the demo Stripe sandbox account, so card checkout, the card reader and online deposits can be tried on
 * them. Needs DEMO_ACCOUNT_STRIPE_SECRET_TEST_KEY and DEMO_ACCOUNT_STRIPE_PUBLISHABLE_TEST_KEY in .env (test keys); see src/lib/stripe-demo.ts.
 * A Stripe account id can belong to one business only, so demo-salon gets it as its main account and each demo-twosites location gets it
 * as that location's own account (location accounts may repeat). Webhooks for the account route to demo-salon, so a demo-twosites payment
 * that only a webhook would settle stays pending locally; the checkout pages settle their own payments. Run after seeding (pnpm demo:refresh does). Refuses anything but a local database. Usage (from apps/web):
 *   ../../packages/db/node_modules/.bin/tsx --env-file=../../.env scripts/link-demo-stripe.ts
 */
import { createRequire } from "node:module";
import { demoAccountId, demoStripeConfigured } from "../src/lib/stripe-demo";

// `postgres` is the db package's driver; apps/web does not depend on it directly, so it is loaded at run time.
const postgres = createRequire(import.meta.url)("postgres") as (url: string, opts: object) => any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL ?? "")) throw new Error("Refusing to run against a non-local database.");
  if (!demoStripeConfigured()) {
    console.log("Demo Stripe keys are not set; leaving demo-salon unconnected.");
    return;
  }
  const id = await demoAccountId();
  if (!id) throw new Error("The demo Stripe key was rejected by Stripe.");
  // The owner connection: the app's own role is row-level-security scoped and can't update businesses across tenants.
  const sql = postgres(process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL!, { max: 1, prepare: false });
  const rows = (await sql`update businesses set stripe_account_id = ${id}, stripe_charges_enabled = true, stripe_details_submitted = true, updated_at = now() where slug = 'demo-salon' returning slug`) as { slug: string }[];
  const sites = (await sql`update locations set stripe_account_id = ${id}, stripe_charges_enabled = true, stripe_details_submitted = true, updated_at = now() where business_id = (select id from businesses where slug = 'demo-twosites') returning name`) as { name: string }[];
  await sql.end();
  console.log(rows.length ? `Linked demo-salon to the demo Stripe account ${id}.` : "demo-salon not found; run the seed first.");
  console.log(sites.length ? `Linked demo-twosites (${sites.map((s) => s.name).join(", ")}) to the same account, per location.` : "demo-twosites not found; run the seed with --profile glow first.");
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
