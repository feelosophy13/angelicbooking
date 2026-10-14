import { can } from "@angelic/core";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { PermissionError, requireBusiness, type TenantContext } from "@/lib/tenant";
import { appointmentAccess, blockingAccess, bookingAccess, type AppointmentMode } from "@/lib/appointment-access";

/**
 * Open an appointment for reading or changing. Front desk and managers get any appointment; a Provider gets the ones they are booked on
 * (and only when their login is linked to a staff member). Everyone else gets the permission error.
 */
export async function requireAppointmentAccess(slug: string, appointmentId: string, mode: AppointmentMode): Promise<TenantContext & { access: "any" | "own" }> {
  const ctx = await requireBusiness(slug);
  if (can(ctx.permissions, mode === "read" ? "appointments.read.any" : "appointments.write.any")) return { ...ctx, access: "any" };
  const items = await withTenant(ctx.business.id, (tx) => tx.select({ staffId: schema.appointmentItems.staffId }).from(schema.appointmentItems).where(eq(schema.appointmentItems.appointmentId, appointmentId)));
  const access = appointmentAccess(ctx.permissions, mode, ctx.staffId ?? null, items.map((i) => i.staffId));
  if (!access) throw new PermissionError();
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
