import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { schema, withTenant, type TenantDb } from "@angelic/db";
import { deleteFileByUrl } from "@/lib/files";

/**
 * Shared CRUD for service and product categories (same shape, different tables).
 * Service categories can nest (Hair → Colour → Balayage); product categories stay flat.
 */
type Kind = "service" | "product";
const table = (kind: Kind) => (kind === "service" ? schema.serviceCategories : schema.productCategories);
const itemTable = (kind: Kind) => (kind === "service" ? schema.services : schema.products);

export type ServiceCategory = typeof schema.serviceCategories.$inferSelect;
/** The flat shape both kinds share; service categories carry the extra columns. */
export type AnyCategory = { id: string; name: string; sortOrder: number; parentId?: string | null; description?: string | null; imageUrl?: string | null; prepNotes?: string | null };

export async function listCategories(businessId: string, kind: Kind): Promise<AnyCategory[]> {
  const t = table(kind);
  return withTenant(businessId, (tx) => tx.select().from(t).orderBy(asc(t.sortOrder), asc(t.name)));
}

export async function getServiceCategory(businessId: string, id: string) {
  return withTenant(businessId, (tx) => tx.query.serviceCategories.findFirst({ where: eq(schema.serviceCategories.id, id) }));
}

// ---------------------------------------------------------------------------
// Tree helpers (pure; work on the flat list so callers query once)
// ---------------------------------------------------------------------------
export type CategoryNode<T extends AnyCategory = AnyCategory> = T & { children: CategoryNode<T>[]; depth: number };

/** Nest a flat list into a tree ordered by sortOrder then name at every level. Orphans (missing parent) become roots. */
export function buildTree<T extends AnyCategory>(flat: T[]): CategoryNode<T>[] {
  const ids = new Set(flat.map((c) => c.id));
  const byParent = new Map<string | null, T[]>();
  for (const c of flat) {
    const p = c.parentId && ids.has(c.parentId) ? c.parentId : null;
    byParent.set(p, [...(byParent.get(p) ?? []), c]);
  }
  const sortFn = (a: T, b: T) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  const seen = new Set<string>();
  const build = (parent: string | null, depth: number): CategoryNode<T>[] =>
    (byParent.get(parent) ?? [])
      .filter((c) => !seen.has(c.id) && seen.add(c.id))
      .sort(sortFn)
      .map((c) => ({ ...c, depth, children: build(c.id, depth + 1) }));
  return build(null, 0);
}

/** Depth-first flattening of the tree, each node tagged with its depth (for indented pickers). */
export function flattenTree<T extends AnyCategory>(tree: CategoryNode<T>[]): CategoryNode<T>[] {
  const out: CategoryNode<T>[] = [];
  const walk = (nodes: CategoryNode<T>[]) => { for (const n of nodes) { out.push(n); walk(n.children); } };
  walk(tree);
  return out;
}

