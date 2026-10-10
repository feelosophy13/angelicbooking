"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { formAction } from "@/lib/form";
import { SMS_TEMPLATE_KEYS } from "@/lib/notify/sms";

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
