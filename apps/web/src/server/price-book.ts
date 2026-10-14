/**
 * The price book the platform charges from: the row the admin app saves (platform_pricing), laid over the old
 * BILLING_* / SMS_* env amounts so nothing changes until an admin saves one; then the business's own overrides.
 */
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { DEFAULT_PRICE_BOOK, PRICE_FIELDS, effectivePriceBook, type PriceBook } from "@angelic/core/platform-pricing";
import { billingConfig } from "@/lib/billing-config";

type Row = Partial<Record<keyof PriceBook, number | null>>;

function pick(row: Row | undefined): Row {
  const out: Row = {};
  for (const k of PRICE_FIELDS) out[k] = typeof row?.[k] === "number" ? row[k] : null;
  return out;
}

export async function platformPriceBook(): Promise<PriceBook> {
  const env = billingConfig();
  const fromEnv: PriceBook = { ...DEFAULT_PRICE_BOOK, baseCents: env.baseCents, numberCents: env.numberCents, smsUsageCents: env.smsUsageCents, smsIncluded: env.smsIncluded, trialDays: env.trialDays };
  const [row] = await db.select().from(schema.platformPricing).where(eq(schema.platformPricing.id, "default"));
  return effectivePriceBook(fromEnv, pick(row));
}

export async function priceBookFor(businessId: string): Promise<PriceBook> {
  const [book, override] = await Promise.all([
    platformPriceBook(),
    withTenant(businessId, async (tx) => (await tx.select().from(schema.businessPricing).where(eq(schema.businessPricing.businessId, businessId)))[0]),
  ]);
  return effectivePriceBook(book, pick(override));
}
