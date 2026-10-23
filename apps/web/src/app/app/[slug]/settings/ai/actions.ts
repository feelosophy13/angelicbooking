"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { f, formAction } from "@/lib/form";

export const saveAiSettings = formAction(z.object({ slug: z.string(), budget: f.money("limit"), aiChatbotEnabled: f.checkbox() }), async (d) => {
  const ctx = await requireAction(d.slug, "settings.business");
  const cents = Math.min(d.budget, 50_000);
  await db.update(schema.businesses).set({ aiMonthlyBudgetCents: cents, aiChatbotEnabled: d.aiChatbotEnabled }).where(eq(schema.businesses.id, ctx.business.id));
  await withTenant(ctx.business.id, (tx) => tx.insert(schema.auditLog).values({ businessId: ctx.business.id, actorUserId: ctx.user.id, action: "ai.settings", entity: "business", entityId: ctx.business.id, diff: JSON.stringify({ budgetCents: cents, chatbot: d.aiChatbotEnabled }) }));
  revalidatePath(`/app/${d.slug}/settings/ai`);
  return "AI settings saved";
});
