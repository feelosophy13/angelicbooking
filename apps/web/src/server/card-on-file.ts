import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import type { PaymentContext } from "./locations";
import { savedCardsFor } from "./stripe-connect";
import { chargeCardOnFile, chargeHelcimSavedCard, SaleError } from "./sales";
import { helcimTokenOf } from "./helcim/account";
import { customerCodeFor, savedHelcimCards } from "./helcim/payments";

type Business = typeof schema.businesses.$inferSelect;

export type SavedCard = { id: string; brand: string; last4: string; expMonth: number; expYear: number };

/** A client's saved cards with whichever processor the business uses (the card id is Stripe's payment method or Helcim's card token). */
export async function savedCardsForClient(business: Business, pay: PaymentContext, clientId: string | null | undefined): Promise<SavedCard[]> {
  if (pay.provider === "helcim") return savedHelcimCards(business.id, helcimTokenOf(business), clientId);
  return savedCardsFor(business.id, pay, clientId);
}

/** Charge a saved card toward a ticket (card on file, no-show and late-cancel fees), through the business's processor. */
export async function chargeSavedCard(input: { business: Business; pay: PaymentContext; saleId: string; cardId: string; amountCents: number; actorUserId: string; ipAddress: string }) {
  const { business, pay } = input;
  if (pay.provider === "helcim") {
    const token = helcimTokenOf(business);
    if (!token) throw new SaleError("Connect Helcim under Settings → Payments first.");
    const sale = await withTenant(business.id, (tx) => tx.query.sales.findFirst({ where: eq(schema.sales.id, input.saleId), columns: { clientId: true } }));
    const customer = sale?.clientId ? await customerCodeFor(business.id, sale.clientId) : null;
    if (!customer) throw new SaleError("This client has no saved card in Helcim.");
    return chargeHelcimSavedCard({ businessId: business.id, saleId: input.saleId, token, cardToken: input.cardId, customerCode: customer.code, amountCents: input.amountCents, actorUserId: input.actorUserId, taxRateBps: business.taxRateBps, ipAddress: input.ipAddress });
  }
  if (!pay.accountId || !pay.chargesEnabled) throw new SaleError("Connect Stripe under Settings → Payments first.");
  return chargeCardOnFile({ businessId: business.id, accountId: pay.accountId, saleId: input.saleId, paymentMethodId: input.cardId, amountCents: input.amountCents, actorUserId: input.actorUserId, taxRateBps: business.taxRateBps });
}

/** Whether this location can charge a saved card at all (for showing the fee buttons). */
export const canChargeSavedCards = (pay: PaymentContext) => pay.ready || pay.helcimReady;
