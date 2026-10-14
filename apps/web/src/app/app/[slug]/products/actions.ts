"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { ensureCategory } from "@/server/categories";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { deleteFileByUrl, FileError, storeImage } from "@/lib/files";
import { attachBarcode, InventoryError, recordMovement, removeExtraBarcode, transferStock } from "@/server/inventory";
import { MANUAL_REASONS } from "@/lib/inventory";
import { addOptions, convertToGroup, createGroup, GroupError, setGroupActive, updateGroup } from "@/server/product-groups";
import { optionCombos, parseOptionList } from "@/lib/variants";

const fields = z.object({
  slug: z.string(),
  productId: z.string().optional(),
  name: f.text(1, 80),
  sku: f.optional(40).optional(),
  barcode: f.optional(60).optional(),
  variantLabel: f.optional(40).optional(),
  kind: z.enum(["retail", "backbar"]).default("retail"),
  price: f.moneyOptional(),
  reorderUpTo: f.optional(7).optional(),
  supplierId: z.string().optional(),
  taxable: f.checkbox(),
  categoryId: z.string().optional(),
  categoryIdNew: f.optional(60).optional(),
  sellOnline: f.checkbox(),
  description: f.optional(400).optional(),
  trackStock: f.checkbox(),
  lowStockThreshold: f.int(0, 100000).default(3),
  cost: f.moneyOptional(),
  // New product only: the options it comes in (one per line), and a second kind of option to multiply them by.
  options: f.optional(3000).optional(),
  options2: f.optional(3000).optional(),
});

/** Fields that depend on each other: what a back-bar product is, what a sellable one needs, and a barcode used once. */
async function checked(businessId: string, d: z.infer<typeof fields>, raw: FormData) {
  const retail = d.kind === "retail";
  if (retail && !String(raw.get("price") ?? "").trim()) throw new FormError("Enter a price.", "price");
  let reorderUpTo: number | null = null;
  if (d.reorderUpTo) {
    if (!/^\d+$/.test(d.reorderUpTo)) throw new FormError("Whole numbers only.", "reorderUpTo");
    reorderUpTo = Number(d.reorderUpTo);
    if (reorderUpTo < d.lowStockThreshold) throw new FormError("Order up to must be at least the low-stock level.", "reorderUpTo");
  }
  if (d.barcode) {
    const clash = await withTenant(businessId, (tx) => tx.select({ id: schema.products.id }).from(schema.products).where(and(eq(schema.products.barcode, d.barcode!), ne(schema.products.id, d.productId ?? ""))).limit(1));
    if (clash.length) throw new FormError("Another product already has this barcode.", "barcode");
  }
  return {
    reorderUpTo,
    supplierId: d.supplierId || null,
    // Back-bar products are never sold, and only exist to be counted.
    sellOnline: retail ? d.sellOnline : false,
    trackStock: retail ? d.trackStock : true,
  };
}

async function resolveCategory(businessId: string, d: { categoryId?: string; categoryIdNew?: string | null }) {
  if (d.categoryIdNew) return ensureCategory(businessId, "product", d.categoryIdNew);
  return d.categoryId || null;
}

