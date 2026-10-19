import { can } from "@angelic/core";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { PermissionError, requireBusiness, type TenantContext } from "@/lib/tenant";
import { appointmentAccess, blockingAccess, bookingAccess, type AppointmentAccess, type AppointmentMode } from "@/lib/appointment-access";

/**
 * What a change may do when the person is booked on the appointment alongside a colleague ("shared" access, lib/appointment-access.ts).
 * The default refuses: a status change, a cancellation or a move-as-one reaches the colleague's lines. A change that touches only this
 * person's own work opts in: `line` names the appointment item it is about (allowed when that line is theirs), `shared: "allow"` is for
 * work that belongs to no single line (notes, photos, supplies, checkout). Reading is always allowed.
 */
export type AppointmentAccessOptions = { shared?: "refuse" | "allow"; line?: string };

/**
 * Open an appointment for reading or changing. Front desk and managers get any appointment; a Provider gets the ones they are booked on
 * (and only when their login is linked to a staff member). Everyone else gets the permission error.
 */
export async function requireAppointmentAccess(slug: string, appointmentId: string, mode: AppointmentMode, opts: AppointmentAccessOptions = {}): Promise<TenantContext & { access: AppointmentAccess }> {
  const ctx = await requireBusiness(slug);
  if (can(ctx.permissions, mode === "read" ? "appointments.read.any" : "appointments.write.any")) return { ...ctx, access: "any" };
  const items = await withTenant(ctx.business.id, (tx) => tx.select({ id: schema.appointmentItems.id, staffId: schema.appointmentItems.staffId, status: schema.appointmentItems.status }).from(schema.appointmentItems).where(eq(schema.appointmentItems.appointmentId, appointmentId)));
  // A colleague's cancelled line no longer makes the visit shared; a fully cancelled visit still belongs to whoever was on it.
  const live = items.filter((i) => i.status !== "cancelled");
  const access = appointmentAccess(ctx.permissions, mode, ctx.staffId ?? null, (live.length ? live : items).map((i) => i.staffId));
  if (!access) throw new PermissionError();
  if (access === "shared" && mode !== "read") {
    const ok = opts.line ? items.some((i) => i.id === opts.line && i.staffId === ctx.staffId) : opts.shared === "allow";
    if (!ok) throw new PermissionError();
  }
  return { ...ctx, access };
}

/** Open the new-appointment screen or save one: front desk and managers book for anyone, a role with "book on their own" books on their own calendar only. */
export async function requireBookingAccess(slug: string): Promise<TenantContext & { access: "any" | "own" }> {
  const ctx = await requireBusiness(slug);
  const access = bookingAccess(ctx.permissions, ctx.staffId ?? null);
  if (!access) throw new PermissionError();
  return { ...ctx, access };
}

/** Open the Block time screen or save a block: the same shape as booking. */
export async function requireBlockAccess(slug: string): Promise<TenantContext & { access: "any" | "own" }> {
  const ctx = await requireBusiness(slug);
  const access = blockingAccess(ctx.permissions, ctx.staffId ?? null);
  if (!access) throw new PermissionError();
  return { ...ctx, access };
}

/**
 * Blocked time is its own capability. For an appointment that is a block, whatever is being done to it needs "block"; for a visit it needs
 * `visitMode` (e.g. "cancel" when cancelling, "change" when moving, "write" for other updates).
 */
export async function modeForKind(businessId: string, appointmentId: string, visitMode: AppointmentMode): Promise<AppointmentMode> {
  const appt = await withTenant(businessId, (tx) => tx.query.appointments.findFirst({ where: eq(schema.appointments.id, appointmentId), columns: { kind: true } }));
  return appt?.kind === "block" ? "block" : visitMode;
}
