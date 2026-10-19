"use server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { schema } from "@angelic/db";
import { can, zonedToInstant } from "@angelic/core";
import { requireAction, requireBusiness } from "@/lib/tenant";
import { modeForKind, requireAppointmentAccess, requireBlockAccess, requireBookingAccess } from "@/server/appointment-access";
import { blockTime, bookAppointment, BookingError, OverlapError, rescheduleAppointment, rescheduleService, setAppointmentStatus } from "@/server/booking";
import { tzFor } from "@/server/locations";
import { afterAppointmentBooked, notifyAppointment } from "@/lib/notify";
import { triggerAppointmentWorkflows } from "@/server/workflows";
import { schema as dbSchema, withTenant } from "@angelic/db";
import { eq } from "drizzle-orm";

const statusSchema = z.enum(schema.appointmentStatus.enumValues);

export async function updateAppointmentStatus(formData: FormData) {
  const slug = String(formData.get("slug"));
  const appointmentId = String(formData.get("appointmentId"));
  const status = statusSchema.parse(formData.get("status"));
  const ctx = await requireAppointmentAccess(slug, appointmentId, await modeForKind((await requireBusiness(slug)).business.id, appointmentId, status === "cancelled" ? "cancel" : "write"));
  // Visits are cancelled from the appointment's Cancel (reason, deposit, fee); here only blocks are removed.
  const kind = await withTenant(ctx.business.id, async (tx) => (await tx.query.appointments.findFirst({ where: eq(dbSchema.appointments.id, appointmentId), columns: { kind: true } }))?.kind);
  if (status === "cancelled" && kind === "visit") return;
  let changed = false;
  try {
    changed = await setAppointmentStatus(ctx.business.id, appointmentId, status, ctx.user.id);
  } catch (e) {
    if (!(e instanceof BookingError)) throw e;
  }
  if (changed && status === "cancelled") await notifyAppointment(ctx.business, appointmentId, "cancellation");
  revalidatePath(`/app/${slug}`);
}

export type MoveResult = { ok: true } | { ok: false; error: string };

