"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { chargeCardOnFile, openFeeSaleForAppointment, openSaleForAppointment, SaleError } from "@/server/sales";
import { refundDeposit } from "@/server/online-payments";
import { paymentContextForAppointment } from "@/server/locations";
import { cancelSeriesFrom } from "@/server/series";
import { formsForAppointment } from "@/server/forms";
import { triggerAppointmentWorkflows } from "@/server/workflows";
import { cancelQueuedReminders, notifyAppointment } from "@/lib/notify";
import { can, isInsideCancelWindow, lateCancelFee, parseMoney } from "@angelic/core";
import { withTenant } from "@angelic/db";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { setFlash } from "@/lib/flash";
import { InventoryError, logUsage, undoUsage } from "@/server/inventory";
import { schema } from "@angelic/db";
import { PermissionError, requireAction, requireBusiness } from "@/lib/tenant";
import { modeForKind, requireAppointmentAccess } from "@/server/appointment-access";
import {
  addServiceToAppointment,
  BookingError,
  removeServiceFromAppointment,
  rescheduleService,
  setAppointmentStatus,
  updateAppointmentNotes,
} from "@/server/booking";

export type ActionState = { error?: string; ok?: boolean } | undefined;

const base = z.object({ slug: z.string(), appointmentId: z.string().min(1) });

export async function changeStatus(formData: FormData) {
  const { slug, appointmentId } = base.parse(Object.fromEntries(formData));
  const status = z.enum(schema.appointmentStatus.enumValues).parse(formData.get("status"));
  // Cancelling is its own permission, removing blocked time is another; every other status change is part of updating an appointment.
  const ctx = await requireAppointmentAccess(slug, appointmentId, await modeForKind((await requireBusiness(slug)).business.id, appointmentId, status === "cancelled" ? "cancel" : "write"));
  const reason = String(formData.get("reason") ?? "").trim() || null;
  // A visit is cancelled through Cancel (reason, deposit, fee); this button only removes blocks and class seats.
  const kind = await withTenant(ctx.business.id, async (tx) => (await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, appointmentId), columns: { kind: true } }))?.kind);
  const seat = await withTenant(ctx.business.id, async (tx) => !!(await tx.query.appointmentItems.findFirst({ where: and(eq(schema.appointmentItems.appointmentId, appointmentId), isNotNull(schema.appointmentItems.classSessionId)), columns: { id: true } })));
  if (status === "cancelled" && kind === "visit" && !seat) {
    await setFlash("Use Cancel on the appointment to choose a reason.", "error");
    revalidatePath(`/app/${slug}/appointments/${appointmentId}`);
    return;
  }
  let changed = false;
  try {
    changed = await setAppointmentStatus(ctx.business.id, appointmentId, status, ctx.user.id, reason);
  } catch (e) {
    if (e instanceof BookingError) {
      await setFlash(e.message, "error");
      revalidatePath(`/app/${slug}/appointments/${appointmentId}`);
      return;
    }
    throw e;
  }
  if (changed && status === "cancelled") await notifyAppointment(ctx.business, appointmentId, "cancellation");
  if (changed && status === "completed") await triggerAppointmentWorkflows(ctx.business, "appointment_completed", appointmentId);
  revalidatePath(`/app/${slug}/appointments/${appointmentId}`);
  revalidatePath(`/app/${slug}`);
}

export async function saveNotes(formData: FormData) {
  const { slug, appointmentId } = base.parse(Object.fromEntries(formData));
  const ctx = await requireAppointmentAccess(slug, appointmentId, "write", { shared: "allow" });
  const notes = String(formData.get("notes") ?? "").trim() || null;
  await updateAppointmentNotes(ctx.business.id, appointmentId, notes, ctx.user.id);
  revalidatePath(`/app/${slug}/appointments/${appointmentId}`);
}

