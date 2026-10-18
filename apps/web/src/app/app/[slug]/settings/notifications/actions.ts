"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { formAction } from "@/lib/form";
import { SMS_TEMPLATE_KEYS } from "@/lib/notify/sms";
import { MAX_QUICK_REPLIES, normalizeQuickReplies } from "@/lib/notify/quick-replies";
import { setFlash } from "@/lib/flash";

export const saveSmsTemplates = formAction(z.object({ slug: z.string() }), async (d, raw) => {
  const ctx = await requireAction(d.slug, "business.manage");
  const templates: Record<string, string> = {};
  for (const k of SMS_TEMPLATE_KEYS) {
    const v = String(raw.get(`t_${k}`) ?? "").trim().slice(0, 500);
    if (v) templates[k] = v;
  }
  await db.update(schema.businesses).set({ smsTemplates: templates }).where(eq(schema.businesses.id, ctx.business.id));
  revalidatePath(`/app/${d.slug}/settings/notifications`);
  return "Text wording saved";
});

/** The Inbox's quick replies: rows posted as qr_title_N / qr_body_N; a row with no body is dropped. */
export const saveQuickReplies = formAction(z.object({ slug: z.string() }), async (d, raw) => {
  const ctx = await requireAction(d.slug, "business.manage");
  const rows: { title: string; body: string }[] = [];
  for (let i = 0; i < MAX_QUICK_REPLIES; i++) {
    if (!raw.has(`qr_body_${i}`)) continue;
    rows.push({ title: String(raw.get(`qr_title_${i}`) ?? ""), body: String(raw.get(`qr_body_${i}`) ?? "") });
  }
  await db.update(schema.businesses).set({ quickReplies: normalizeQuickReplies(rows) }).where(eq(schema.businesses.id, ctx.business.id));
  revalidatePath(`/app/${d.slug}/settings/notifications`);
  return "Quick replies saved";
});
