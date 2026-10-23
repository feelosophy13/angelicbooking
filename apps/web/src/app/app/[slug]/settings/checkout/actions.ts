"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { auditSettings } from "@/lib/audit";
import { formAction, FormError } from "@/lib/form";
import { MAX_CONVENIENCE_CENTS, MAX_SURCHARGE_BPS, parseMoney } from "@angelic/core";

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

const on = z.string().optional().transform((v) => v === "on");

/**
 * The card fee: off, a surcharge (percent of the card payment, at most 3%) or a flat convenience fee, where it applies (desk, online deposits,
 * store) and whether debit cards are left out. Turning it on needs the owner to confirm they checked their state's rules.
 */
export const saveCardFee = formAction(
  z.object({ slug: z.string(), type: z.enum(["off", "surcharge", "convenience"]), percent: z.string().trim().optional(), amount: z.string().trim().optional(), desk: on, online: on, store: on, debitExempt: on, acknowledge: on }),
  async (d) => {
    const ctx = await requireAction(d.slug, "settings.booking");
    let cardFeeBps = 0;
    let cardFeeCents = 0;
    if (d.type === "surcharge") {
      const n = Number((d.percent ?? "").replace("%", ""));
      if (!Number.isFinite(n) || n <= 0) throw new FormError("Enter a percent, such as 3", "percent");
      cardFeeBps = Math.round(n * 100);
      if (cardFeeBps > MAX_SURCHARGE_BPS) throw new FormError("A surcharge can be at most 3%", "percent");
    } else if (d.type === "convenience") {
      const c = parseMoney(d.amount ?? "");
      if (c === null || c <= 0) throw new FormError("Enter an amount, such as 2.00", "amount");
      if (c > MAX_CONVENIENCE_CENTS) throw new FormError("Keep the fee under $100", "amount");
      cardFeeCents = c;
    }
    if (d.type !== "off") {
      if (!d.desk && !d.online && !d.store) throw new FormError("Choose at least one place to add it, or turn the fee off", "desk");
      if (!d.acknowledge) throw new FormError("Confirm you have checked your state's rules and told your processor", "acknowledge");
    }
    const set = { cardFeeType: d.type, cardFeeBps, cardFeeCents, cardFeeDesk: d.type === "off" ? true : d.desk, cardFeeOnline: d.type === "off" ? true : d.online, cardFeeStore: d.type === "off" ? true : d.store, cardFeeDebitExempt: d.type === "off" ? true : d.debitExempt };
    await db.update(schema.businesses).set(set).where(eq(schema.businesses.id, ctx.business.id));
    await auditSettings(ctx.business, ctx.user.id, "checkout", set);
    revalidatePath(`/app/${d.slug}/settings/checkout`);
    revalidatePath(`/app/${d.slug}/sales`, "layout");
    return d.type === "off" ? "Card fee turned off" : "Card fee saved";
  },
);