export const createProduct = formAction(fields, async (d, raw) => {
  const ctx = await requireAction(d.slug, "services.manage");
  const categoryId = await resolveCategory(ctx.business.id, d);
  const image = await uploadedImage(ctx.business.id, raw);
  const x = await checked(ctx.business.id, d, raw);
  const labels = optionCombos(parseOptionList(d.options ?? ""), parseOptionList(d.options2 ?? ""));
  if (labels.length) {
    // A product that comes in options: the group holds what they share, and each option gets the price, cost and levels typed here (a barcode and SKU belong to each option, so they are added afterwards).
    if (d.barcode || d.sku) throw new FormError("Barcodes and SKUs belong to each option. Leave them blank and add them to each option after.", d.barcode ? "barcode" : "sku");
    try {
      const { group } = await createGroup({ businessId: ctx.business.id, shared: { name: d.name, description: d.description ?? null, imageUrl: image, categoryId, kind: d.kind, taxable: d.taxable, sellOnline: x.sellOnline, supplierId: x.supplierId }, labels, defaults: { priceCents: d.price, costCents: d.cost, lowStockThreshold: d.lowStockThreshold, reorderUpTo: x.reorderUpTo, trackStock: x.trackStock } });
      await setFlash(`${d.name} added with ${labels.length} option${labels.length === 1 ? "" : "s"}`);
      revalidatePath(`/app/${d.slug}/products`);
      redirect(`/app/${d.slug}/products/group/${group.id}`);
    } catch (e) {
      if (e instanceof GroupError) throw new FormError(e.message);
      throw e;
    }
  }
  await withTenant(ctx.business.id, (tx) => tx.insert(schema.products).values({ businessId: ctx.business.id, categoryId, name: d.name, variantLabel: d.variantLabel, kind: d.kind, sku: d.sku, barcode: d.barcode, priceCents: d.price, taxable: d.taxable, sellOnline: x.sellOnline, description: d.description, trackStock: x.trackStock, lowStockThreshold: d.lowStockThreshold, reorderUpTo: x.reorderUpTo, supplierId: x.supplierId, costCents: d.cost, imageUrl: image }));
  await setFlash(`${d.name} added`);
  revalidatePath(`/app/${d.slug}/products`);
  redirect(`/app/${d.slug}/products`);
});

export const updateProduct = formAction(fields, async (d, raw) => {
  const ctx = await requireAction(d.slug, "services.manage");
  const categoryId = await resolveCategory(ctx.business.id, d);
  const image = await uploadedImage(ctx.business.id, raw);
  const removeImage = raw.get("removeImage") === "on";
  const x = await checked(ctx.business.id, d, raw);
  const current = await withTenant(ctx.business.id, (tx) => tx.query.products.findFirst({ where: eq(schema.products.id, d.productId ?? ""), columns: { imageUrl: true, groupId: true } }));
  if (current?.groupId) {
    // An option of a product: only what is its own. The name, category, photo, description and online store are the group's, changed on the group's page.
    const label = (d.variantLabel ?? "").trim();
    if (!label) throw new FormError("Name this option (for example its size or shade).", "variantLabel");
    const dup = await withTenant(ctx.business.id, (tx) => tx.select({ id: schema.products.id }).from(schema.products).where(and(eq(schema.products.groupId, current.groupId!), ne(schema.products.id, d.productId ?? ""), sql`lower(${schema.products.variantLabel}) = ${label.toLowerCase()}`)).limit(1));
    if (dup.length) throw new FormError("This product already has an option with that name.", "variantLabel");
    await withTenant(ctx.business.id, (tx) => tx.update(schema.products).set({ variantLabel: label, sku: d.sku, barcode: d.barcode, priceCents: d.kind === "backbar" ? 0 : d.price, costCents: d.cost, trackStock: x.trackStock, lowStockThreshold: d.lowStockThreshold, reorderUpTo: x.reorderUpTo }).where(eq(schema.products.id, d.productId ?? "")));
    revalidatePath(`/app/${d.slug}/products`);
    revalidatePath(`/app/${d.slug}/products/${d.productId}`);
    return "Option saved";
  }
  await withTenant(ctx.business.id, (tx) => tx.update(schema.products).set({ categoryId, name: d.name, variantLabel: d.variantLabel, kind: d.kind, sku: d.sku, barcode: d.barcode, priceCents: d.price, taxable: d.taxable, sellOnline: x.sellOnline, description: d.description, trackStock: x.trackStock, lowStockThreshold: d.lowStockThreshold, reorderUpTo: x.reorderUpTo, supplierId: x.supplierId, costCents: d.cost, ...(image ? { imageUrl: image } : removeImage ? { imageUrl: null } : {}) }).where(eq(schema.products.id, d.productId ?? "")));
  if ((image || removeImage) && current?.imageUrl) await deleteFileByUrl(current.imageUrl);
  revalidatePath(`/app/${d.slug}/products`);
  revalidatePath(`/app/${d.slug}/products/${d.productId}`);
  return "Product saved";
});

