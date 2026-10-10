/**
 * Register the two Stripe webhook endpoints for production and copy the Stripe
 * keys + signing secrets to the Render web service, without printing any
 * secret. Idempotent: existing endpoints for the same URL are reused (their
 * events are updated; the signing secret is only available at creation, so a
 * reused endpoint keeps the secret already stored unless --recreate is given).
 *
 * Usage (from apps/web):
 *   pnpm exec tsx --env-file=../../.env scripts/stripe-production-setup.ts [--live] [--recreate] [--deploy] [--stripe-only]
 * --live reads STRIPE_SECRET_LIVE_KEY / NEXT_PUBLIC_STRIPE_PUBLISHABLE_LIVE_KEY and stores the live webhook secrets as
 * STRIPE_WEBHOOK_LIVE_SECRET / STRIPE_BILLING_WEBHOOK_LIVE_SECRET locally; Render always gets the unsuffixed names.
 * Needs STRIPE_SECRET_KEY + NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY in .env and RENDER_API_KEY in the shell.
 * Works with sandbox/test keys (production then runs in Stripe test mode) or live keys.
 */
import fs from "node:fs";
import path from "node:path";
import Stripe from "stripe";

const SERVICE = process.env.RENDER_SERVICE_ID ?? "srv-db3eqnqj9qps73fba1rg";
const APP_URL = "https://app.angelicbooking.com";
const CONNECT_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "account.updated",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "charge.refunded",
  "charge.dispute.created",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.deleted",
];
const BILLING_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
];

const live = process.argv.includes("--live"); // use STRIPE_SECRET_LIVE_KEY / NEXT_PUBLIC_STRIPE_PUBLISHABLE_LIVE_KEY from .env
const recreate = process.argv.includes("--recreate");
const stripeOnly = process.argv.includes("--stripe-only"); // create endpoints + update .env, leave Render alone
const deploy = process.argv.includes("--deploy");
const mask = (v: string) => `${v.slice(0, 8)}…(${v.length} chars)`;

function need(name: string): string {
  const v = process.env[name];
  if (!v || v.endsWith("...")) throw new Error(`${name} is not set in .env`);
  return v;
}

const secretKey = need(live ? "STRIPE_SECRET_LIVE_KEY" : "STRIPE_SECRET_KEY");
const publishableKey = process.env[live ? "NEXT_PUBLIC_STRIPE_PUBLISHABLE_LIVE_KEY" : "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"] ?? "";
const renderKey = process.env.RENDER_API_KEY ?? "";
const mode = /^[sr]k_live_/.test(secretKey) ? "LIVE" : "TEST";
const envSuffix = live ? "_LIVE" : "";
const stripe = new Stripe(secretKey, { typescript: true });

async function ensureEndpoint(url: string, events: Stripe.WebhookEndpointCreateParams.EnabledEvent[], connect: boolean, existingSecretEnv: string): Promise<string | null> {
  const all = await stripe.webhookEndpoints.list({ limit: 100 });
  const found = all.data.find((e) => e.url === url);
  if (found && !recreate) {
    await stripe.webhookEndpoints.update(found.id, { enabled_events: events, disabled: false });
    console.log(`${connect ? "Connect" : "Account"} endpoint exists (${found.id}); events updated, secret kept`);
    const current = process.env[existingSecretEnv];
    return current && current.startsWith("whsec_") && !current.includes("local") && !current.endsWith("...") ? current : null;
  }
  if (found) {
    await stripe.webhookEndpoints.del(found.id);
    console.log(`Deleted old endpoint ${found.id}`);
  }
  const created = await stripe.webhookEndpoints.create({ url, enabled_events: events, connect, description: `Angelic Booking ${connect ? "Connect" : "platform billing"} (${mode})` });
  console.log(`Created ${connect ? "Connect" : "Account"} endpoint ${created.id} → ${url}`);
  return created.secret ?? null;
}

async function renderPut(key: string, value: string) {
  const r = await fetch(`https://api.render.com/v1/services/${SERVICE}/env-vars/${key}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${renderKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!r.ok) throw new Error(`Render PUT ${key} failed: ${r.status} ${await r.text()}`);
  console.log(`Render env ${key} = ${mask(value)}`);
}

function upsertEnvFile(updates: Record<string, string>) {
  const file = path.resolve(process.cwd(), "../../.env");
  let text = fs.readFileSync(file, "utf8");
  for (const [k, v] of Object.entries(updates)) {
    const line = `${k}=${v}`;
    text = new RegExp(`^${k}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${k}=.*$`, "m"), line) : `${text.trimEnd()}\n${line}\n`;
  }
  fs.writeFileSync(file, text);
  console.log(`.env updated: ${Object.keys(updates).join(", ")}`);
}

async function main() {
  console.log(`Stripe mode: ${mode} (${mask(secretKey)})`);
  const acct = await stripe.accounts.retrieve(null);
  console.log(`Platform account: ${acct.id} charges_enabled=${acct.charges_enabled} details_submitted=${acct.details_submitted}`);
  if (mode === "LIVE" && !(acct.charges_enabled && acct.details_submitted)) console.log("WARNING: the live account is not activated yet; card payments will fail until Stripe finishes activation.");
  const connectSecret = await ensureEndpoint(`${APP_URL}/api/stripe/webhook`, CONNECT_EVENTS, true, `STRIPE_WEBHOOK${envSuffix}_SECRET`);
  const billingSecret = await ensureEndpoint(`${APP_URL}/api/stripe/billing`, BILLING_EVENTS, false, `STRIPE_BILLING_WEBHOOK${envSuffix}_SECRET`);
  if (!connectSecret || !billingSecret) throw new Error("No signing secret available for an existing endpoint; rerun with --recreate");

  const env: Record<string, string> = {
    STRIPE_SECRET_KEY: secretKey,
    STRIPE_WEBHOOK_SECRET: connectSecret,
    STRIPE_BILLING_WEBHOOK_SECRET: billingSecret,
    ...(publishableKey ? { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: publishableKey } : {}),
  };
  if (!publishableKey) console.log(`WARNING: no publishable key in .env (${live ? "NEXT_PUBLIC_STRIPE_PUBLISHABLE_LIVE_KEY" : "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"}); the browser card forms need it.`);
  upsertEnvFile({ [`STRIPE_WEBHOOK${envSuffix}_SECRET`]: connectSecret, [`STRIPE_BILLING_WEBHOOK${envSuffix}_SECRET`]: billingSecret });
  if (stripeOnly) {
    console.log("Stripe side done. Copy STRIPE_SECRET_KEY, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_BILLING_WEBHOOK_SECRET from .env to Render, then deploy.");
    return;
  }
  if (!renderKey) throw new Error("RENDER_API_KEY is not set");
  for (const [k, v] of Object.entries(env)) await renderPut(k, v);

  if (deploy) {
    const r = await fetch(`https://api.render.com/v1/services/${SERVICE}/deploys`, { method: "POST", headers: { Authorization: `Bearer ${renderKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ clearCache: "do_not_clear" }) });
    console.log(`Deploy: ${r.status} ${r.ok ? (await r.json()).id : await r.text()}`);
  } else {
    console.log("Env vars set but NOT deployed (NEXT_PUBLIC_* is baked at build time): rerun with --deploy or trigger a deploy.");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