export async function addService(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const d = base
    .extend({ serviceId: z.string().min(1), staffId: z.string().min(1), startAt: z.string().datetime() })
    .parse(Object.fromEntries(formData));
  const ctx = await requireAppointmentAccess(d.slug, d.appointmentId, "change", { shared: "allow" });
  if (ctx.access !== "any" && d.staffId !== ctx.staffId) return { error: "You can only add services on your own calendar." };
  try {
    await addServiceToAppointment({
      businessId: ctx.business.id,
      appointmentId: d.appointmentId,
      serviceId: d.serviceId,
      staffId: d.staffId,
      startAt: new Date(d.startAt),
      actorUserId: ctx.user.id,
    });
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/app/${d.slug}/appointments/${d.appointmentId}`);
  revalidatePath(`/app/${d.slug}`);
  return { ok: true };
}

export async function moveService(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const d = base
    .extend({ itemId: z.string().min(1), startAt: z.string().datetime(), staffId: z.string().min(1) })
    .parse(Object.fromEntries(formData));
  const ctx = await requireAppointmentAccess(d.slug, d.appointmentId, "change", { line: d.itemId });
  if (ctx.access !== "any" && d.staffId !== ctx.staffId) return { error: "You can only move appointments within your own calendar." };
  try {
    await rescheduleService({
      businessId: ctx.business.id,
      itemId: d.itemId,
      newStartAt: new Date(d.startAt),
      newStaffId: d.staffId,
      actorUserId: ctx.user.id,
    });
    await notifyAppointment(ctx.business, d.appointmentId, "rescheduled");
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/app/${d.slug}/appointments/${d.appointmentId}`);
  revalidatePath(`/app/${d.slug}`);
  return { ok: true };
}

