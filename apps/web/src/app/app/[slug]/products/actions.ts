"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { parseMoney } from "@angelic/core";
import { requireAction } from "@/lib/tenant";

export async function createProduct(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireAction(slug, "services.manage");
  const d = z
    .object({ name: z.string().trim().min(1).max(80), sku: z.string().trim().max(40), price: z.string(), taxable: z.string().optional() })
    .parse(Object.fromEntries(formData));
  const priceCents = parseMoney(d.price);
  if (priceCents === null) throw new Error("Enter a price like 24 or 24.50");
  await withTenant(ctx.business.id, (tx) =>
    tx.insert(schema.products).values({ businessId: ctx.business.id, name: d.name, sku: d.sku || null, priceCents, taxable: d.taxable === "on" }),
  );
  revalidatePath(`/app/${slug}/products`);
}

export async function toggleProductActive(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireAction(slug, "services.manage");
  const id = String(formData.get("productId"));
  const active = formData.get("active") === "true";
  await withTenant(ctx.business.id, (tx) => tx.update(schema.products).set({ active }).where(eq(schema.products.id, id)));
  revalidatePath(`/app/${slug}/products`);
}
