/**
 * The demo salons' Stripe account (local and demo use only).
 *
 * Real salons connect through Stripe Connect: the platform key acts on their account with a `Stripe-Account` header. The demo account is a
 * separate sandbox that is NOT connected to the platform, so the platform key cannot act on it. When DEMO_ACCOUNT_STRIPE_SECRET_TEST_KEY and
 * DEMO_ACCOUNT_STRIPE_PUBLISHABLE_TEST_KEY are set (test keys only, never in production), any request meant for the demo account is sent with its
 * own key instead, and the browser is given its publishable key. Everything else about checkout stays the same. Nothing here runs without those variables.
 */

const SK = () => process.env.DEMO_ACCOUNT_STRIPE_SECRET_TEST_KEY ?? "";
const PK = () => process.env.DEMO_ACCOUNT_STRIPE_PUBLISHABLE_TEST_KEY ?? "";

export function demoStripeConfigured(): boolean {
  return process.env.NODE_ENV !== "production" && /^sk_test_/.test(SK()) && /^pk_test_/.test(PK());
}

let accountId: Promise<string | null> | null = null;

/** The demo account's own id (acct_…), asked of Stripe once with its key and remembered. */
export function demoAccountId(): Promise<string | null> {
  if (!demoStripeConfigured()) return Promise.resolve(null);
  accountId ??= fetch("https://api.stripe.com/v1/account", { headers: { Authorization: `Bearer ${SK()}` }, cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<{ id?: string }>) : null))
    .then((a) => a?.id ?? null)
    .catch(() => null);
  return accountId;
}

/** `fetch` for the Stripe SDK: a request for the demo account swaps the platform key and `Stripe-Account` header for the demo account's own key. */
export async function routingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (demoStripeConfigured()) {
    const headers = new Headers(init?.headers);
    const target = headers.get("Stripe-Account");
    if (target && target === (await demoAccountId())) {
      headers.delete("Stripe-Account");
      headers.set("Authorization", `Bearer ${SK()}`);
      return fetch(input, { ...init, headers });
    }
  }
  return fetch(input, init);
}

/**
 * What the browser needs to load Stripe.js for a payment on `account`: normally the platform's publishable key plus the account to act on;
 * for the demo account its own publishable key and no account (the key already is the account).
 */
export async function browserStripe(account: string, platformKey: string | null | undefined): Promise<{ publishableKey: string | null; stripeAccount: string | null }> {
  if (demoStripeConfigured() && account === (await demoAccountId())) return { publishableKey: PK(), stripeAccount: null };
  return { publishableKey: platformKey ?? null, stripeAccount: account };
}