export async function removeService(formData: FormData) {
  const d = base.extend({ itemId: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAppointmentAccess(d.slug, d.appointmentId, "change", { line: d.itemId });
  const r = await removeServiceFromAppointment({ businessId: ctx.business.id, itemId: d.itemId, actorUserId: ctx.user.id });
  // Removing the last service cancels the visit: tell the client and drop its reminders.
  if (r?.cancelled) await notifyAppointment(ctx.business, r.appointmentId, "cancellation");
  revalidatePath(`/app/${d.slug}/appointments/${d.appointmentId}`);
  revalidatePath(`/app/${d.slug}`);
}

export async function startCheckout(formData: FormData) {
  const { slug, appointmentId, skipForms } = base.extend({ skipForms: z.string().optional() }).parse(Object.fromEntries(formData));
  // The ticket credits each line to its own stylist, so checking out a visit shared with a colleague takes nothing from them.
  const ctx = await requireAppointmentAccess(slug, appointmentId, "write", { shared: "allow" });
  if (!can(ctx.permissions, "checkout.take")) throw new PermissionError();
  // Required forms are prompted for at checkout; the desk can still proceed deliberately.
  if (!skipForms) {
    const due = (await withTenant(ctx.business.id, (tx) => formsForAppointment(tx, appointmentId))).filter((f) => !f.current);
    if (due.length) {
      await setFlash(`${due.length} required form${due.length === 1 ? "" : "s"} still outstanding (${due.map((f) => f.form.name).join(", ")}). Complete them, or choose "Check out anyway".`, "error");
      revalidatePath(`/app/${slug}/appointments/${appointmentId}`);
      return;
    }
  }
  const saleId = await openSaleForAppointment({
    businessId: ctx.business.id,
    appointmentId,
    actorUserId: ctx.user.id,
    taxRateBps: ctx.business.taxRateBps,
    currency: ctx.business.currency,
  });
  redirect(`/app/${slug}/sales/${saleId}`);
}

/**
 * Cancel from the appointment page. Inside the cancellation window with a fee set, optionally
 * charge what the deposit doesn't cover to a saved card; the fee lands on a ticket of its own.
 */
export async function cancelAppointment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const d = base.extend({ reason: z.string().trim().max(200).optional(), reasonId: z.string().optional(), chargeFee: z.string().optional(), paymentMethodId: z.string().optional(), deposit: z.enum(["keep", "fee_only", "refund_all"]).optional() }).parse(Object.fromEntries(formData));
  const ctx = await requireAppointmentAccess(d.slug, d.appointmentId, "cancel");
  // What happens to a paid deposit is the salon's call when staff cancel: keep it, keep only the late fee, or give it all back. Giving money back needs the refund permission.
  if (!d.reasonId) return { error: "Choose why it is being cancelled." };
  const choice = d.deposit ?? "keep";
  if (choice !== "keep" && !can(ctx.permissions, "checkout.refund")) throw new PermissionError();
  const reason = d.reason || null;
  try {
    if (d.chargeFee === "on" && d.paymentMethodId) {
      const { appt, servicesCents, startAt } = await withTenant(ctx.business.id, async (tx) => {
        const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, d.appointmentId) });
        const items = appt ? await tx.select({ priceCents: schema.appointmentItems.priceCents, startAt: schema.appointmentItems.startAt, status: schema.appointmentItems.status }).from(schema.appointmentItems).where(eq(schema.appointmentItems.appointmentId, d.appointmentId)).orderBy(asc(schema.appointmentItems.startAt)) : [];
        const live = items.filter((i) => i.status !== "cancelled");
        return { appt, servicesCents: live.reduce((n, i) => n + i.priceCents, 0), startAt: live[0]?.startAt ?? null };
      });
      if (!appt || !startAt) return { error: "Appointment not found." };
      if (!isInsideCancelWindow(startAt, ctx.business.cancelWindowHours)) return { error: "This appointment is outside the cancellation window; no fee applies." };
      const fee = lateCancelFee({ feeType: ctx.business.lateCancelFeeType as "none" | "flat" | "percent", feeValue: ctx.business.lateCancelFeeValue, deposit: ctx.business.lateCancelDeposit as "toward" | "extra" }, servicesCents, appt.depositStatus === "paid" ? appt.depositCents : 0);
      if (fee.chargeCents <= 0) return { error: "Nothing to charge: the deposit covers the fee." };
      const pay = await paymentContextForAppointment(ctx.business, d.appointmentId);
      if (!pay.accountId || !pay.chargesEnabled) return { error: "Connect Stripe under Settings → Payments first." };
      // A fee-only ticket: the deposit stays on the appointment (kept or refunded below), the visit is not marked completed.
      const saleId = await openFeeSaleForAppointment({ businessId: ctx.business.id, appointmentId: d.appointmentId, name: "Late cancellation fee", feeCents: fee.chargeCents, actorUserId: ctx.user.id, taxRateBps: ctx.business.taxRateBps, currency: ctx.business.currency, auditAction: "appointment.late_fee", auditDiff: { feeCents: fee.feeCents, depositCoversCents: fee.depositCoversCents, chargeCents: fee.chargeCents } });
      await chargeCardOnFile({ businessId: ctx.business.id, accountId: pay.accountId, saleId, paymentMethodId: d.paymentMethodId, amountCents: fee.chargeCents, actorUserId: ctx.user.id, taxRateBps: ctx.business.taxRateBps });
    }
    // The refund amount is worked out here, not taken from the form: all of it, or what is left after the late fee the deposit covers.
    let refundCents: number | null = null;
    if (choice !== "keep") {
      const info = await withTenant(ctx.business.id, async (tx) => {
        const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, d.appointmentId) });
        const items = appt ? await tx.select({ priceCents: schema.appointmentItems.priceCents, startAt: schema.appointmentItems.startAt, status: schema.appointmentItems.status }).from(schema.appointmentItems).where(eq(schema.appointmentItems.appointmentId, d.appointmentId)) : [];
        const live = items.filter((i) => i.status !== "cancelled");
        return { appt, servicesCents: live.reduce((n, i) => n + i.priceCents, 0), startAt: live[0]?.startAt ?? null };
      });
      if (info.appt?.depositStatus === "paid" && info.appt.depositCents > 0) {
        if (choice === "refund_all") refundCents = info.appt.depositCents;
        else if (info.startAt && isInsideCancelWindow(info.startAt, ctx.business.cancelWindowHours)) {
          const policy = { feeType: ctx.business.lateCancelFeeType as "none" | "flat" | "percent", feeValue: ctx.business.lateCancelFeeValue, deposit: ctx.business.lateCancelDeposit as "toward" | "extra" };
          const fee = lateCancelFee(policy, info.servicesCents, info.appt.depositCents);
          const excess = info.appt.depositCents - (policy.deposit === "toward" ? fee.depositCoversCents : info.appt.depositCents);
          if (excess > 0) refundCents = excess;
        }
      }
    }
    const changed = await setAppointmentStatus(ctx.business.id, d.appointmentId, "cancelled", ctx.user.id, reason, d.reasonId);
    if (changed) await notifyAppointment(ctx.business, d.appointmentId, "cancellation");
    if (refundCents) {
      try {
        const pay = await paymentContextForAppointment(ctx.business, d.appointmentId);
        await refundDeposit({ businessId: ctx.business.id, accountId: pay.accountId, appointmentId: d.appointmentId, actorUserId: ctx.user.id, reason: choice === "refund_all" ? "Cancelled by the salon: deposit refunded" : "Cancelled late: deposit refunded except the fee", amountCents: refundCents });
      } catch (e) {
        revalidatePath(`/app/${d.slug}/appointments/${d.appointmentId}`);
        return { error: `The appointment is cancelled, but the deposit refund did not go through${e instanceof BookingError ? `: ${e.message}` : ""}. Use "Refund deposit" on this page.` };
      }
    }
  } catch (e) {
    if (e instanceof SaleError || e instanceof BookingError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/app/${d.slug}/appointments/${d.appointmentId}`);
  revalidatePath(`/app/${d.slug}`);
  return { ok: true };
}

/** Charge the business's no-show fee (or a custom amount) to one of the client's saved cards. */
export async function chargeNoShowFee(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const d = base.extend({ paymentMethodId: z.string().min(1), amount: z.string() }).parse(Object.fromEntries(formData));
  // Charging a no-show fee and marking it a no-show is cancelling: it needs that permission and checkout.
  const ctx = await requireAppointmentAccess(d.slug, d.appointmentId, "cancel");
  if (!can(ctx.permissions, "checkout.take")) throw new PermissionError();
  const cents = parseMoney(d.amount);
  if (cents === null || cents <= 0) return { error: "Enter an amount." };
  const pay = await paymentContextForAppointment(ctx.business, d.appointmentId);
  if (!pay.accountId || !pay.chargesEnabled) return { error: "Connect Stripe under Settings → Payments first." };
  try {
    // A fee-only ticket: closing it doesn't mark the visit completed or award points; a paid deposit stays on the appointment.
    const saleId = await openFeeSaleForAppointment({ businessId: ctx.business.id, appointmentId: d.appointmentId, name: "No-show fee", feeCents: cents, actorUserId: ctx.user.id, taxRateBps: ctx.business.taxRateBps, currency: ctx.business.currency, auditAction: "appointment.no_show_fee", auditDiff: { cents } });
    await chargeCardOnFile({ businessId: ctx.business.id, accountId: pay.accountId, saleId, paymentMethodId: d.paymentMethodId, amountCents: cents, actorUserId: ctx.user.id, taxRateBps: ctx.business.taxRateBps });
    await setAppointmentStatus(ctx.business.id, d.appointmentId, "no_show", ctx.user.id, "No-show fee charged");
  } catch (e) {
    if (e instanceof SaleError || e instanceof BookingError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/app/${d.slug}/appointments/${d.appointmentId}`);
  return { ok: true };
}

