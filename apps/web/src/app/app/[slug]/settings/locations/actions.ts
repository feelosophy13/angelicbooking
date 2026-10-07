"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { TIMEZONES } from "@/lib/utils";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";

export const createLocation = formAction(
  z.object({ slug: z.string(), name: f.text(1, 80), addressLine1: f.optional(120), city: f.optional(60), state: f.optional(40), postalCode: f.optional(20), phone: f.optional(30), timezone: z.string().optional() }),
  async (d) => {
    const ctx = await requireAction(d.slug, "business.manage");
    await withTenant(ctx.business.id, (tx) =>
      tx.insert(schema.locations).values({ businessId: ctx.business.id, name: d.name, addressLine1: d.addressLine1, city: d.city, state: d.state, postalCode: d.postalCode, phone: d.phone, timezone: d.timezone && TIMEZONES.includes(d.timezone) ? d.timezone : null }),
    );
    await setFlash(`${d.name} added`);
    revalidatePath(`/app/${d.slug}/settings/locations`);
    redirect(`/app/${d.slug}/settings/locations`);
  },
);

export async function setDefaultLocation(formData: FormData) {
  const slug = String(formData.get("slug"));
  const id = String(formData.get("id"));
  const ctx = await requireAction(slug, "business.manage");
  await withTenant(ctx.business.id, async (tx) => {
    await tx.update(schema.locations).set({ isDefault: false });
    await tx.update(schema.locations).set({ isDefault: true }).where(eq(schema.locations.id, id));
  });
  await setFlash("Default location updated");
  revalidatePath(`/app/${slug}/settings/locations`);
}

export async function deleteLocation(formData: FormData) {
  const slug = String(formData.get("slug"));
  const id = String(formData.get("id"));
  const ctx = await requireAction(slug, "business.manage");
  const ok = await withTenant(ctx.business.id, async (tx) => {
    const l = await tx.query.locations.findFirst({ where: eq(schema.locations.id, id) });
    if (!l || l.isDefault) return false;
    await tx.delete(schema.locations).where(eq(schema.locations.id, id));
    return true;
  });
  await setFlash(ok ? "Location removed" : "The default location can't be removed.", ok ? "success" : "error");
  revalidatePath(`/app/${slug}/settings/locations`);
}

export const saveCustomDomain = formAction(z.object({ slug: z.string(), customDomain: z.string().trim() }), async (d) => {
  const ctx = await requireAction(d.slug, "business.manage");
  const raw = d.customDomain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (raw && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(raw)) throw new FormError("Enter a hostname like book.yoursalon.com", "customDomain");
  await db.update(schema.businesses).set({ customDomain: raw || null }).where(eq(schema.businesses.id, ctx.business.id));
  revalidatePath(`/app/${d.slug}/settings/domain`);
  return raw ? "Custom domain saved" : "Custom domain removed";
});
