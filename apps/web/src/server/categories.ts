import { asc, eq, sql } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";

/** Shared CRUD for service and product categories (same shape, different tables). */
type Kind = "service" | "product";
const table = (kind: Kind) => (kind === "service" ? schema.serviceCategories : schema.productCategories);
const itemTable = (kind: Kind) => (kind === "service" ? schema.services : schema.products);

export async function listCategories(businessId: string, kind: Kind) {
  const t = table(kind);
  return withTenant(businessId, (tx) => tx.select().from(t).orderBy(asc(t.sortOrder), asc(t.name)));
}

/** Find by name (case-insensitive) or create at the end of the list. */
export async function ensureCategory(businessId: string, kind: Kind, name: string): Promise<string | null> {
  const clean = name.trim();
  if (!clean) return null;
  const t = table(kind);
  return withTenant(businessId, async (tx) => {
    const existing = await tx.select().from(t).where(sql`lower(${t.name}) = ${clean.toLowerCase()}`).limit(1);
    if (existing[0]) return existing[0].id;
    const [agg] = await tx.select({ max: sql<number>`coalesce(max(${t.sortOrder}), -1)` }).from(t);
    const [row] = await tx.insert(t).values({ businessId, name: clean, sortOrder: Number(agg?.max ?? -1) + 1 }).returning({ id: t.id });
    return row!.id;
  });
}

export async function renameCategory(businessId: string, kind: Kind, id: string, name: string) {
  const t = table(kind);
  await withTenant(businessId, (tx) => tx.update(t).set({ name: name.trim() }).where(eq(t.id, id)));
}

/** Delete a category; its items become uncategorised. */
export async function deleteCategory(businessId: string, kind: Kind, id: string) {
  const t = table(kind);
  const it = itemTable(kind);
  await withTenant(businessId, async (tx) => {
    await tx.update(it).set({ categoryId: null }).where(eq(it.categoryId, id));
    await tx.delete(t).where(eq(t.id, id));
  });
}

/** Move a category one step up or down and renumber the whole list. */
export async function moveCategory(businessId: string, kind: Kind, id: string, dir: "up" | "down") {
  const t = table(kind);
  await withTenant(businessId, async (tx) => {
    const rows = await tx.select().from(t).orderBy(asc(t.sortOrder), asc(t.name));
    const i = rows.findIndex((r) => r.id === id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j]!, rows[i]!];
    for (let k = 0; k < rows.length; k++) await tx.update(t).set({ sortOrder: k }).where(eq(t.id, rows[k]!.id));
  });
}
