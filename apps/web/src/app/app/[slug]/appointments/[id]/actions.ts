"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { chargeCardOnFile, openSaleForAppointment, SaleError } from "@/server/sales";
import { refundDeposit } from "@/server/online-payments";
import { paymentContextForAppointment } from "@/server/locations";
import { cancelSeriesFrom } from "@/server/series";
import { formsForAppointment } from "@/server/forms";
import { triggerAppointmentWorkflows } from "@/server/workflows";
import { cancelQueuedReminders, notifyAppointment } from "@/lib/notify";
import { isInsideCancelWindow, lateCancelFee, parseMoney } from "@angelic/core";
import { schema as dbSchema, withTenant } from "@angelic/db";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { setFlash } from "@/lib/flash";
import { schema } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
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
  const ctx = await requireAction(slug, "appointments.write.any");
  const status = z.enum(schema.appointmentStatus.enumValues).parse(formData.get("status"));
  const reason = String(formData.get("reason") ?? "").trim() || null;
  await setAppointmentStatus(ctx.business.id, appointmentId, status, ctx.user.id, reason);
  if (status === "cancelled") await notifyAppointment(ctx.business, appointmentId, "cancellation");
  if (status === "completed") await triggerAppointmentWorkflows(ctx.business, "appointment_completed", appointmentId);
  revalidatePath(`/app/${slug}/appointments/${appointmentId}`);
  revalidatePath(`/app/${slug}`);
}

export async function saveNotes(formData: FormData) {
  const { slug, appointmentId } = base.parse(Object.fromEntries(formData));
  const ctx = await requireAction(slug, "appointments.write.any");
  const notes = String(formData.get("notes") ?? "").trim() || null;
  await updateAppointmentNotes(ctx.business.id, appointmentId, notes, ctx.user.id);
  revalidatePath(`/app/${slug}/appointments/${appointmentId}`);
}

export async function addService(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const d = base
    .extend({ serviceId: z.string().min(1), staffId: z.string().min(1), startAt: z.string().datetime() })
    .parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "appointments.write.any");
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
  const ctx = await requireAction(d.slug, "appointments.write.any");
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
  const ctx = await requireAction(d.slug, "appointments.write.any");
  const r = await removeServiceFromAppointment({ businessId: ctx.business.id, itemId: d.itemId, actorUserId: ctx.user.id });
  // Removing the last service cancels the visit: tell the client and drop its reminders.
  if (r?.cancelled) await notifyAppointment(ctx.business, r.appointmentId, "cancellation");
  revalidatePath(`/app/${d.slug}/appointments/${d.appointmentId}`);
  revalidatePath(`/app/${d.slug}`);
}

export async function startCheckout(formData: FormData) {
  const { slug, appointmentId, skipForms } = base.extend({ skipForms: z.string().optional() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(slug, "checkout.take");
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
  const d = base.extend({ reason: z.string().trim().max(200).optional(), chargeFee: z.string().optional(), paymentMethodId: z.string().optional() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "appointments.write.any");
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
      const saleId = await openSaleForAppointment({ businessId: ctx.business.id, appointmentId: d.appointmentId, actorUserId: ctx.user.id, taxRateBps: ctx.business.taxRateBps, currency: ctx.business.currency });
      await withTenant(ctx.business.id, async (tx) => {
        const sale = await tx.query.sales.findFirst({ where: eq(dbSchema.sales.id, saleId) });
        if (!sale || sale.status !== "open" || sale.paidCents > 0) throw new SaleError("This appointment already has a sale in progress.");
        await tx.delete(dbSchema.saleLines).where(eq(dbSchema.saleLines.saleId, saleId));
        await tx.insert(dbSchema.saleLines).values({ businessId: ctx.business.id, saleId, kind: "fee", name: "Late cancellation fee", quantity: 1, unitCents: fee.chargeCents, amountCents: fee.chargeCents, taxable: false });
        await tx.update(dbSchema.sales).set({ subtotalCents: fee.chargeCents, discountCents: 0, taxCents: 0, tipCents: 0, totalCents: fee.chargeCents }).where(eq(dbSchema.sales.id, saleId));
        await tx.insert(dbSchema.auditLog).values({ businessId: ctx.business.id, actorUserId: ctx.user.id, action: "appointment.late_fee", entity: "appointment", entityId: d.appointmentId, diff: JSON.stringify({ feeCents: fee.feeCents, depositCoversCents: fee.depositCoversCents, chargeCents: fee.chargeCents }) });
      });
      await chargeCardOnFile({ businessId: ctx.business.id, accountId: pay.accountId, saleId, paymentMethodId: d.paymentMethodId, amountCents: fee.chargeCents, actorUserId: ctx.user.id, taxRateBps: ctx.business.taxRateBps });
    }
    await setAppointmentStatus(ctx.business.id, d.appointmentId, "cancelled", ctx.user.id, reason);
    await notifyAppointment(ctx.business, d.appointmentId, "cancellation");
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
  const ctx = await requireAction(d.slug, "checkout.take");
  const cents = parseMoney(d.amount);
  if (cents === null || cents <= 0) return { error: "Enter an amount." };
  const pay = await paymentContextForAppointment(ctx.business, d.appointmentId);
  if (!pay.accountId || !pay.chargesEnabled) return { error: "Connect Stripe under Settings → Payments first." };
  try {
    const saleId = await openSaleForAppointment({ businessId: ctx.business.id, appointmentId: d.appointmentId, actorUserId: ctx.user.id, taxRateBps: ctx.business.taxRateBps, currency: ctx.business.currency });
    // Replace the service lines with a single fee line so the ticket reflects what was charged.
    await withTenant(ctx.business.id, async (tx) => {
      const sale = await tx.query.sales.findFirst({ where: eq(dbSchema.sales.id, saleId) });
      if (!sale || sale.status !== "open" || sale.paidCents > 0) throw new SaleError("This appointment already has a sale in progress.");
      await tx.delete(dbSchema.saleLines).where(eq(dbSchema.saleLines.saleId, saleId));
      await tx.insert(dbSchema.saleLines).values({ businessId: ctx.business.id, saleId, kind: "fee", name: "No-show fee", quantity: 1, unitCents: cents, amountCents: cents, taxable: false });
      await tx.update(dbSchema.sales).set({ subtotalCents: cents, discountCents: 0, taxCents: 0, tipCents: 0, totalCents: cents }).where(eq(dbSchema.sales.id, saleId));
    });
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
  const ctx = await requireAction(slug, "reports.view"); // same bar as other refunds
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
  const ctx = await requireAction(slug, "appointments.write.any");
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
