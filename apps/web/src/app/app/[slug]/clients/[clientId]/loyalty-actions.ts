"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { eq } from "drizzle-orm";
import { requireAction } from "@/lib/tenant";
import { f, formAction, FormError } from "@/lib/form";
import { adjustPoints, ensureReferralCode, LoyaltyError } from "@/server/loyalty";
import { adjustStoreCredit, StoreCreditError } from "@/server/store-credit";

export const adjustClientPoints = formAction(
  z.object({ slug: z.string(), clientId: f.id(), delta: z.coerce.number({ message: "Enter a number like 50 or -50" }).int("Whole points only"), note: f.optional(200) }),
  async (d) => {
    const ctx = await requireAction(d.slug, "clients.write");
    if (d.delta === 0) throw new FormError("Enter how many points to add (or a negative number to remove).", "delta");
    try {
      await adjustPoints({ businessId: ctx.business.id, clientId: d.clientId, delta: d.delta, note: d.note, actorUserId: ctx.user.id });
    } catch (e) {
      if (e instanceof LoyaltyError) throw new FormError(e.message, "delta");
      throw e;
    }
    revalidatePath(`/app/${d.slug}/clients/${d.clientId}`);
    return `${d.delta > 0 ? "Added" : "Removed"} ${Math.abs(d.delta)} points`;
  },
);

export async function createReferralCode(formData: FormData) {
  const d = z.object({ slug: z.string(), clientId: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "clients.write");
  await withTenant(ctx.business.id, async (tx) => {
    const c = await tx.query.clients.findFirst({ where: eq(schema.clients.id, d.clientId) });
    if (c) await ensureReferralCode(tx, c);
  });
  revalidatePath(`/app/${d.slug}/clients/${d.clientId}`);
}

/** Store credit up or down, with a note. Dollars in, cents stored. */
export const adjustClientStoreCredit = formAction(
  z.object({ slug: z.string(), clientId: f.id(), amount: z.string().trim(), note: f.optional(200) }),
  async (d) => {
    const ctx = await requireAction(d.slug, "clients.write");
    const n = Number(d.amount.replace(/[$,]/g, ""));
    if (!Number.isFinite(n) || n === 0) throw new FormError("Enter an amount like 25 or -25.", "amount");
    const cents = Math.round(n * 100);
    try {
      await adjustStoreCredit({ businessId: ctx.business.id, clientId: d.clientId, deltaCents: cents, note: d.note, actorUserId: ctx.user.id });
    } catch (e) {
      if (e instanceof StoreCreditError) throw new FormError(e.message, "amount");
      throw e;
    }
    revalidatePath(`/app/${d.slug}/clients/${d.clientId}`);
    return `${cents > 0 ? "Added" : "Removed"} ${(Math.abs(cents) / 100).toFixed(2)} of store credit`;
  },
);
