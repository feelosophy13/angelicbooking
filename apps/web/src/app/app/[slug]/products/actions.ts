"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { ensureCategory } from "@/server/categories";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { deleteFileByUrl, FileError, storeImage } from "@/lib/files";
import { InventoryError, recordMovement, transferStock } from "@/server/inventory";
import { MANUAL_REASONS } from "@/lib/inventory";

const fields = z.object({
  slug: z.string(),
  productId: z.string().optional(),
  name: f.text(1, 80),
  sku: f.optional(40),
  barcode: f.optional(60),
  variantLabel: f.optional(40),
  kind: z.enum(["retail", "backbar"]).default("retail"),
  price: f.moneyOptional(),
  reorderUpTo: f.optional(7),
  supplierId: z.string().optional(),
  taxable: f.checkbox(),
  categoryId: z.string().optional(),
  categoryIdNew: f.optional(60),
  sellOnline: f.checkbox(),
  description: f.optional(400),
  trackStock: f.checkbox(),
  lowStockThreshold: f.int(0, 100000).default(3),
  cost: f.moneyOptional(),
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

async function resolveCategory(businessId: string, d: { categoryId?: string; categoryIdNew: string | null }) {
  if (d.categoryIdNew) return ensureCategory(businessId, "product", d.categoryIdNew);
  return d.categoryId || null;
}

export const createProduct = formAction(fields, async (d, raw) => {
  const ctx = await requireAction(d.slug, "services.manage");
  const categoryId = await resolveCategory(ctx.business.id, d);
  const image = await uploadedImage(ctx.business.id, raw);
  const x = await checked(ctx.business.id, d, raw);
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
  const current = await withTenant(ctx.business.id, (tx) => tx.query.products.findFirst({ where: eq(schema.products.id, d.productId ?? ""), columns: { imageUrl: true } }));
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
