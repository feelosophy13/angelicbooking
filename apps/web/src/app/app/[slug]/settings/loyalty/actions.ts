"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { f, formAction } from "@/lib/form";

export const saveLoyaltySettings = formAction(
  z.object({
    slug: z.string(),
    loyaltyEnabled: f.checkbox(),
    loyaltyPointsPerDollar: f.int(0, 100),
    loyaltyPointsPerVisit: f.int(0, 10000),
    loyaltyPointValueCents: f.int(1, 1000),
    loyaltyMinRedeemPoints: f.int(1, 100000),
    referralBonusPoints: f.int(0, 100000),
    referralFriendBonusPoints: f.int(0, 100000),
  }),
  async (d) => {
    const ctx = await requireAction(d.slug, "business.manage");
    await db
      .update(schema.businesses)
      .set({ loyaltyEnabled: d.loyaltyEnabled, loyaltyPointsPerDollar: d.loyaltyPointsPerDollar, loyaltyPointsPerVisit: d.loyaltyPointsPerVisit, loyaltyPointValueCents: d.loyaltyPointValueCents, loyaltyMinRedeemPoints: d.loyaltyMinRedeemPoints, referralBonusPoints: d.referralBonusPoints, referralFriendBonusPoints: d.referralFriendBonusPoints })
      .where(eq(schema.businesses.id, ctx.business.id));
    revalidatePath(`/app/${d.slug}/settings/loyalty`);
    return "Loyalty settings saved";
  },
);
