/**
 * Products that come in options (sizes, shades). A group holds what the options share; each option is an ordinary products row
 * (its own price, cost, SKU, barcode, stock and levels) whose name and shared details are kept equal to the group's, so the register,
 * the online store, scanning, orders and reports all keep working on options exactly as on any product.
 */
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { schema, withTenant, type TenantDb } from "@angelic/db";
import { newLabels } from "@/lib/variants";
import { matchProduct } from "@/lib/scan";
import { productLabel } from "@/lib/inventory";

export class GroupError extends Error {}

type Group = typeof schema.productGroups.$inferSelect;
type Shared = { name: string; description: string | null; imageUrl: string | null; categoryId: string | null; kind: "retail" | "backbar"; taxable: boolean; sellOnline: boolean; supplierId: string | null };
export type OptionDefaults = { priceCents?: number | null; costCents?: number | null; lowStockThreshold?: number | null; reorderUpTo?: number | null; trackStock?: boolean | null };

/**
 * Copy what the options share onto every option of the group. The photo is shared only by options that don't have a photo of their own:
 * one with its own picture keeps it when the product's picture changes. (An option has its own picture when it differs from the product's.)
 */
async function syncOptions(tx: TenantDb, g: Group, previousImage: string | null) {
  await tx
    .update(schema.products)
    .set({ name: g.name, description: g.description, categoryId: g.categoryId, kind: g.kind, taxable: g.taxable, sellOnline: g.kind === "retail" ? g.sellOnline : false, supplierId: g.supplierId })
    .where(eq(schema.products.groupId, g.id));
  if (g.imageUrl !== previousImage) {
    await tx
      .update(schema.products)
      .set({ imageUrl: g.imageUrl })
      .where(and(eq(schema.products.groupId, g.id), previousImage ? or(isNull(schema.products.imageUrl), eq(schema.products.imageUrl, previousImage)) : isNull(schema.products.imageUrl)));
  }
}

async function optionLabels(tx: TenantDb, groupId: string): Promise<string[]> {
  return (await tx.select({ l: schema.products.variantLabel }).from(schema.products).where(eq(schema.products.groupId, groupId))).map((r) => r.l ?? "");
}

async function insertOptions(tx: TenantDb, g: Group, labels: string[], d: OptionDefaults) {
  if (!labels.length) return [] as string[];
  const rows = await tx
    .insert(schema.products)
    .values(
      labels.map((label) => ({
        businessId: g.businessId,
        groupId: g.id,
        name: g.name,
        variantLabel: label,
        description: g.description,
        imageUrl: g.imageUrl,
        categoryId: g.categoryId,
        kind: g.kind,
        taxable: g.taxable,
        sellOnline: g.kind === "retail" ? g.sellOnline : false,
        supplierId: g.supplierId,
        priceCents: g.kind === "backbar" ? 0 : (d.priceCents ?? 0),
        costCents: d.costCents ?? 0,
        lowStockThreshold: d.lowStockThreshold ?? 3,
        reorderUpTo: d.reorderUpTo ?? null,
        trackStock: g.kind === "backbar" ? true : (d.trackStock ?? false),
      })),
    )
    .returning({ id: schema.products.id });
  return rows.map((r) => r.id);
}

/** A new product that comes in options: the group, and an option for each label. */
export async function createGroup(input: { businessId: string; shared: Shared; labels: string[]; defaults: OptionDefaults }) {
  const name = input.shared.name.trim();
  if (!name) throw new GroupError("Give the product a name.");
  if (!input.labels.length) throw new GroupError("Add at least one option.");
  if (input.shared.kind === "retail" && !(input.defaults.priceCents && input.defaults.priceCents > 0)) throw new GroupError("Enter a price.");
  return withTenant(input.businessId, async (tx) => {
    const [g] = await tx.insert(schema.productGroups).values({ businessId: input.businessId, ...input.shared, name, sellOnline: input.shared.kind === "retail" ? input.shared.sellOnline : false }).returning();
    const ids = await insertOptions(tx, g!, input.labels, input.defaults);
    return { group: g!, productIds: ids };
  });
}