export async function toggleProductActive(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireAction(slug, "services.manage");
  const id = String(formData.get("productId"));
  const active = formData.get("active") === "true";
  await withTenant(ctx.business.id, (tx) => tx.update(schema.products).set({ active }).where(eq(schema.products.id, id)));
  await setFlash(active ? "Product shown again" : "Product hidden");
  revalidatePath(`/app/${slug}/products`);
}

async function uploadedImage(businessId: string, raw: FormData): Promise<string | null> {
  const file = raw.get("image");
  if (!(file instanceof File) || file.size === 0) return null;
  try {
    return (await storeImage(businessId, "product", file)).url;
  } catch (e) {
    if (e instanceof FileError) throw new FormError(e.message, "image");
    throw e;
  }
}

const stockRefresh = (slug: string, productId: string) => {
  revalidatePath(`/app/${slug}/products/${productId}`);
  revalidatePath(`/app/${slug}/products`);
  revalidatePath(`/app/${slug}/inventory`, "layout");
};

/** Receive, adjust, write off (damaged, stolen, expired, lost) or send back stock for one product at one location. */
export const adjustStock = formAction(
  z.object({ slug: z.string(), productId: f.id(), locationId: z.string().optional(), reason: z.enum(MANUAL_REASONS), delta: z.coerce.number({ message: "Enter a number" }).int("Whole units"), note: f.optional(200) }),
  async (d) => {
    const ctx = await requireAction(d.slug, "inventory.manage");
    if (d.delta === 0) throw new FormError("Enter how many units.", "delta");
    try {
      await recordMovement({ businessId: ctx.business.id, productId: d.productId, locationId: d.locationId || null, entered: d.delta, reason: d.reason, note: d.note, actorUserId: ctx.user.id });
    } catch (e) {
      if (e instanceof InventoryError) throw new FormError(e.message, "delta");
      throw e;
    }
    stockRefresh(d.slug, d.productId);
    return "Stock updated";
  },
);

export const transferStockAction = formAction(
  z.object({ slug: z.string(), productId: f.id(), fromLocationId: f.id(), toLocationId: f.id(), qty: f.int(1, 100000), note: f.optional(200) }),
  async (d) => {
    const ctx = await requireAction(d.slug, "inventory.manage");
    try {
      await transferStock({ businessId: ctx.business.id, productId: d.productId, fromLocationId: d.fromLocationId, toLocationId: d.toLocationId, qty: d.qty, note: d.note, actorUserId: ctx.user.id });
    } catch (e) {
      if (e instanceof InventoryError) throw new FormError(e.message, "qty");
      throw e;
    }
    stockRefresh(d.slug, d.productId);
    return "Stock moved";
  },
);

/** Another barcode for a product (a case, a different pack size): one scan of it stands for `units` units. */
export const addProductBarcode = formAction(z.object({ slug: z.string(), productId: f.id(), code: f.text(1, 60), units: f.int(1, 1000) }), async (d) => {
  const ctx = await requireAction(d.slug, "inventory.manage");
  try {
    await attachBarcode({ businessId: ctx.business.id, productId: d.productId, code: d.code, mode: "add", units: d.units, actorUserId: ctx.user.id });
  } catch (e) {
    if (e instanceof InventoryError) throw new FormError(e.message, "code");
    throw e;
  }
  revalidatePath(`/app/${d.slug}/products/${d.productId}`);
  return "Barcode added";
});

export async function deleteProductBarcode(formData: FormData) {
  const slug = String(formData.get("slug"));
  const productId = String(formData.get("productId"));
  const ctx = await requireAction(slug, "inventory.manage");
  await removeExtraBarcode({ businessId: ctx.business.id, id: String(formData.get("id")) });
  await setFlash("Barcode removed");
  revalidatePath(`/app/${slug}/products/${productId}`);
}

