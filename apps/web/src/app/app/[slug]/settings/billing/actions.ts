"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireBillingAction } from "@/lib/tenant";
import { formAction } from "@/lib/form";
import { BillingError, portalUrl, refreshSubscription, startBilling } from "@/server/billing";

const known = { knownErrors: [BillingError] };

export const startBillingAction = formAction(
  z.object({ slug: z.string() }),
  async (d) => {
    const { business } = await requireBillingAction(d.slug);
    redirect(await startBilling(business, d.slug));
  },
  known,
);

export const openPortalAction = formAction(
  z.object({ slug: z.string() }),
  async (d) => {
    const { business } = await requireBillingAction(d.slug);
    redirect(await portalUrl(business, d.slug));
  },
  known,
);

export const refreshBillingAction = formAction(
  z.object({ slug: z.string() }),
  async (d) => {
    const { business } = await requireBillingAction(d.slug);
    await refreshSubscription(business);
    revalidatePath(`/app/${d.slug}`, "layout");
    return "Billing status refreshed";
  },
  known,
);
