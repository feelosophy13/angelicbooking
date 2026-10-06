import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { buildBookingSegments } from "@angelic/core";
import { timingFor } from "./availability";

export class BookingError extends Error {}

/**
 * Create an appointment with one service for one staff member.
 * The DB exclusion constraint is the final authority on conflicts, so a race
 * between two bookings resolves safely regardless of app-side checks.
 */
export async function bookAppointment(input: {
  businessId: string;
  clientId: string | null;
  serviceId: string;
  staffId: string;
  startAt: Date;
  notes?: string | null;
  createdByUserId: string;
  source?: "staff" | "online";
}): Promise<{ appointmentId: string }> {
  return withTenant(input.businessId, async (tx) => {
    const service = await tx.query.services.findFirst({ where: eq(schema.services.id, input.serviceId) });
    if (!service || !service.active) throw new BookingError("That service is no longer available.");
    const staffRow = await tx.query.staff.findFirst({ where: eq(schema.staff.id, input.staffId) });
    if (!staffRow || !staffRow.active) throw new BookingError("That staff member is not available.");
    const override = await tx.query.staffServices.findFirst({
      where: (t, { and, eq }) => and(eq(t.staffId, input.staffId), eq(t.serviceId, input.serviceId)),
    });

    const timing = timingFor({
      ...service,
      durationMin: override?.durationMinOverride ?? service.durationMin,
    });
    const priceCents = override?.priceCentsOverride ?? service.priceCents;
    const segments = buildBookingSegments(input.startAt, timing);

    const [appt] = await tx
      .insert(schema.appointments)
      .values({
        businessId: input.businessId,
        clientId: input.clientId,
        notes: input.notes ?? null,
        source: input.source ?? "staff",
        createdByUserId: input.createdByUserId,
      })
      .returning({ id: schema.appointments.id });

    try {
      await tx.insert(schema.appointmentItems).values(
        segments.map((seg, i) => ({
          businessId: input.businessId,
          appointmentId: appt!.id,
          staffId: input.staffId,
          serviceId: service.id,
          serviceName: i === 0 ? service.name : `${service.name} (finish)`,
          startAt: seg.start,
          endAt: seg.end,
          priceCents: i === 0 ? priceCents : 0,
          sortOrder: i,
        })),
      );
    } catch (e) {
      if (isExclusionViolation(e)) {
        throw new BookingError("That time was just taken. Please pick another slot.");
      }
      throw e;
    }

    await tx.insert(schema.auditLog).values({
      businessId: input.businessId,
      actorUserId: input.createdByUserId,
      action: "appointment.create",
      entity: "appointment",
      entityId: appt!.id,
      diff: JSON.stringify({ serviceId: service.id, staffId: input.staffId, startAt: input.startAt }),
    });

    return { appointmentId: appt!.id };
  });
}

export async function setAppointmentStatus(
  businessId: string,
  appointmentId: string,
  status: (typeof schema.appointmentStatus.enumValues)[number],
  actorUserId: string,
) {
  await withTenant(businessId, async (tx) => {
    await tx
      .update(schema.appointments)
      .set({ status, cancelledAt: status === "cancelled" ? new Date() : null })
      .where(eq(schema.appointments.id, appointmentId));
    await tx.update(schema.appointmentItems).set({ status }).where(eq(schema.appointmentItems.appointmentId, appointmentId));
    await tx.insert(schema.auditLog).values({
      businessId,
      actorUserId,
      action: `appointment.${status}`,
      entity: "appointment",
      entityId: appointmentId,
    });
  });
}

function isExclusionViolation(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === "23P01";
}
