"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { parseMoney } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { ensureCategory } from "@/server/categories";

const fields = z.object({
  name: z.string().trim().min(1).max(80),
  sku: z.string().trim().max(40).optional(),
  price: z.string(),
  taxable: z.string().optional(),
  categoryId: z.string().optional(),
  categoryIdNew: z.string().trim().max(60).optional(),
});

async function resolveCategory(businessId: string, d: { categoryId?: string; categoryIdNew?: string }) {
  if (d.categoryIdNew) return ensureCategory(businessId, "product", d.categoryIdNew);
  return d.categoryId || null;
}

export async function createProduct(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireAction(slug, "services.manage");
  const d = fields.parse(Object.fromEntries(formData));
  const priceCents = parseMoney(d.price);
  if (priceCents === null) throw new Error("Enter a price like 24 or 24.50");
  const categoryId = await resolveCategory(ctx.business.id, d);
  await withTenant(ctx.business.id, (tx) =>
    tx.insert(schema.products).values({ businessId: ctx.business.id, categoryId, name: d.name, sku: d.sku || null, priceCents, taxable: d.taxable === "on" }),
  );
  revalidatePath(`/app/${slug}/products`);
  redirect(`/app/${slug}/products`);
}

export async function updateProduct(formData: FormData) {
  const slug = String(formData.get("slug"));
  const productId = String(formData.get("productId"));
  const ctx = await requireAction(slug, "services.manage");
  const d = fields.parse(Object.fromEntries(formData));
  const priceCents = parseMoney(d.price);
  if (priceCents === null) throw new Error("Enter a price like 24 or 24.50");
  const categoryId = await resolveCategory(ctx.business.id, d);
  await withTenant(ctx.business.id, (tx) =>
    tx.update(schema.products).set({ categoryId, name: d.name, sku: d.sku || null, priceCents, taxable: d.taxable === "on" }).where(eq(schema.products.id, productId)),
  );
  revalidatePath(`/app/${slug}/products`);
  revalidatePath(`/app/${slug}/products/${productId}`);
}

export async function toggleProductActive(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireAction(slug, "services.manage");
  const id = String(formData.get("productId"));
  const active = formData.get("active") === "true";
  await withTenant(ctx.business.id, (tx) => tx.update(schema.products).set({ active }).where(eq(schema.products.id, id)));
  revalidatePath(`/app/${slug}/products`);
}