/** Called from the calendar after a drag. */
export async function moveAppointmentItem(input: {
  slug: string;
  itemId: string;
  newStartISO: string;
  newStaffId?: string | null;
}): Promise<MoveResult> {
  const parsed = z
    .object({ slug: z.string(), itemId: z.string().min(1), newStartISO: z.string().datetime(), newStaffId: z.string().nullish() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid move" };
  // A Provider may move their own appointments, but not to someone else's column.
  const bizId = (await requireBusiness(parsed.data.slug)).business.id;
  const itemRow = await withTenant(bizId, (tx) => tx.query.appointmentItems.findFirst({ where: eq(dbSchema.appointmentItems.id, parsed.data.itemId), columns: { appointmentId: true } }));
  if (!itemRow) return { ok: false, error: "That appointment no longer exists." };
  // Dragging a block of time is a block permission; dragging a visit is a change to the booking.
  const ctx = await requireAppointmentAccess(parsed.data.slug, itemRow.appointmentId, await modeForKind(bizId, itemRow.appointmentId, "change"), { line: parsed.data.itemId });
  if (ctx.access !== "any" && parsed.data.newStaffId && parsed.data.newStaffId !== ctx.staffId) return { ok: false, error: "You can only move your own appointments to your own column." };
  try {
    const newStartAt = new Date(parsed.data.newStartISO);
    // A visit with several services moves as one when it is dragged to a new time in the same column (each service keeps its place
    // relative to the others). Dropping it in another stylist's column hands over just that service. Someone who shares the visit with a
    // colleague moves only their own service: moving it as one would move the colleague's too.
    const items = await withTenant(ctx.business.id, (tx) => tx.select().from(dbSchema.appointmentItems).where(eq(dbSchema.appointmentItems.appointmentId, itemRow.appointmentId)));
    const live = items.filter((i) => i.status !== "cancelled" && i.status !== "completed" && i.status !== "no_show");
    const dragged = live.find((i) => i.id === parsed.data.itemId);
    const sameColumn = !parsed.data.newStaffId || parsed.data.newStaffId === dragged?.staffId;
    if (dragged && sameColumn && live.length > 1 && !dragged.classSessionId && ctx.access !== "shared") {
      const first = live.reduce((a, b) => (a.startAt < b.startAt ? a : b));
      await rescheduleAppointment({ businessId: ctx.business.id, appointmentId: itemRow.appointmentId, newStartAt: new Date(newStartAt.getTime() - (dragged.startAt.getTime() - first.startAt.getTime())), actorUserId: ctx.user.id });
    } else {
      await rescheduleService({
        businessId: ctx.business.id,
        itemId: parsed.data.itemId,
        newStartAt,
        newStaffId: parsed.data.newStaffId ?? null,
        actorUserId: ctx.user.id,
      });
    }
    const item = await withTenant(ctx.business.id, (tx) => tx.query.appointmentItems.findFirst({ where: eq(dbSchema.appointmentItems.id, parsed.data.itemId) }));
    if (item) await notifyAppointment(ctx.business, item.appointmentId, "rescheduled");
  } catch (e) {
    if (e instanceof BookingError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath(`/app/${parsed.data.slug}`);
  return { ok: true };
}

/** Hover quick action on the calendar: check in / complete without opening the appointment. */
export async function quickStatus(input: { slug: string; appointmentId: string; status: "checked_in" | "completed" | "confirmed" }): Promise<MoveResult> {
  const parsed = z.object({ slug: z.string(), appointmentId: z.string().min(1), status: z.enum(["checked_in", "completed", "confirmed"]) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid" };
  const ctx = await requireAppointmentAccess(parsed.data.slug, parsed.data.appointmentId, "write");
  await setAppointmentStatus(ctx.business.id, parsed.data.appointmentId, parsed.data.status, ctx.user.id);
  if (parsed.data.status === "completed") await triggerAppointmentWorkflows(ctx.business, "appointment_completed", parsed.data.appointmentId);
  revalidatePath(`/app/${parsed.data.slug}`);
  return { ok: true };
}

/** The owner has seen the setup checklist enough; keep it off the calendar on this device. */
export async function hideSetupChecklist(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireAction(slug, "business.manage");
  (await cookies()).set(`setup-hidden-${ctx.business.id}`, "1", { path: "/", maxAge: 365 * 86_400, sameSite: "lax" });
  revalidatePath(`/app/${slug}`);
}

export type QuickBookResult = { ok: true; appointmentId: string; when: string } | { ok: false; error: string; /** The time clashed; whoever may double-book is offered "Book anyway". */ overlap?: boolean };

/**
 * The calendar's quick-create popover: one service, one provider, a time (the full New appointment page has the rest: more services,
 * repeats, notes). The same rules as the full form: own-calendar roles book only on their own column, ids must be this business's,
 * the client hears about it unless the desk unticks that, and a clash offers "Book anyway" only to those who may double-book.
 */
export async function quickBook(input: { slug: string; clientId: string | null; serviceId: string; staffId: string; date: string; time: string; locationId: string | null; sendConfirmation: boolean; doubleBook?: boolean }): Promise<QuickBookResult> {
  const parsed = z
    .object({ slug: z.string(), clientId: z.string().nullable(), serviceId: z.string().min(1), staffId: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/), locationId: z.string().nullable(), sendConfirmation: z.boolean(), doubleBook: z.boolean().optional() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick a service, a provider and a time." };
  const d = parsed.data;
  const ctx = await requireBookingAccess(d.slug);
  if (ctx.access === "own" && d.staffId !== ctx.staffId) return { ok: false, error: "You can only book appointments on your own calendar." };
  const location = d.locationId ? await withTenant(ctx.business.id, (tx) => tx.query.locations.findFirst({ where: eq(dbSchema.locations.id, d.locationId!) })) : null;
  if (d.locationId && !location) return { ok: false, error: "That location isn't available. Reload the page and try again." };
  if (d.clientId && !(await withTenant(ctx.business.id, (tx) => tx.query.clients.findFirst({ where: eq(dbSchema.clients.id, d.clientId!), columns: { id: true } })))) return { ok: false, error: "That client isn't available. Reload the page and try again." };
  const tz = tzFor(ctx.business, location ?? null);
  const startAt = zonedToInstant(d.date, d.time, tz);
  const mayDoubleBook = can(ctx.permissions, "appointments.write.any");
  try {
    const { appointmentId } = await bookAppointment({ businessId: ctx.business.id, clientId: d.clientId, serviceId: d.serviceId, staffId: d.staffId, startAt, notes: null, createdByUserId: ctx.user.id, locationId: d.locationId, allowOverlap: !!d.doubleBook && mayDoubleBook });
    if (d.sendConfirmation && d.clientId) await notifyAppointment(ctx.business, appointmentId, "confirmation");
    else await afterAppointmentBooked(ctx.business, appointmentId);
    revalidatePath(`/app/${d.slug}`);
    return { ok: true, appointmentId, when: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(startAt) };
  } catch (e) {
    if (e instanceof OverlapError) return { ok: false, error: e.message, overlap: mayDoubleBook && !d.doubleBook };
    if (e instanceof BookingError) return { ok: false, error: e.message };
    throw e;
  }
}

/** The quick-create popover's other tab: block a stretch of a provider's day (lunch, a meeting) right where it was drawn on the grid. */
export async function quickBlock(input: { slug: string; staffId: string; date: string; start: string; end: string; reason: string; locationId: string | null }): Promise<MoveResult & { appointmentId?: string }> {
  const parsed = z
    .object({ slug: z.string(), staffId: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/), reason: z.string().trim().max(80), locationId: z.string().nullable() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick a provider and a start and end time." };
  const d = parsed.data;
  const ctx = await requireBlockAccess(d.slug);
  if (ctx.access === "own" && d.staffId !== ctx.staffId) return { ok: false, error: "You can only block time on your own calendar." };
  const location = d.locationId ? await withTenant(ctx.business.id, (tx) => tx.query.locations.findFirst({ where: eq(dbSchema.locations.id, d.locationId!) })) : null;
  const tz = tzFor(ctx.business, location ?? null);
  const startAt = zonedToInstant(d.date, d.start, tz);
  const endAt = zonedToInstant(d.date, d.end, tz);
  if (endAt <= startAt) return { ok: false, error: "End must be after start." };
  try {
    const { appointmentId } = await blockTime({ businessId: ctx.business.id, staffId: d.staffId, startAt, endAt, reason: d.reason || null, actorUserId: ctx.user.id, locationId: d.locationId });
    revalidatePath(`/app/${d.slug}`);
    return { ok: true, appointmentId };
  } catch (e) {
    if (e instanceof BookingError) return { ok: false, error: e.message.includes("just taken") ? "Something is already booked in that time. Move it first, or pick another time." : e.message };
    throw e;
  }
}
