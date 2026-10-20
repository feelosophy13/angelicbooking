"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { auditSettings } from "@/lib/audit";
import { formAction, FormError } from "@/lib/form";

const pct = z.string().trim().optional();

/** The tip percentages offered at checkout, on the client tip screen and in the staff tip form: one to four, each 1–100. */
export const saveTipChoices = formAction(
  z.object({ slug: z.string(), tip1: pct, tip2: pct, tip3: pct, tip4: pct }),
  async (d) => {
    const ctx = await requireAction(d.slug, "settings.booking");
    const picked: number[] = [];
    for (const [key, raw] of [["tip1", d.tip1], ["tip2", d.tip2], ["tip3", d.tip3], ["tip4", d.tip4]] as const) {
      if (!raw) continue;
      const n = Number(raw.replace("%", ""));
      if (!Number.isInteger(n) || n < 1 || n > 100) throw new FormError("A whole percent from 1 to 100", key);
      picked.push(n);
    }
    const tipPercents = [...new Set(picked)].sort((a, b) => a - b);
    if (!tipPercents.length) throw new FormError("Offer at least one tip choice", "tip1");
    await db.update(schema.businesses).set({ tipPercents }).where(eq(schema.businesses.id, ctx.business.id));
    await auditSettings(ctx.business, ctx.user.id, "checkout", { tipPercents });
    revalidatePath(`/app/${d.slug}/settings/checkout`);
    revalidatePath(`/app/${d.slug}/sales`, "layout");
    return "Tip choices saved";
  },
);