// ---- Products that come in options ----

const groupFields = z.object({
  slug: z.string(),
  groupId: f.id(),
  name: f.text(1, 80),
  kind: z.enum(["retail", "backbar"]).default("retail"),
  categoryId: z.string().optional(),
  categoryIdNew: f.optional(60).optional(),
  taxable: f.checkbox(),
  sellOnline: f.checkbox(),
  description: f.optional(400).optional(),
  supplierId: z.string().optional(),
});

/** What the options share. Every option follows. */
export const saveGroup = formAction(groupFields, async (d, raw) => {
  const ctx = await requireAction(d.slug, "services.manage");
  const categoryId = await resolveCategory(ctx.business.id, d);
  const image = await uploadedImage(ctx.business.id, raw);
  const removeImage = raw.get("removeImage") === "on";
  const current = await withTenant(ctx.business.id, (tx) => tx.query.productGroups.findFirst({ where: eq(schema.productGroups.id, d.groupId), columns: { imageUrl: true } }));
  try {
    await updateGroup({ businessId: ctx.business.id, groupId: d.groupId, shared: { name: d.name, kind: d.kind, categoryId, taxable: d.taxable, sellOnline: d.kind === "retail" ? d.sellOnline : false, description: d.description, supplierId: d.supplierId || null, ...(image ? { imageUrl: image } : removeImage ? { imageUrl: null } : {}) } });
  } catch (e) {
    if (e instanceof GroupError) throw new FormError(e.message);
    throw e;
  }
  if ((image || removeImage) && current?.imageUrl) await deleteFileByUrl(current.imageUrl);
  revalidatePath(`/app/${d.slug}/products`, "layout");
  return "Saved for every option";
});

/** More options for a product: one per line, optionally multiplied by a second list. New options take the price and cost typed here, else the first option's. */
export const addGroupOptions = formAction(
  z.object({ slug: z.string(), groupId: f.id(), options: f.optional(3000), options2: f.optional(3000), price: f.moneyOptional(), cost: f.moneyOptional() }),
  async (d, raw) => {
    const ctx = await requireAction(d.slug, "services.manage");
    const labels = optionCombos(parseOptionList(d.options ?? ""), parseOptionList(d.options2 ?? ""));
    if (!labels.length) throw new FormError("Type at least one option, one per line.", "options");
    try {
      const r = await addOptions({ businessId: ctx.business.id, groupId: d.groupId, labels, defaults: { priceCents: String(raw.get("price") ?? "").trim() ? d.price : null, costCents: String(raw.get("cost") ?? "").trim() ? d.cost : null } });
      revalidatePath(`/app/${d.slug}/products`, "layout");
      return `${r.added} option${r.added === 1 ? "" : "s"} added${r.skipped.length ? `; ${r.skipped.length} already existed` : ""}`;
    } catch (e) {
      if (e instanceof GroupError) throw new FormError(e.message, "options");
      throw e;
    }
  },
);

/** "This product comes in sizes or shades": the product becomes the first option of a new group. */
export const makeProductOptions = formAction(z.object({ slug: z.string(), productId: f.id(), label: f.text(1, 40) }), async (d) => {
  const ctx = await requireAction(d.slug, "services.manage");
  let groupId = "";
  try {
    groupId = (await convertToGroup({ businessId: ctx.business.id, productId: d.productId, label: d.label })).id;
  } catch (e) {
    if (e instanceof GroupError) throw new FormError(e.message, "label");
    throw e;
  }
  revalidatePath(`/app/${d.slug}/products`, "layout");
  await setFlash("Now add the other options");
  redirect(`/app/${d.slug}/products/group/${groupId}`);
});

export async function toggleGroupActive(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireAction(slug, "services.manage");
  const active = formData.get("active") === "true";
  await setGroupActive({ businessId: ctx.business.id, groupId: String(formData.get("groupId")), active });
  await setFlash(active ? "Shown again, with all its options" : "Hidden, with all its options");
  revalidatePath(`/app/${slug}/products`, "layout");
}