/** Ancestors from the root down to (and excluding) `id`. */
export function pathTo<T extends AnyCategory>(flat: T[], id: string | null | undefined): T[] {
  const byId = new Map(flat.map((c) => [c.id, c]));
  const out: T[] = [];
  let cur = id ? byId.get(id) : undefined;
  const guard = new Set<string>();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    out.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

/** `id` and every category below it (for "all services in Hair, including sub-menus"). */
export function subtreeIds<T extends AnyCategory>(flat: T[], id: string): string[] {
  const byParent = new Map<string | null, T[]>();
  for (const c of flat) byParent.set(c.parentId ?? null, [...(byParent.get(c.parentId ?? null) ?? []), c]);
  const out: string[] = [];
  const walk = (x: string) => { if (out.includes(x)) return; out.push(x); for (const c of byParent.get(x) ?? []) walk(c.id); };
  walk(id);
  return out;
}

/** True when setting `parentId` on `id` would create a cycle (or self-parent). */
export function wouldCycle<T extends AnyCategory>(flat: T[], id: string, parentId: string | null): boolean {
  if (!parentId) return false;
  if (parentId === id) return true;
  return subtreeIds(flat, id).includes(parentId);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
async function nextSortOrder(tx: TenantDb, kind: Kind, parentId: string | null) {
  const t = table(kind);
  const where = kind === "service" ? (parentId ? eq(schema.serviceCategories.parentId, parentId) : isNull(schema.serviceCategories.parentId)) : undefined;
  const [agg] = await tx.select({ max: sql<number>`coalesce(max(${t.sortOrder}), -1)` }).from(t).where(where);
  return Number(agg?.max ?? -1) + 1;
}

/** Find by name (case-insensitive, among siblings) or create at the end of the list. */
export async function ensureCategory(businessId: string, kind: Kind, name: string, parentId: string | null = null): Promise<string | null> {
  const clean = name.trim();
  if (!clean) return null;
  const t = table(kind);
  return withTenant(businessId, async (tx) => {
    const sameName = sql`lower(${t.name}) = ${clean.toLowerCase()}`;
    const where = kind === "service" ? and(sameName, parentId ? eq(schema.serviceCategories.parentId, parentId) : isNull(schema.serviceCategories.parentId)) : sameName;
    const existing = await tx.select().from(t).where(where).limit(1);
    if (existing[0]) return existing[0].id;
    const sortOrder = await nextSortOrder(tx, kind, parentId);
    const values = kind === "service" ? { businessId, name: clean, sortOrder, parentId } : { businessId, name: clean, sortOrder };
    const [row] = await tx.insert(t).values(values).returning({ id: t.id });
    return row!.id;
  });
}

export async function renameCategory(businessId: string, kind: Kind, id: string, name: string) {
  const t = table(kind);
  await withTenant(businessId, (tx) => tx.update(t).set({ name: name.trim() }).where(eq(t.id, id)));
}

export class CategoryError extends Error {}

/** Full edit for a service category: name, description, parent, image (null keeps, "" clears). */
export async function updateServiceCategory(
  businessId: string,
  id: string,
  input: { name: string; description: string | null; prepNotes?: string | null; parentId: string | null; imageUrl?: string | null },
) {
  await withTenant(businessId, async (tx) => {
    const all = await tx.select().from(schema.serviceCategories);
    const me = all.find((c) => c.id === id);
    if (!me) throw new CategoryError("Category not found.");
    const parentId = input.parentId && all.some((c) => c.id === input.parentId) ? input.parentId : null;
    if (wouldCycle(all, id, parentId)) throw new CategoryError("A category can't be moved inside itself.");
    const moved = (me.parentId ?? null) !== parentId;
    const set: Partial<typeof schema.serviceCategories.$inferInsert> = { name: input.name.trim(), description: input.description, parentId, ...(input.prepNotes !== undefined ? { prepNotes: input.prepNotes } : {}) };
    if (moved) set.sortOrder = await nextSortOrder(tx, "service", parentId);
    if (input.imageUrl !== undefined) {
      if (me.imageUrl && me.imageUrl !== input.imageUrl) await deleteFileByUrl(me.imageUrl);
      set.imageUrl = input.imageUrl || null;
    }
    await tx.update(schema.serviceCategories).set(set).where(eq(schema.serviceCategories.id, id));
  });
}

/** Delete a category; its items become uncategorised and sub-categories move up a level. */
export async function deleteCategory(businessId: string, kind: Kind, id: string) {
  const t = table(kind);
  const it = itemTable(kind);
  await withTenant(businessId, async (tx) => {
    await tx.update(it).set({ categoryId: null }).where(eq(it.categoryId, id));
    if (kind === "service") {
      const me = await tx.query.serviceCategories.findFirst({ where: eq(schema.serviceCategories.id, id) });
      await tx.update(schema.serviceCategories).set({ parentId: me?.parentId ?? null }).where(eq(schema.serviceCategories.parentId, id));
      if (me?.imageUrl) await deleteFileByUrl(me.imageUrl);
    }
    await tx.delete(t).where(eq(t.id, id));
  });
}

/** Move a category one step up or down among its siblings and renumber them. */
export async function moveCategory(businessId: string, kind: Kind, id: string, dir: "up" | "down") {
  const t = table(kind);
  await withTenant(businessId, async (tx) => {
    const all: AnyCategory[] = await tx.select().from(t).orderBy(asc(t.sortOrder), asc(t.name));
    const me = all.find((r) => r.id === id);
    if (!me) return;
    const rows = kind === "service" ? all.filter((r) => (r.parentId ?? null) === (me.parentId ?? null)) : all;
    const i = rows.findIndex((r) => r.id === id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j]!, rows[i]!];
    for (let k = 0; k < rows.length; k++) await tx.update(t).set({ sortOrder: k }).where(eq(t.id, rows[k]!.id));
  });
}
