/**
 * Create a throwaway Accounts v2 connected account in the Stripe sandbox the
 * way the app does, create its onboarding link, read its readiness, then clean
 * up. Usage (from apps/web): pnpm exec tsx --env-file=../../.env scripts/connect-smoke.ts
 */
import { stripe } from "../src/lib/stripe";

async function main() {
  const s = stripe();
  const acct = await s.v2.core.accounts.create({
    display_name: "Smoke Test Salon",
    contact_email: "smoke@example.com",
    dashboard: "full",
    identity: { country: "us" },
    configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
    defaults: { currency: "usd", responsibilities: { fees_collector: "stripe", losses_collector: "stripe" }, locales: ["en-US"] },
    metadata: { smoke: "1" },
    include: ["configuration.merchant", "requirements", "defaults"],
  });
  console.log("created", acct.id, "dashboard", acct.dashboard, "responsibilities", acct.defaults?.responsibilities);
  console.log("card_payments status:", acct.configuration?.merchant?.capabilities?.card_payments?.status);
  console.log("requirements entries:", (acct.requirements?.entries ?? []).length, "summary:", acct.requirements?.summary?.minimum_deadline?.status);
  const link = await s.v2.core.accountLinks.create({
    account: acct.id,
    use_case: { type: "account_onboarding", account_onboarding: { refresh_url: "http://localhost:3001/refresh", return_url: "http://localhost:3001/return" } },
  });
  console.log("onboarding link host:", new URL(link.url).host);
  // v1 interop: the same id works with v1 endpoints (what the checkout code relies on).
  const v1 = await s.accounts.retrieve(acct.id);
  console.log("v1 view:", v1.id, "charges_enabled", v1.charges_enabled, "details_submitted", v1.details_submitted);
  await s.accounts.del(acct.id);
  console.log("deleted test account");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