/** Give back a deposit paid at online booking (only while it has not been applied to a sale). */
export async function refundDepositAction(formData: FormData) {
  const { slug, appointmentId } = base.parse(Object.fromEntries(formData));
  const ctx = await requireAction(slug, "checkout.refund"); // same bar as other refunds
  try {
    const pay = await paymentContextForAppointment(ctx.business, appointmentId);
    const done = await refundDeposit({ businessId: ctx.business.id, accountId: pay.accountId, appointmentId, actorUserId: ctx.user.id, reason: "Refunded by staff" });
    await setFlash(done ? "Deposit refunded" : "Nothing to refund", done ? "success" : "info");
  } catch (e) {
    if (e instanceof BookingError) await setFlash(e.message, "error");
    else throw e;
  }
  revalidatePath(`/app/${slug}/appointments/${appointmentId}`);
}

/** Cancel this visit and all later visits in its standing series. */
export async function cancelSeries(formData: FormData) {
  const { slug, appointmentId } = base.parse(Object.fromEntries(formData));
  const ctx = await requireAppointmentAccess(slug, appointmentId, "cancel");
  const reason = String(formData.get("reason") ?? "").trim() || null;
  let ids: string[] = [];
  try {
    ids = await cancelSeriesFrom({ businessId: ctx.business.id, appointmentId, actorUserId: ctx.user.id, reason });
  } catch (e) {
    if (e instanceof BookingError) {
      await setFlash(e.message, "error");
      revalidatePath(`/app/${slug}/appointments/${appointmentId}`);
      return;
    }
    throw e;
  }
  // The client hears about the first cancelled visit; the later visits only lose their queued reminders.
  if (ids[0]) await notifyAppointment(ctx.business, ids[0], "cancellation");
  for (const id of ids.slice(1)) await cancelQueuedReminders(ctx.business.id, id);
  await setFlash(`Cancelled ${ids.length} visit${ids.length === 1 ? "" : "s"}`);
  revalidatePath(`/app/${slug}/appointments/${appointmentId}`);
  revalidatePath(`/app/${slug}`);
}

