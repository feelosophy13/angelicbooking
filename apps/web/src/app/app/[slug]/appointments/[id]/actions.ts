"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { chargeCardOnFile, openSaleForAppointment, SaleError } from "@/server/sales";
import { notifyAppointment } from "@/lib/notify";
import { parseMoney } from "@angelic/core";
import { schema as dbSchema, withTenant } from "@angelic/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
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
  await removeServiceFromAppointment({ businessId: ctx.business.id, itemId: d.itemId, actorUserId: ctx.user.id });
  revalidatePath(`/app/${d.slug}/appointments/${d.appointmentId}`);
  revalidatePath(`/app/${d.slug}`);
}

export async function startCheckout(formData: FormData) {
  const { slug, appointmentId } = base.parse(Object.fromEntries(formData));
  const ctx = await requireAction(slug, "checkout.take");
  const saleId = await openSaleForAppointment({
    businessId: ctx.business.id,
    appointmentId,
    actorUserId: ctx.user.id,
    taxRateBps: ctx.business.taxRateBps,
    currency: ctx.business.currency,
  });
  redirect(`/app/${slug}/sales/${saleId}`);
}

/** Charge the business's no-show fee (or a custom amount) to one of the client's saved cards. */
export async function chargeNoShowFee(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const d = base.extend({ paymentMethodId: z.string().min(1), amount: z.string() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "checkout.take");
  const cents = parseMoney(d.amount);
  if (cents === null || cents <= 0) return { error: "Enter an amount." };
  if (!ctx.business.stripeAccountId || !ctx.business.stripeChargesEnabled) return { error: "Connect Stripe under Settings → Payments first." };
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
    await chargeCardOnFile({ businessId: ctx.business.id, accountId: ctx.business.stripeAccountId, saleId, paymentMethodId: d.paymentMethodId, amountCents: cents, actorUserId: ctx.user.id, taxRateBps: ctx.business.taxRateBps });
    await setAppointmentStatus(ctx.business.id, d.appointmentId, "no_show", ctx.user.id, "No-show fee charged");
  } catch (e) {
    if (e instanceof SaleError || e instanceof BookingError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/app/${d.slug}/appointments/${d.appointmentId}`);
  return { ok: true };
}
