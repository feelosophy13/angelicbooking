"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { f, formAction } from "@/lib/form";

export const saveStoreSettings = formAction(
  z.object({ slug: z.string(), storeEnabled: f.checkbox(), giftCardsOnline: f.checkbox(), shippingFlat: f.moneyOptional() }),
  async (d) => {
    const ctx = await requireAction(d.slug, "business.manage");
    await db.update(schema.businesses).set({ storeEnabled: d.storeEnabled, giftCardsOnline: d.giftCardsOnline, shippingFlatCents: d.shippingFlat }).where(eq(schema.businesses.id, ctx.business.id));
    revalidatePath(`/app/${d.slug}/settings/store`);
    revalidatePath(`/book/${ctx.business.slug}`, "layout");
    return "Store settings saved";
  },
);
