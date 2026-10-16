"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { TIMEZONES } from "@/lib/utils";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { parseHoursForm } from "@/lib/hours";

export const createLocation = formAction(
  z.object({ slug: z.string(), name: f.text(1, 80), addressLine1: f.optional(120), city: f.optional(60), state: f.optional(40), postalCode: f.optional(20), phone: f.optional(30), timezone: z.string().optional() }),
  async (d, raw) => {
    const ctx = await requireAction(d.slug, "business.manage");
    const hours = parseHoursForm((n) => { const v = raw.get(n); return typeof v === "string" ? v : null; });
    await withTenant(ctx.business.id, (tx) =>
      tx.insert(schema.locations).values({ businessId: ctx.business.id, name: d.name, addressLine1: d.addressLine1, city: d.city, state: d.state, postalCode: d.postalCode, phone: d.phone, timezone: d.timezone && TIMEZONES.includes(d.timezone) ? d.timezone : null, hours }),
    );
    await setFlash(`${d.name} added`);
    revalidatePath(`/app/${d.slug}/settings/locations`);
    redirect(`/app/${d.slug}/settings/locations`);
  },
);

export const updateLocation = formAction(
  z.object({ slug: z.string(), locationId: f.id(), name: f.text(1, 80), addressLine1: f.optional(120), city: f.optional(60), state: f.optional(40), postalCode: f.optional(20), phone: f.optional(30), timezone: z.string().optional(), taxPct: z.string().trim().optional() }),
  async (d, raw) => {
    const ctx = await requireAction(d.slug, "business.manage");
    const hours = parseHoursForm((n) => { const v = raw.get(n); return typeof v === "string" ? v : null; });
    let taxRateBps: number | null = null;
    if (d.taxPct) {
      const pct = Number(d.taxPct);
      if (!Number.isFinite(pct) || pct < 0 || pct > 30) throw new FormError("Tax must be between 0 and 30%", "taxPct");
      taxRateBps = Math.round(pct * 100);
    }
    await withTenant(ctx.business.id, (tx) =>
      tx
        .update(schema.locations)
        .set({ name: d.name, addressLine1: d.addressLine1, city: d.city, state: d.state, postalCode: d.postalCode, phone: d.phone, timezone: d.timezone && TIMEZONES.includes(d.timezone) ? d.timezone : null, hours, taxRateBps })
        .where(eq(schema.locations.id, d.locationId)),
    );
    revalidatePath(`/app/${d.slug}/settings/locations`);
    revalidatePath(`/app/${d.slug}/settings/locations/${d.locationId}`);
    revalidatePath(`/book/${ctx.business.slug}`, "layout");
    return "Location saved";
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
  const outcome = await withTenant(ctx.business.id, async (tx) => {
    const l = await tx.query.locations.findFirst({ where: eq(schema.locations.id, id) });
    if (!l || l.isDefault) return "The default location can't be removed.";
    // A site with history stays: its sales, visits and hours are reported by location, and removing it would file them under "No location".
    const [used] = await tx.execute<{ n: number }>(sql`select (select count(*) from sales where location_id = ${id}) + (select count(*) from appointments where location_id = ${id}) + (select count(*) from time_entries where location_id = ${id}) as n`);
    if (Number(used?.n ?? 0) > 0) return "This location has sales, visits or hours on record, so it stays for your reports. Stop booking there by moving its staff and hours elsewhere.";
    await tx.delete(schema.locations).where(eq(schema.locations.id, id));
    return null;
  });
  await setFlash(outcome ?? "Location removed", outcome ? "error" : "success");
  revalidatePath(`/app/${slug}/settings/locations`);
}
