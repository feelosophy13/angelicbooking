import { stripe } from "@/lib/stripe";
import type { PaymentContext } from "./locations";

export class TerminalError extends Error {}

/** A short-lived secret the browser's Terminal SDK uses to talk to readers on this connected account. */
export async function terminalConnectionToken(accountId: string): Promise<string> {
  const t = await stripe().terminal.connectionTokens.create({}, { stripeAccount: accountId });
  return t.secret;
}

/**
 * The Stripe Terminal "location" readers are registered under, on the connected account. Created from the
 * salon location's address the first time (Stripe requires one); the same one is reused afterwards.
 */
export async function terminalLocationFor(accountId: string, pay: PaymentContext): Promise<string> {
  const display = pay.location?.name ?? pay.name;
  const existing = await stripe().terminal.locations.list({ limit: 100 }, { stripeAccount: accountId });
  const match = existing.data.find((l) => l.display_name === display) ?? (existing.data.length === 1 ? existing.data[0] : undefined);
  if (match) return match.id;
  const l = pay.location;
  if (!l?.addressLine1 || !l.city || !l.state || !l.postalCode) {
    throw new TerminalError("Add this location's street address, city, state and zip under Settings → Locations before using a card reader.");
  }
  const created = await stripe().terminal.locations.create(
    { display_name: display, address: { line1: l.addressLine1, ...(l.addressLine2 ? { line2: l.addressLine2 } : {}), city: l.city, state: l.state, postal_code: l.postalCode, country: l.country ?? "US" } },
    { stripeAccount: accountId },
  );
  return created.id;
}
