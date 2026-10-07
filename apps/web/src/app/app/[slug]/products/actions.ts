"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { ensureCategory } from "@/server/categories";
import { f, formAction } from "@/lib/form";
import { setFlash } from "@/lib/flash";

const fields = z.object({
  slug: z.string(),
  productId: z.string().optional(),
  name: f.text(1, 80),
  sku: f.optional(40),
  price: f.money("price"),
  taxable: f.checkbox(),
  categoryId: z.string().optional(),
  categoryIdNew: f.optional(60),
});

async function resolveCategory(businessId: string, d: { categoryId?: string; categoryIdNew: string | null }) {
  if (d.categoryIdNew) return ensureCategory(businessId, "product", d.categoryIdNew);
  return d.categoryId || null;
}

export const createProduct = formAction(fields, async (d) => {
  const ctx = await requireAction(d.slug, "services.manage");
  const categoryId = await resolveCategory(ctx.business.id, d);
  await withTenant(ctx.business.id, (tx) => tx.insert(schema.products).values({ businessId: ctx.business.id, categoryId, name: d.name, sku: d.sku, priceCents: d.price, taxable: d.taxable }));
  await setFlash(`${d.name} added`);
  revalidatePath(`/app/${d.slug}/products`);
  redirect(`/app/${d.slug}/products`);
});

export const updateProduct = formAction(fields, async (d) => {
  const ctx = await requireAction(d.slug, "services.manage");
  const categoryId = await resolveCategory(ctx.business.id, d);
  await withTenant(ctx.business.id, (tx) => tx.update(schema.products).set({ categoryId, name: d.name, sku: d.sku, priceCents: d.price, taxable: d.taxable }).where(eq(schema.products.id, d.productId ?? "")));
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
