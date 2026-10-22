"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { requireAction, requireAnyAction } from "@/lib/tenant";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { FileError, storeImage } from "@/lib/files";
import { normalizeBlocks, renderEmail, SAMPLE_VARS, type EmailDesign } from "@/lib/email-design";
import { isSystemEmailKey, SYSTEM_EMAILS } from "@/lib/email-design/system";
import { brandOf, businessBrand, markUrl, sampleSystemEmail } from "@/server/email-designs";
import { postalAddress } from "@/server/locations";
import { queueOneOff } from "@/lib/notify";
import { appUrl } from "@/lib/stripe";
import { isDemoSlug } from "@/lib/demo";
import { emailConfigured } from "@/lib/notify/providers";

const designFields = { slug: z.string(), subject: f.optional(150), preheader: f.optional(150), design: z.string().max(200_000) };

/** The blocks the designer posted, cleaned; at least one block that says something. */
function blocksFrom(json: string, core: boolean) {
  let raw: unknown;
  try {
    raw = JSON.parse(json || "[]");
  } catch {
    throw new FormError("The design could not be read. Reload the page and try again.");
  }
  const blocks = normalizeBlocks(raw, { core });
  if (!blocks.length) throw new FormError("Add at least one block.");
  return blocks;
}

/** Save a design campaigns and workflow emails can pick (Marketing → Email designs). */
export const saveDesign = formAction(z.object({ ...designFields, id: z.string().optional(), name: f.text(1, 80) }), async (d) => {
  const ctx = await requireAction(d.slug, "marketing.send");
  const values = { name: d.name, subject: d.subject ?? "", preheader: d.preheader ?? "", blocks: blocksFrom(d.design, false), updatedByUserId: ctx.user.id };
  if (d.id) {
    const rows = await withTenant(ctx.business.id, (tx) => tx.update(schema.emailTemplates).set(values).where(and(eq(schema.emailTemplates.id, d.id!), eq(schema.emailTemplates.kind, "saved"))).returning({ id: schema.emailTemplates.id }));
    if (!rows.length) throw new FormError("This design was deleted.");
    revalidatePath(`/app/${d.slug}/marketing/designs`);
    return "Design saved";
  }
  const [row] = await withTenant(ctx.business.id, (tx) => tx.insert(schema.emailTemplates).values({ businessId: ctx.business.id, kind: "saved", ...values }).returning({ id: schema.emailTemplates.id }));
  await setFlash("Design saved");
  revalidatePath(`/app/${d.slug}/marketing/designs`);
  redirect(`/app/${d.slug}/marketing/designs/${row!.id}`);
});