/** Staff record the supplies they used on this visit: the suggested products (quantities as edited) and, optionally, one more. */
export async function logSupplies(formData: FormData) {
  const { slug, appointmentId } = base.parse(Object.fromEntries(formData));
  const ctx = await requireAppointmentAccess(slug, appointmentId, "write", { shared: "allow" });
  if (!can(ctx.permissions, "inventory.log")) throw new PermissionError();
  const items: { productId: string; qty: number }[] = [];
  for (const [key, v] of formData.entries()) {
    if (!key.startsWith("qty:")) continue;
    const qty = Number(String(v));
    if (Number.isInteger(qty) && qty > 0) items.push({ productId: key.slice(4), qty });
  }
  const extra = String(formData.get("extraProductId") ?? "");
  const extraQty = Number(String(formData.get("extraQty") ?? ""));
  if (extra && Number.isInteger(extraQty) && extraQty > 0) items.push({ productId: extra, qty: extraQty });
  try {
    const n = await logUsage({ businessId: ctx.business.id, appointmentId, items, note: null, actorUserId: ctx.user.id });
    await setFlash(`Logged ${n} unit${n === 1 ? "" : "s"} used`, "success");
  } catch (e) {
    if (e instanceof InventoryError) await setFlash(e.message, "error");
    else throw e;
  }
  revalidatePath(`/app/${slug}/appointments/${appointmentId}`);
}

export async function undoSupplies(formData: FormData) {
  const { slug, appointmentId } = base.parse(Object.fromEntries(formData));
  const ctx = await requireAppointmentAccess(slug, appointmentId, "write", { shared: "allow" });
  if (!can(ctx.permissions, "inventory.log")) throw new PermissionError();
  try {
    await undoUsage({ businessId: ctx.business.id, appointmentId, productId: String(formData.get("productId")), qty: Number(String(formData.get("qty") ?? "0")), actorUserId: ctx.user.id });
    await setFlash("Taken back", "success");
  } catch (e) {
    if (e instanceof InventoryError) await setFlash(e.message, "error");
    else throw e;
  }
  revalidatePath(`/app/${slug}/appointments/${appointmentId}`);
}
