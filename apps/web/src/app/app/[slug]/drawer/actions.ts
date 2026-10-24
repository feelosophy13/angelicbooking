"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DENOMINATIONS } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { addDrawerMovement, closeDrawer, correctClosedDrawer, DrawerError, openDrawer, removeDrawerMovement } from "@/server/drawer";
import { formatMoney } from "@/lib/utils";

const asForm = (e: unknown) => (e instanceof DrawerError ? new FormError(e.message, e.field) : e);

export const openDrawerAction = formAction(
  z.object({ slug: z.string(), locationId: f.id(), register: f.optional(40).optional(), float: f.money("float") }),
  async (d) => {
    const ctx = await requireAction(d.slug, "drawer.manage");
    try {
      await openDrawer({ businessId: ctx.business.id, locationId: d.locationId, register: d.register ?? "Main", openingFloatCents: d.float, actorUserId: ctx.user.id });
    } catch (e) {
      throw asForm(e);
    }
    await setFlash(`Drawer opened with ${formatMoney(d.float, ctx.business.currency)}`);
    revalidatePath(`/app/${d.slug}/drawer`);
    redirect(`/app/${d.slug}/drawer?location=${d.locationId}`);
  },
);

export const drawerMovementAction = formAction(
  z.object({ slug: z.string(), sessionId: f.id(), kind: z.enum(["pay_in", "payout", "tip_payout"]), amount: f.money(), reason: f.text(1, 120), staffId: f.optional(80).optional() }),
  async (d) => {
    const ctx = await requireAction(d.slug, "drawer.manage");
    if (d.kind === "tip_payout" && !d.staffId) throw new FormError("Choose who was paid.", "staffId");
    try {
      await addDrawerMovement({ businessId: ctx.business.id, sessionId: d.sessionId, kind: d.kind, amountCents: d.amount, reason: d.reason, staffId: d.staffId, actorUserId: ctx.user.id, currency: ctx.business.currency });
    } catch (e) {
      throw asForm(e);
    }
    revalidatePath(`/app/${d.slug}/drawer`);
    return d.kind === "pay_in" ? "Pay-in recorded" : d.kind === "tip_payout" ? "Tip payout recorded" : "Payout recorded";
  },
);

export async function removeDrawerMovementAction(formData: FormData) {
  const d = z.object({ slug: z.string(), movementId: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "drawer.manage");
  try {
    await removeDrawerMovement({ businessId: ctx.business.id, movementId: d.movementId, actorUserId: ctx.user.id });
  } catch (e) {
    if (e instanceof DrawerError) return setFlash(e.message, "error");
    throw e;
  }
  await setFlash("Removed");
  revalidatePath(`/app/${d.slug}/drawer`);
}

export const closeDrawerAction = formAction(
  z.object({ slug: z.string(), sessionId: f.id(), mode: z.enum(["total", "denominations"]), counted: f.moneyOptional().optional(), note: f.optional(500) }),
  async (d, formData) => {
    const ctx = await requireAction(d.slug, "drawer.manage");
    let denominations: Record<string, number> | null = null;
    if (d.mode === "denominations") {
      denominations = {};
      for (const { cents } of DENOMINATIONS) {
        const raw = String(formData.get(`d${cents}`) ?? "").trim();
        if (!raw) continue;
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0 || n > 100_000) throw new FormError("Enter how many of each, in whole numbers.", `d${cents}`);
        if (n) denominations[String(cents)] = n;
      }
    } else if (!String(formData.get("counted") ?? "").trim()) throw new FormError("Enter the amount counted.", "counted");
    let result: Awaited<ReturnType<typeof closeDrawer>>;
    try {
      result = await closeDrawer({ businessId: ctx.business.id, sessionId: d.sessionId, countedCents: d.mode === "total" ? d.counted : null, denominations, note: d.note, actorUserId: ctx.user.id, currency: ctx.business.currency });
    } catch (e) {
      throw asForm(e);
    }
    const diff = result.overShortCents;
    await setFlash(diff === 0 ? "Drawer closed. It balances." : `Drawer closed, ${formatMoney(Math.abs(diff), ctx.business.currency)} ${diff > 0 ? "over" : "short"}.`);
    revalidatePath(`/app/${d.slug}/drawer`);
    redirect(`/app/${d.slug}/drawer/${d.sessionId}`);
  },
);

/** Correct a closed drawer (recount, or a missed pay-in / payout / tip payout). Managers and owners: it needs reports.view. */
export const correctDrawerAction = formAction(
  z.object({
    slug: z.string(),
    sessionId: f.id(),
    counted: f.moneyOptional().optional(),
    missedKind: z.enum(["", "pay_in", "payout", "tip_payout"]).default(""),
    missedAmount: f.moneyOptional().optional(),
    missedReason: f.optional(120).optional(),
    missedStaffId: f.optional(80).optional(),
    reason: f.text(1, 300),
  }),
  async (d) => {
    const ctx = await requireAction(d.slug, "reports.view");
    if (d.missedKind && !d.missedAmount) throw new FormError("Enter the missed amount.", "missedAmount");
    const missed = d.missedKind && d.missedAmount ? { kind: d.missedKind, amountCents: d.missedAmount, reason: d.missedReason || (d.missedKind === "tip_payout" ? "Cash tip" : d.missedKind === "pay_in" ? "Pay-in" : "Payout"), staffId: d.missedStaffId || null } : null;
    try {
      await correctClosedDrawer({ businessId: ctx.business.id, sessionId: d.sessionId, countedCents: d.counted ?? null, missed, reason: d.reason, actorUserId: ctx.user.id, actorName: ctx.user.name });
    } catch (e) {
      throw asForm(e);
    }
    revalidatePath(`/app/${d.slug}/drawer/${d.sessionId}`);
    revalidatePath(`/app/${d.slug}/drawer/history`);
    return "Close-out corrected";
  },
);