export async function deleteDesign(formData: FormData) {
  const d = z.object({ slug: z.string(), id: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "marketing.send");
  // Draft campaigns that used it fall back to their plain message (the foreign key sets template_id to null); workflow steps do the same.
  await withTenant(ctx.business.id, (tx) => tx.delete(schema.emailTemplates).where(and(eq(schema.emailTemplates.id, d.id), eq(schema.emailTemplates.kind, "saved"))));
  await setFlash("Design deleted");
  revalidatePath(`/app/${d.slug}/marketing/designs`);
  redirect(`/app/${d.slug}/marketing/designs`);
}

/** Save the business's own design of an automatic email (Settings → Email designs). */
export const saveSystemDesign = formAction(z.object({ ...designFields, key: z.string() }), async (d) => {
  const ctx = await requireAction(d.slug, "settings.business");
  if (!isSystemEmailKey(d.key)) throw new FormError("Unknown email.");
  const values = { name: SYSTEM_EMAILS[d.key].label, subject: d.subject ?? "", preheader: d.preheader ?? "", blocks: blocksFrom(d.design, true), updatedByUserId: ctx.user.id, updatedAt: new Date() };
  await withTenant(ctx.business.id, (tx) =>
    tx.insert(schema.emailTemplates).values({ businessId: ctx.business.id, kind: "system", key: d.key, ...values }).onConflictDoUpdate({ target: [schema.emailTemplates.businessId, schema.emailTemplates.key], targetWhere: sql`key is not null`, set: values }),
  );
  revalidatePath(`/app/${d.slug}/settings/emails`);
  return `${SYSTEM_EMAILS[d.key].label}: design saved`;
});

/** Back to the standard look: the custom design is removed. */
export async function resetSystemDesign(formData: FormData) {
  const d = z.object({ slug: z.string(), key: z.string() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "settings.business");
  if (!isSystemEmailKey(d.key)) return;
  await withTenant(ctx.business.id, (tx) => tx.delete(schema.emailTemplates).where(and(eq(schema.emailTemplates.kind, "system"), eq(schema.emailTemplates.key, d.key))));
  await setFlash(`${SYSTEM_EMAILS[d.key].label} is back to the standard design`);
  revalidatePath(`/app/${d.slug}/settings/emails`);
  redirect(`/app/${d.slug}/settings/emails/${d.key}`);
}

/** Test emails a person may send themself per hour: enough to iterate on a design, not a way to mail anyone. */
const TESTS_PER_HOUR = 20;

/** Send the design as it is on screen (saved or not) to the signed-in person, filled with sample details. */
export async function sendTestEmail(input: { slug: string; key?: string | null; subject: string; preheader: string; blocks: unknown }): Promise<{ ok: boolean; message: string }> {
  const ctx = await requireAnyAction(input.slug, "marketing.send", "settings.business");
  const to = ctx.user.email;
  if (!to) return { ok: false, message: "Your account has no email address." };
  const system = input.key && isSystemEmailKey(input.key) ? input.key : null;
  const business = ctx.business;
  return withTenant(business.id, async (tx) => {
    const [recent] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.notifications).where(and(eq(schema.notifications.template, "design_test"), eq(schema.notifications.recipient, to), gte(schema.notifications.createdAt, new Date(Date.now() - 3_600_000))));
    if (Number(recent?.n ?? 0) >= TESTS_PER_HOUR) return { ok: false, message: "That's a lot of tests in an hour. Try again a little later." };
    const brand = businessBrand(business, await postalAddress(tx, business));
    const design: EmailDesign = { subject: String(input.subject ?? "").slice(0, 150), preheader: String(input.preheader ?? "").slice(0, 150), blocks: normalizeBlocks(input.blocks, { core: !!system }) };
    let rendered: { subject: string; html: string };
    if (system) {
      const sample = sampleSystemEmail(business, system, brand);
      rendered = renderEmail(design, { brand: brandOf(brand), vars: sample.vars, core: sample.content, markUrl: markUrl() });
      if (!design.subject.trim()) rendered.subject = sample.subject;
    } else {
      const vars = { ...SAMPLE_VARS, business: business.name, business_phone: business.phone ?? "", business_address: brand.address ?? "", booking_url: appUrl(`/book/${business.slug}`), unsubscribe_url: appUrl(`/unsubscribe/${business.slug}/sample`) };
      rendered = renderEmail(design, { brand: brandOf(brand), vars, marketing: { unsubscribeUrl: String(vars.unsubscribe_url), address: brand.address ?? "Your postal address (add it under Settings → Locations)" }, markUrl: markUrl() });
    }
    await queueOneOff(business.id, { channel: "email", template: "design_test", recipient: to, subject: `[Test] ${rendered.subject || "Email design"}`, body: rendered.html });
    // Demo businesses never email anyone, and without an email provider nothing goes out: the test is still logged under Messages.
    if (isDemoSlug(business.slug)) return { ok: true, message: `Demo business: the test to ${to} is logged under Messages but not sent.` };
    if (!emailConfigured()) return { ok: true, message: "Email sending is off on this server: the test is logged under Messages but not sent." };
    return { ok: true, message: `Test sent to ${to}, filled with sample details.` };
  });
}

/** A picture placed in a design: stored at once (public, resized) so the preview and the email can show it. */
export async function uploadEmailImage(formData: FormData): Promise<{ url?: string; error?: string }> {
  const slug = String(formData.get("slug") ?? "");
  const ctx = await requireAnyAction(slug, "marketing.send", "settings.business");
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Choose an image file." };
  try {
    return { url: (await storeImage(ctx.business.id, "email", file)).url };
  } catch (e) {
    if (e instanceof FileError) return { error: e.message };
    throw e;
  }
}
