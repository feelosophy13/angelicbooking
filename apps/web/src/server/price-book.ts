/**
 * The price book the platform charges from: the row the admin app saves (platform_pricing), then the business's own
 * overrides. There is no environment fallback: until an admin saves a price book everything is $0, which the admin
 * app says plainly on its Pricing page.
 */
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { DEFAULT_PRICE_BOOK, PRICE_FIELDS, effectivePriceBook, type PriceBook } from "@angelic/core/platform-pricing";

type Row = Partial<Record<keyof PriceBook, number | null>>;

function pick(row: Row | undefined): Row {
  const out: Row = {};
  for (const k of PRICE_FIELDS) out[k] = typeof row?.[k] === "number" ? row[k] : null;
  return out;
}

export async function platformPriceBook(): Promise<PriceBook> {
  const [row] = await db.select().from(schema.platformPricing).where(eq(schema.platformPricing.id, "default"));
  return effectivePriceBook(DEFAULT_PRICE_BOOK, pick(row));
}

export async function priceBookFor(businessId: string): Promise<PriceBook> {
  return (await priceBookDetailFor(businessId)).book;
}

/** The business's price book with its parts: the platform's book and the fields the platform admin set just for this business ("Your pricing"). */
export async function priceBookDetailFor(businessId: string): Promise<{ platform: PriceBook; overrides: Row; book: PriceBook }> {
  const [platform, override] = await Promise.all([
    platformPriceBook(),
    withTenant(businessId, async (tx) => (await tx.select().from(schema.businessPricing).where(eq(schema.businessPricing.businessId, businessId)))[0]),
  ]);
  const overrides = pick(override);
  return { platform, overrides, book: effectivePriceBook(platform, overrides) };
}

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

/** The same price book as priceBookFor, read on an already open tenant transaction (no second connection). */
export async function priceBookIn(tx: Tx, businessId: string): Promise<PriceBook> {
  const [row] = await tx.select().from(schema.platformPricing).where(eq(schema.platformPricing.id, "default"));
  const [own] = await tx.select().from(schema.businessPricing).where(eq(schema.businessPricing.businessId, businessId));
  return effectivePriceBook(effectivePriceBook(DEFAULT_PRICE_BOOK, pick(row)), pick(own));
}

/**
 * The platform fee (basis points) on card payments this business takes: its own price, else the default price book,
 * else 0. Pass the open transaction when called inside one, so no second connection is needed.
 */
export async function platformFeeBpsFor(businessId: string, tx?: Tx): Promise<number> {
  if (!tx) return (await priceBookFor(businessId)).platformFeeBps;
  return (await priceBookIn(tx, businessId)).platformFeeBps;
}