/**
 * More options for a group. Labels it already has are skipped. A new option's price and cost come from what you give, else from the group's
 * first option (so adding a shade doesn't mean typing the price again).
 */
export async function addOptions(input: { businessId: string; groupId: string; labels: string[]; defaults: OptionDefaults }) {
  return withTenant(input.businessId, async (tx) => {
    const g = await tx.query.productGroups.findFirst({ where: eq(schema.productGroups.id, input.groupId) });
    if (!g) throw new GroupError("Product not found.");
    const siblings = await tx.select().from(schema.products).where(eq(schema.products.groupId, g.id)).orderBy(asc(schema.products.createdAt));
    const { add, skipped } = newLabels(siblings.map((s) => s.variantLabel ?? ""), input.labels);
    if (!add.length) throw new GroupError(skipped.length ? "Those options already exist." : "Add at least one option.");
    const first = siblings[0];
    const defaults: OptionDefaults = {
      priceCents: input.defaults.priceCents ?? first?.priceCents ?? 0,
      costCents: input.defaults.costCents ?? first?.costCents ?? 0,
      lowStockThreshold: input.defaults.lowStockThreshold ?? first?.lowStockThreshold ?? 3,
      reorderUpTo: input.defaults.reorderUpTo ?? first?.reorderUpTo ?? null,
      trackStock: input.defaults.trackStock ?? first?.trackStock ?? false,
    };
    if (g.kind === "retail" && !(defaults.priceCents && defaults.priceCents > 0)) throw new GroupError("Enter a price.");
    await insertOptions(tx, g, add, defaults);
    return { added: add.length, skipped };
  });
}

/** Change what the options share; every option follows. */
export async function updateGroup(input: { businessId: string; groupId: string; shared: Partial<Shared> }) {
  return withTenant(input.businessId, async (tx) => {
    const cur = await tx.query.productGroups.findFirst({ where: eq(schema.productGroups.id, input.groupId) });
    if (!cur) throw new GroupError("Product not found.");
    const patch = { ...input.shared };
    if (patch.name !== undefined) {
      patch.name = patch.name.trim();
      if (!patch.name) throw new GroupError("Give the product a name.");
    }
    // Back-bar products have no price; going back to retail keeps them off the online store until the owner prices them and turns it on.
    const backToRetail = patch.kind === "retail" && cur.kind === "backbar";
    const [g] = await tx.update(schema.productGroups).set({ ...patch, ...(patch.kind === "backbar" || backToRetail ? { sellOnline: false } : {}) }).where(eq(schema.productGroups.id, cur.id)).returning();
    await syncOptions(tx, g!, cur.imageUrl);
    if (g!.kind === "backbar" && cur.kind !== "backbar") await tx.update(schema.products).set({ trackStock: true, priceCents: 0 }).where(eq(schema.products.groupId, g!.id));
    return g!;
  });
}

/** A product that stands alone becomes the first option of a new group, so more options can be added to it. */
export async function convertToGroup(input: { businessId: string; productId: string; label: string }) {
  const label = input.label.replace(/\s+/g, " ").trim().slice(0, 40);
  if (!label) throw new GroupError("Name this option (for example its size or shade).");
  return withTenant(input.businessId, async (tx) => {
    const p = await tx.query.products.findFirst({ where: eq(schema.products.id, input.productId) });
    if (!p) throw new GroupError("Product not found.");
    if (p.groupId) throw new GroupError("This product already has options.");
    const [g] = await tx
      .insert(schema.productGroups)
      .values({ businessId: input.businessId, name: p.name, description: p.description, imageUrl: p.imageUrl, categoryId: p.categoryId, kind: p.kind, taxable: p.taxable, sellOnline: p.sellOnline, supplierId: p.supplierId, active: p.active })
      .returning();
    await tx.update(schema.products).set({ groupId: g!.id, variantLabel: label }).where(eq(schema.products.id, p.id));
    return g!;
  });
}

