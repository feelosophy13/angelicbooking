import { can } from "@angelic/core";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { PermissionError, requireBusiness, type TenantContext } from "@/lib/tenant";
import { appointmentAccess, bookingAccess, type AppointmentMode } from "@/lib/appointment-access";

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
