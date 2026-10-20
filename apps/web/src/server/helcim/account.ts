import { eq } from "drizzle-orm";
import { db, schema } from "@angelic/db";
type Business = typeof schema.businesses.$inferSelect;
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { helcim, HelcimError } from "./client";

export class HelcimAccountError extends Error {}

/** The business's Helcim API token, or null when Helcim isn't its processor or isn't connected. */
export function helcimTokenOf(business: Pick<Business, "paymentProvider" | "helcimApiToken">): string | null {
  if (business.paymentProvider !== "helcim" || !business.helcimApiToken) return null;
  return decryptSecret(business.helcimApiToken);
}

export function helcimVerifierOf(business: Pick<Business, "helcimWebhookVerifier">): string | null {
  return business.helcimWebhookVerifier ? decryptSecret(business.helcimWebhookVerifier) : null;
}

/**
 * Connect the business's own Helcim account with an API token from its Helcim dashboard (All Tools → Integrations → API Access
 * Configuration), and the webhook verifier token from its webhook settings. The token is tested before it is saved. Connecting makes
 * Helcim the business's card processor; Stripe settings are kept, so switching back is one click.
 */
export async function connectHelcim(businessId: string, input: { apiToken: string; verifierToken: string | null }) {
  const apiToken = input.apiToken.trim();
  if (apiToken.length < 10) throw new HelcimAccountError("Paste the API token from your Helcim dashboard.");
  try {
    await helcim.ping(apiToken);
  } catch (e) {
    if (e instanceof HelcimError && (e.status === 401 || e.status === 403)) throw new HelcimAccountError("Helcim didn't accept that token. Check it was copied in full and has the payment permissions.");
    throw new HelcimAccountError(`Couldn't reach Helcim: ${(e as Error).message}`);
  }
  const verifier = input.verifierToken?.trim() || null;
  await db
    .update(schema.businesses)
    .set({ paymentProvider: "helcim", helcimApiToken: encryptSecret(apiToken), ...(verifier ? { helcimWebhookVerifier: encryptSecret(verifier) } : {}), helcimConnectedAt: new Date() })
    .where(eq(schema.businesses.id, businessId));
}

export async function saveHelcimVerifier(businessId: string, verifierToken: string) {
  const v = verifierToken.trim();
  if (!v) throw new HelcimAccountError("Paste the verifier token from Helcim's webhook settings.");
  await db.update(schema.businesses).set({ helcimWebhookVerifier: encryptSecret(v) }).where(eq(schema.businesses.id, businessId));
}

/** Back to Stripe (its connection, if any, was never removed). The Helcim token is forgotten. */
export async function disconnectHelcim(businessId: string) {
  await db.update(schema.businesses).set({ paymentProvider: "stripe", helcimApiToken: null, helcimWebhookVerifier: null, helcimConnectedAt: null }).where(eq(schema.businesses.id, businessId));
}
