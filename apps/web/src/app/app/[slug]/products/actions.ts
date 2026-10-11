"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { ensureCategory } from "@/server/categories";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { deleteFileByUrl, FileError, storeImage } from "@/lib/files";
import { InventoryError, recordMovement } from "@/server/inventory";

const fields = z.object({
  slug: z.string(),
  productId: z.string().optional(),
  name: f.text(1, 80),
  sku: f.optional(40),
  price: f.money("price"),
  taxable: f.checkbox(),
  categoryId: z.string().optional(),
  categoryIdNew: f.optional(60),
  sellOnline: f.checkbox(),
  description: f.optional(400),
  trackStock: f.checkbox(),
  lowStockThreshold: f.int(0, 100000).default(3),
  cost: f.moneyOptional(),
});

async function resolveCategory(businessId: string, d: { categoryId?: string; categoryIdNew: string | null }) {
  if (d.categoryIdNew) return ensureCategory(businessId, "product", d.categoryIdNew);
  return d.categoryId || null;
}

export const createProduct = formAction(fields, async (d, raw) => {
  const ctx = await requireAction(d.slug, "services.manage");
  const categoryId = await resolveCategory(ctx.business.id, d);
  const image = await uploadedImage(ctx.business.id, raw);
  await withTenant(ctx.business.id, (tx) => tx.insert(schema.products).values({ businessId: ctx.business.id, categoryId, name: d.name, sku: d.sku, priceCents: d.price, taxable: d.taxable, sellOnline: d.sellOnline, description: d.description, trackStock: d.trackStock, lowStockThreshold: d.lowStockThreshold, costCents: d.cost, imageUrl: image }));
  await setFlash(`${d.name} added`);
  revalidatePath(`/app/${d.slug}/products`);
  redirect(`/app/${d.slug}/products`);
});

export const updateProduct = formAction(fields, async (d, raw) => {
  const ctx = await requireAction(d.slug, "services.manage");
  const categoryId = await resolveCategory(ctx.business.id, d);
  const image = await uploadedImage(ctx.business.id, raw);
  const removeImage = raw.get("removeImage") === "on";
  const current = await withTenant(ctx.business.id, (tx) => tx.query.products.findFirst({ where: eq(schema.products.id, d.productId ?? ""), columns: { imageUrl: true } }));
  await withTenant(ctx.business.id, (tx) => tx.update(schema.products).set({ categoryId, name: d.name, sku: d.sku, priceCents: d.price, taxable: d.taxable, sellOnline: d.sellOnline, description: d.description, trackStock: d.trackStock, lowStockThreshold: d.lowStockThreshold, costCents: d.cost, ...(image ? { imageUrl: image } : removeImage ? { imageUrl: null } : {}) }).where(eq(schema.products.id, d.productId ?? "")));
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

export const adjustStock = formAction(
  z.object({ slug: z.string(), productId: f.id(), reason: z.enum(["received", "adjust"]), delta: z.coerce.number({ message: "Enter a number" }).int("Whole units"), note: f.optional(200) }),
  async (d) => {
    const ctx = await requireAction(d.slug, "services.manage");
    if (d.delta === 0) throw new FormError("Enter how many units (negative to remove).", "delta");
    try {
      await recordMovement({ businessId: ctx.business.id, productId: d.productId, delta: d.reason === "received" ? Math.abs(d.delta) : d.delta, reason: d.reason, note: d.note, actorUserId: ctx.user.id });
    } catch (e) {
      if (e instanceof InventoryError) throw new FormError(e.message, "delta");
      throw e;
    }
    revalidatePath(`/app/${d.slug}/products/${d.productId}`);
    revalidatePath(`/app/${d.slug}/products`);
    return "Stock updated";
  },
);
