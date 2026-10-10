"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { f, formAction } from "@/lib/form";

const url = z.string().trim().max(500).refine((v) => !v || /^https?:\/\/\S+$/i.test(v), "Enter a full URL starting with https://").transform((v) => v || null);

export const saveReviewSettings = formAction(
  z.object({ slug: z.string(), reviewRequestEnabled: f.checkbox(), reviewRequestDelayHours: f.int(0, 168), googleReviewUrl: url }),
  async (d) => {
    const ctx = await requireAction(d.slug, "business.manage");
    await db.update(schema.businesses).set({ reviewRequestEnabled: d.reviewRequestEnabled, reviewRequestDelayHours: d.reviewRequestDelayHours, googleReviewUrl: d.googleReviewUrl }).where(eq(schema.businesses.id, ctx.business.id));
    revalidatePath(`/app/${d.slug}/settings/reviews`);
    return "Review settings saved";
  },
);