/** Hide or show a product and all its options at once. */
export async function setGroupActive(input: { businessId: string; groupId: string; active: boolean }) {
  await withTenant(input.businessId, async (tx) => {
    await tx.update(schema.productGroups).set({ active: input.active }).where(eq(schema.productGroups.id, input.groupId));
    await tx.update(schema.products).set({ active: input.active }).where(eq(schema.products.groupId, input.groupId));
  });
}

export async function getGroup(businessId: string, groupId: string) {
  return withTenant(businessId, async (tx) => {
    const group = await tx.query.productGroups.findFirst({ where: eq(schema.productGroups.id, groupId) });
    if (!group) return null;
    const options = await tx.select().from(schema.products).where(eq(schema.products.groupId, groupId)).orderBy(asc(schema.products.variantLabel));
    return { group, options };
  });
}

/** Find the group for a name (any case), for import. */
export async function findGroupByName(tx: TenantDb, name: string) {
  const [g] = await tx.select().from(schema.productGroups).where(sql`lower(${schema.productGroups.name}) = ${name.trim().toLowerCase()}`).limit(1);
  return g ?? null;
}

/**
 * A scan that matched nothing, and it is a new size or shade of something already sold: make that option, in the group, with the scanned
 * barcode. Price and cost default to the group's first option.
 */
export async function quickCreateOption(input: { businessId: string; groupId: string; label: string; priceCents: number | null; costCents: number | null; code: string; actorUserId: string }) {
  const label = input.label.replace(/\s+/g, " ").trim().slice(0, 40);
  if (!label) throw new GroupError("Name this option (for example its size or shade).");
  const code = input.code.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!code || code.length > 60) throw new GroupError("That barcode isn't usable.");
  return withTenant(input.businessId, async (tx) => {
    const g = await tx.query.productGroups.findFirst({ where: eq(schema.productGroups.id, input.groupId) });
    if (!g) throw new GroupError("Product not found.");
    const all = await tx.select({ id: schema.products.id, name: schema.products.name, variantLabel: schema.products.variantLabel, barcode: schema.products.barcode, sku: schema.products.sku }).from(schema.products);
    const extras = await tx.select().from(schema.productBarcodes);
    const owner = matchProduct(all.map((p) => ({ id: p.id, label: productLabel(p), barcode: p.barcode, sku: p.sku, codes: extras.filter((e) => e.productId === p.id).map((e) => ({ code: e.code, units: e.unitsPerScan })) })), code);
    if (owner) throw new GroupError(`That code already belongs to ${owner.label}.`);
    const siblings = await tx.select().from(schema.products).where(eq(schema.products.groupId, g.id)).orderBy(asc(schema.products.createdAt));
    if (siblings.some((s) => (s.variantLabel ?? "").toLowerCase() === label.toLowerCase())) throw new GroupError(`${g.name} already has an option called ${label}.`);
    const first = siblings[0];
    const price = g.kind === "backbar" ? 0 : (input.priceCents ?? first?.priceCents ?? 0);
    if (g.kind === "retail" && price <= 0) throw new GroupError("Enter the price it sells for.");
    const [id] = await insertOptions(tx, g, [label], { priceCents: price, costCents: input.costCents ?? first?.costCents ?? 0, lowStockThreshold: first?.lowStockThreshold ?? 3, reorderUpTo: first?.reorderUpTo ?? null, trackStock: true });
    await tx.update(schema.products).set({ barcode: code }).where(eq(schema.products.id, id!));
    return { id: id!, label: `${g.name} · ${label}`, barcode: code, sku: null, category: null as string | null, onHand: 0, tracked: true, codes: [] as { code: string; units: number }[] };
  });
}

/** The groups a business has, with their options' ids, for lists that fold options under their product. */
export async function groupsOf(businessId: string, ids: string[]) {
  if (!ids.length) return new Map<string, Group>();
  return withTenant(businessId, async (tx) => new Map((await tx.select().from(schema.productGroups).where(inArray(schema.productGroups.id, ids))).map((g) => [g.id, g])));
}

