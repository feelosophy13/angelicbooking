import "server-only";
import { eq } from "drizzle-orm";
import { schema } from "@angelic/db";
import { DEFAULT_PRICE_BOOK, PRICE_FIELDS, effectivePriceBook, type PriceBook } from "@angelic/core/platform-pricing";
import { adminDb } from "./db";
import { requireAdmin } from "./admin";

export type Overrides = Partial<Record<keyof PriceBook, number | null>>;

function pick(row: Record<string, unknown> | undefined): Overrides {
  const out: Overrides = {};
  for (const k of PRICE_FIELDS) {
    const v = row?.[k];
    out[k] = typeof v === "number" ? v : null;
  }
  return out;
}

/** The default price book: the stored row laid over the built-in defaults. */
export async function getDefaultPriceBook(): Promise<PriceBook> {
  await requireAdmin();
  const [row] = await adminDb().select().from(schema.platformPricing).where(eq(schema.platformPricing.id, "default"));
  return effectivePriceBook(DEFAULT_PRICE_BOOK, pick(row));
}

/** Whether anyone has saved a price book yet. Until then every price is $0 (web and admin agree on that). */
export async function priceBookIsSet(): Promise<boolean> {
  await requireAdmin();
  const [row] = await adminDb().select({ id: schema.platformPricing.id }).from(schema.platformPricing).where(eq(schema.platformPricing.id, "default"));
  return !!row;
}

export async function getOverrides(businessId: string): Promise<{ overrides: Overrides; note: string | null }> {
  await requireAdmin();
  const [row] = await adminDb().select().from(schema.businessPricing).where(eq(schema.businessPricing.businessId, businessId));
  return { overrides: pick(row), note: row?.note ?? null };
}

export async function getAllOverrides(): Promise<Map<string, Overrides>> {
  await requireAdmin();
  const rows = await adminDb().select().from(schema.businessPricing);
  return new Map(rows.map((r) => [r.businessId, pick(r)]));
}

export async function saveDefaultPriceBook(book: PriceBook, actor: string): Promise<void> {
  await requireAdmin();
  const before = await getDefaultPriceBook();
  const db = adminDb();
  await db.transaction(async (tx) => {
    await tx.insert(schema.platformPricing).values({ id: "default", ...book }).onConflictDoUpdate({ target: schema.platformPricing.id, set: { ...book, updatedAt: new Date() } });
    await tx.insert(schema.adminAuditLog).values({ actor, action: "pricing.default.update", detail: { before, after: book } });
  });
}

export async function saveOverrides(businessId: string, overrides: Overrides, note: string | null, actor: string): Promise<void> {
  await requireAdmin();
  const before = await getOverrides(businessId);
  const empty = PRICE_FIELDS.every((k) => overrides[k] == null) && !note;
  await adminDb().transaction(async (tx) => {
    if (empty) {
      await tx.delete(schema.businessPricing).where(eq(schema.businessPricing.businessId, businessId));
    } else {
      const values = { ...overrides, note };
      await tx.insert(schema.businessPricing).values({ businessId, ...values }).onConflictDoUpdate({ target: schema.businessPricing.businessId, set: { ...values, updatedAt: new Date() } });
    }
    await tx.insert(schema.adminAuditLog).values({ actor, action: "pricing.business.update", businessId, detail: { before, after: { overrides, note } } });
  });
}
