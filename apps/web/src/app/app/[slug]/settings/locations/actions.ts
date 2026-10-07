"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { TIMEZONES } from "@/lib/utils";

const loc = z.object({
  name: z.string().trim().min(1).max(80),
  addressLine1: z.string().trim().max(120).optional(),
  city: z.string().trim().max(60).optional(),
  state: z.string().trim().max(40).optional(),
  postalCode: z.string().trim().max(20).optional(),
  phone: z.string().trim().max(30).optional(),
  timezone: z.string().optional(),
});

export async function createLocation(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireAction(slug, "business.manage");
  const d = loc.parse(Object.fromEntries(formData));
  await withTenant(ctx.business.id, (tx) =>
    tx.insert(schema.locations).values({ businessId: ctx.business.id, name: d.name, addressLine1: d.addressLine1 || null, city: d.city || null, state: d.state || null, postalCode: d.postalCode || null, phone: d.phone || null, timezone: d.timezone && TIMEZONES.includes(d.timezone) ? d.timezone : null }),
  );
  revalidatePath(`/app/${slug}/settings/locations`);
  redirect(`/app/${slug}/settings/locations`);
}

export async function setDefaultLocation(formData: FormData) {
  const slug = String(formData.get("slug"));
  const id = String(formData.get("id"));
  const ctx = await requireAction(slug, "business.manage");
  await withTenant(ctx.business.id, async (tx) => {
    await tx.update(schema.locations).set({ isDefault: false });
    await tx.update(schema.locations).set({ isDefault: true }).where(eq(schema.locations.id, id));
  });
  revalidatePath(`/app/${slug}/settings/locations`);
}

export async function deleteLocation(formData: FormData) {
  const slug = String(formData.get("slug"));
  const id = String(formData.get("id"));
  const ctx = await requireAction(slug, "business.manage");
  await withTenant(ctx.business.id, async (tx) => {
    const l = await tx.query.locations.findFirst({ where: eq(schema.locations.id, id) });
    if (!l || l.isDefault) throw new Error("The default location can't be removed.");
    await tx.delete(schema.locations).where(eq(schema.locations.id, id));
  });
  revalidatePath(`/app/${slug}/settings/locations`);
}

export async function saveCustomDomain(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireAction(slug, "business.manage");
  const raw = String(formData.get("customDomain") ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (raw && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(raw)) throw new Error("Enter a hostname like book.yoursalon.com");
  await db.update(schema.businesses).set({ customDomain: raw || null }).where(eq(schema.businesses.id, ctx.business.id));
  revalidatePath(`/app/${slug}/settings/domain`);
}
