"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema, withTenant } from "@angelic/db";
import { zonedToInstant } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { MarketingError, sendCampaign } from "@/server/marketing";
import { smsAvailableFor } from "@/server/messaging";

const audienceFields = {
  visitedWithinDays: z.string().trim().optional(),
  lapsedDays: z.string().trim().optional(),
  serviceId: z.string().optional(),
  staffId: z.string().optional(),
  tag: f.optional(40),
  neverVisited: f.checkbox(),
  locationId: z.string().optional(),
};

function parseAudience(d: { visitedWithinDays?: string; lapsedDays?: string; serviceId?: string; staffId?: string; tag: string | null; neverVisited: boolean; locationId?: string }) {
  const n = (v?: string) => (v ? Number(v) : null);
  const vw = n(d.visitedWithinDays);
  const ld = n(d.lapsedDays);
  if ((vw != null && (!Number.isInteger(vw) || vw < 1)) || (ld != null && (!Number.isInteger(ld) || ld < 1))) throw new FormError("Days must be whole numbers");
  return { visitedWithinDays: vw, lapsedDays: ld, serviceId: d.serviceId || null, staffId: d.staffId || null, tag: d.tag, neverVisited: d.neverVisited, locationId: d.locationId || null };
}

const campaignFields = z.object({ slug: z.string(), campaignId: z.string().optional(), name: f.text(1, 100), channel: z.enum(["email", "sms"]), subject: f.optional(150), body: f.text(1, 2000), ...audienceFields });

export const createCampaign = formAction(campaignFields, async (d) => {
  const ctx = await requireAction(d.slug, "marketing.send");
  if (d.channel === "sms" && !(await smsAvailableFor(ctx.business.id))) throw new FormError("Texting needs a verified text number (Settings → Text messaging).", "channel");
  if (d.channel === "email" && !d.subject) throw new FormError("Add a subject line", "subject");
  if (d.channel === "sms" && d.body.length > 320) throw new FormError("Keep texts under 320 characters (2 segments)", "body");
  const audience = parseAudience(d);
  const [row] = await withTenant(ctx.business.id, (tx) => tx.insert(schema.campaigns).values({ businessId: ctx.business.id, name: d.name, channel: d.channel, subject: d.subject, body: d.body, audience, createdByUserId: ctx.user.id }).returning({ id: schema.campaigns.id }));
  revalidatePath(`/app/${d.slug}/marketing`);
  redirect(`/app/${d.slug}/marketing/campaigns/${row!.id}`);
});

export const updateCampaign = formAction(campaignFields, async (d) => {
  const ctx = await requireAction(d.slug, "marketing.send");
  if (d.channel === "sms" && !(await smsAvailableFor(ctx.business.id))) throw new FormError("Texting needs a verified text number (Settings → Text messaging).", "channel");
  if (d.channel === "email" && !d.subject) throw new FormError("Add a subject line", "subject");
  const audience = parseAudience(d);
  await withTenant(ctx.business.id, (tx) => tx.update(schema.campaigns).set({ name: d.name, channel: d.channel, subject: d.subject, body: d.body, audience }).where(eq(schema.campaigns.id, d.campaignId ?? "")));
  revalidatePath(`/app/${d.slug}/marketing/campaigns/${d.campaignId}`);
  return "Campaign saved";
});

export async function sendCampaignAction(formData: FormData) {
  const d = z.object({ slug: z.string(), campaignId: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "marketing.send");
  try {
    const n = await sendCampaign(ctx.business, d.campaignId, ctx.user.id);
    await setFlash(`Sending to ${n} client${n === 1 ? "" : "s"}`);
  } catch (e) {
    if (e instanceof MarketingError) await setFlash(e.message, "error");
    else throw e;
  }
  revalidatePath(`/app/${d.slug}/marketing/campaigns/${d.campaignId}`);
}

export async function deleteCampaign(formData: FormData) {
  const d = z.object({ slug: z.string(), campaignId: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "marketing.send");
  await withTenant(ctx.business.id, (tx) => tx.delete(schema.campaigns).where(eq(schema.campaigns.id, d.campaignId)));
  await setFlash("Campaign deleted");
  revalidatePath(`/app/${d.slug}/marketing`);
  redirect(`/app/${d.slug}/marketing`);
}

export const createPromo = formAction(
  z.object({ slug: z.string(), code: f.text(2, 30), type: z.enum(["percent", "amount"]), value: z.string().trim(), startsAt: z.string().optional(), expiresAt: z.string().optional(), maxUses: z.string().trim().optional(), minSubtotal: f.moneyOptional() }),
  async (d, raw) => {
    const ctx = await requireAction(d.slug, "marketing.send");
    const code = d.code.toUpperCase().replace(/[^A-Z0-9-]/g, "");
    if (code.length < 2) throw new FormError("Letters and numbers only", "code");
    let value: number;
    if (d.type === "percent") {
      value = Number(d.value);
      if (!Number.isInteger(value) || value < 1 || value > 100) throw new FormError("Percent between 1 and 100", "value");
    } else {
      const cents = Math.round(Number(d.value.replace(/[$,]/g, "")) * 100);
      if (!Number.isFinite(cents) || cents < 1) throw new FormError("Enter an amount like 10 or 10.50", "value");
      value = cents;
    }
    const maxUses = d.maxUses ? Number(d.maxUses) : null;
    if (d.maxUses && (!Number.isInteger(maxUses) || maxUses! < 1)) throw new FormError("Whole number", "maxUses");
    const serviceIds = raw.getAll("serviceIds").map(String).filter(Boolean);
    const exists = await withTenant(ctx.business.id, (tx) => tx.query.promoCodes.findFirst({ where: eq(schema.promoCodes.code, code) }));
    if (exists) throw new FormError("That code already exists", "code");
    await withTenant(ctx.business.id, (tx) =>
      tx.insert(schema.promoCodes).values({ businessId: ctx.business.id, code, type: d.type, value, startsAt: d.startsAt ? zonedToInstant(d.startsAt, "00:00", ctx.business.timezone) : null, expiresAt: d.expiresAt ? zonedToInstant(d.expiresAt, "23:59", ctx.business.timezone) : null, maxUses, serviceIds, minSubtotalCents: d.minSubtotal }),
    );
    await setFlash(`Code ${code} created`);
    revalidatePath(`/app/${d.slug}/marketing/promos`);
    redirect(`/app/${d.slug}/marketing/promos`);
  },
);

export async function togglePromo(formData: FormData) {
  const d = z.object({ slug: z.string(), id: z.string().min(1), active: z.string() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "marketing.send");
  await withTenant(ctx.business.id, (tx) => tx.update(schema.promoCodes).set({ active: d.active === "true" }).where(eq(schema.promoCodes.id, d.id)));
  revalidatePath(`/app/${d.slug}/marketing/promos`);
}
