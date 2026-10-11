"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAction } from "@/lib/tenant";
import { formAction } from "@/lib/form";
import { BillingError, linkBillingTo, payerOf, portalUrl, refreshSubscription, startBilling, unlinkBilling } from "@/server/billing";
import { db, schema } from "@angelic/db";
import { eq } from "drizzle-orm";

const known = { knownErrors: [BillingError] };

export const startBillingAction = formAction(
  z.object({ slug: z.string() }),
  async (d) => {
    const { business } = await requireAction(d.slug, "business.manage");
    redirect(await startBilling(business, d.slug));
  },
  known,
);

export const openPortalAction = formAction(
  z.object({ slug: z.string() }),
  async (d) => {
    const { business } = await requireAction(d.slug, "business.manage");
    // A business billed through another opens that business's card and invoices.
    redirect(await portalUrl(await payerOf(business), d.slug));
  },
  known,
);

export const linkBillingAction = formAction(
  z.object({ slug: z.string(), payerId: z.string().min(1) }),
  async (d) => {
    const { business, user } = await requireAction(d.slug, "business.manage");
    const payer = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, d.payerId) });
    if (!payer) throw new BillingError("Business not found.");
    await linkBillingTo(user.id, business, payer);
    revalidatePath(`/app/${d.slug}`, "layout");
    return `Now billed through ${payer.name}`;
  },
  known,
);

export const unlinkBillingAction = formAction(
  z.object({ slug: z.string() }),
  async (d) => {
    const { business } = await requireAction(d.slug, "business.manage");
    await unlinkBilling(business);
    revalidatePath(`/app/${d.slug}`, "layout");
    return "This business now bills separately. Set up its own card below.";
  },
  known,
);

export const refreshBillingAction = formAction(
  z.object({ slug: z.string() }),
  async (d) => {
    const { business } = await requireAction(d.slug, "business.manage");
    await refreshSubscription(business);
    revalidatePath(`/app/${d.slug}`, "layout");
    return "Billing status refreshed";
  },
  known,
);
