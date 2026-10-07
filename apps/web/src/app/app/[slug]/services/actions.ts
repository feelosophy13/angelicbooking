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
  serviceId: z.string().optional(),
  name: f.text(1, 80),
  description: f.optional(300),
  categoryId: z.string().optional(),
  categoryIdNew: f.optional(60),
  durationMin: f.int(5, 600),
  gapMin: f.int(0, 600),
  finishMin: f.int(0, 600),
  bufferAfterMin: f.int(0, 120),
  price: f.money("price"),
  deposit: f.moneyOptional(),
  bookableOnline: f.checkbox(),
});

async function resolveCategory(businessId: string, d: { categoryId?: string; categoryIdNew: string | null }) {
  if (d.categoryIdNew) return ensureCategory(businessId, "service", d.categoryIdNew);
  return d.categoryId || null;
}

export const createService = formAction(fields, async (d) => {
  const ctx = await requireAction(d.slug, "services.manage");
  const categoryId = await resolveCategory(ctx.business.id, d);
  await withTenant(ctx.business.id, (tx) =>
    tx.insert(schema.services).values({
      businessId: ctx.business.id,
      categoryId,
      name: d.name,
      description: d.description,
      durationMin: d.durationMin,
      gapMin: d.gapMin,
      finishMin: d.finishMin,
      bufferAfterMin: d.bufferAfterMin,
      priceCents: d.price,
      depositCents: d.deposit,
      bookableOnline: d.bookableOnline,
    }),
  );
  await setFlash(`${d.name} added`);
  revalidatePath(`/app/${d.slug}/services`);
  redirect(`/app/${d.slug}/services`);
});

export const updateService = formAction(fields, async (d) => {
  const ctx = await requireAction(d.slug, "services.manage");
  const categoryId = await resolveCategory(ctx.business.id, d);
  await withTenant(ctx.business.id, (tx) =>
    tx
      .update(schema.services)
      .set({
        categoryId,
        name: d.name,
        description: d.description,
        durationMin: d.durationMin,
        gapMin: d.gapMin,
        finishMin: d.finishMin,
        bufferAfterMin: d.bufferAfterMin,
        priceCents: d.price,
        depositCents: d.deposit,
        bookableOnline: d.bookableOnline,
      })
      .where(eq(schema.services.id, d.serviceId ?? "")),
  );
  revalidatePath(`/app/${d.slug}/services`);
  revalidatePath(`/app/${d.slug}/services/${d.serviceId}`);
  return "Service saved";
});

export async function toggleServiceActive(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireAction(slug, "services.manage");
  const id = String(formData.get("serviceId"));
  const active = formData.get("active") === "true";
  await withTenant(ctx.business.id, (tx) => tx.update(schema.services).set({ active }).where(eq(schema.services.id, id)));
  await setFlash(active ? "Service shown again" : "Service hidden");
  revalidatePath(`/app/${slug}/services`);
}
