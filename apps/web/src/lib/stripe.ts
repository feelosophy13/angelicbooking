import Stripe from "stripe";

let client: Stripe | null = null;

/** True when a platform secret key is configured. UI degrades gracefully otherwise. */
export function isStripeConfigured(): boolean {
  const k = process.env.STRIPE_SECRET_KEY;
  return !!k && /^sk_(test|live)_/.test(k) && !k.endsWith("...");
}

export function stripe(): Stripe {
  if (!isStripeConfigured()) throw new StripeNotConfigured();
  if (!client) {
    client = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      appInfo: { name: "Angelic Booking", version: "0.1.0" },
      typescript: true,
    });
  }
  return client;
}

export class StripeNotConfigured extends Error {
  constructor() {
    super("Stripe is not configured. Set STRIPE_SECRET_KEY in .env.");
  }
}

/** Optional platform fee on each direct charge, in basis points (e.g. 100 = 1%). */
export function platformFeeBps(): number {
  const n = Number(process.env.PLATFORM_FEE_BPS ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

export function appUrl(path = ""): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3001";
  return `${base}${path}`;
}
