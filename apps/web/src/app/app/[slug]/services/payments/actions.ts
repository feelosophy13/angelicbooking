"use server";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { f, formAction, FormError } from "@/lib/form";
import { revalidatePath } from "next/cache";

/** Set what online booking collects up front for every ticked service. */
export const applyOnlinePayment = formAction(
  z.object({
    slug: z.string(),
    depositType: z.enum(["flat", "percent", "full"]).default("flat"),
    deposit: f.moneyOptional(),
    depositPercent: z.coerce.number().int().min(0).max(100).default(0),
  }),
  async (d, raw) => {
    const ctx = await requireAction(d.slug, "services.manage");
    const ids = raw.getAll("id").map(String);
    if (!ids.length) throw new FormError("Tick at least one service");
    if (d.depositType === "percent" && d.depositPercent < 1) throw new FormError("Enter a percent from 1 to 100", "depositPercent");
    await withTenant(ctx.business.id, (tx) =>
      tx
        .update(schema.services)
        .set({
          depositType: d.depositType,
          depositCents: d.depositType === "flat" ? d.deposit : 0,
          depositPercent: d.depositType === "percent" ? d.depositPercent : 0,
        })
        .where(inArray(schema.services.id, ids)),
    );
    revalidatePath(`/app/${d.slug}/services`, "layout");
    const what = d.depositType === "full" ? "full payment" : d.depositType === "percent" ? `a ${d.depositPercent}% deposit` : d.deposit ? "a fixed deposit" : "no payment up front";
    return `${ids.length} service${ids.length === 1 ? "" : "s"} now take ${what}`;
  },
);
