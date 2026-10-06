import { and, eq, sql } from "drizzle-orm";
import { schema, withTenant, type TenantDb } from "@angelic/db";
import { buildBookingSegments } from "@angelic/core";
import { timingFor } from "./availability";

export class BookingError extends Error {}

type Tx = TenantDb;

/** Insert the time segments for one service into an existing appointment. */
async function insertServiceItems(
  tx: Tx,
  input: { businessId: string; appointmentId: string; serviceId: string; staffId: string; startAt: Date; sortOrderBase: number },
) {
  const service = await tx.query.services.findFirst({ where: eq(schema.services.id, input.serviceId) });
  if (!service || !service.active) throw new BookingError("That service is no longer available.");
  const staffRow = await tx.query.staff.findFirst({ where: eq(schema.staff.id, input.staffId) });
  if (!staffRow || !staffRow.active) throw new BookingError("That staff member is not available.");
  const override = await tx.query.staffServices.findFirst({
    where: and(eq(schema.staffServices.staffId, input.staffId), eq(schema.staffServices.serviceId, input.serviceId)),
  });
  const timing = timingFor({ ...service, durationMin: override?.durationMinOverride ?? service.durationMin });
  const priceCents = override?.priceCentsOverride ?? service.priceCents;
  const segments = buildBookingSegments(input.startAt, timing);
  await tx.insert(schema.appointmentItems).values(
    segments.map((seg, i) => ({
      businessId: input.businessId,
      appointmentId: input.appointmentId,
      staffId: input.staffId,
      serviceId: service.id,
      serviceName: i === 0 ? service.name : `${service.name} (finish)`,
      startAt: seg.start,
      endAt: seg.end,
      priceCents: i === 0 ? priceCents : 0,
      sortOrder: input.sortOrderBase + i,
    })),
  );
  return { service, segments };
}

async function audit(tx: Tx, businessId: string, actorUserId: string, action: string, entityId: string, diff?: unknown) {
  await tx.insert(schema.auditLog).values({
    businessId,
    actorUserId,
    action,
    entity: "appointment",
    entityId,
    diff: diff === undefined ? null : JSON.stringify(diff),
  });
}

/** Translate a Postgres exclusion violation into a user-facing BookingError. */
function translate(e: unknown): never {
  const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  if (code === "23P01") throw new BookingError("That time was just taken. Please pick another slot.");
  throw e;
}

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
  try {
    return await withTenant(input.businessId, async (tx) => {
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
      await insertServiceItems(tx, { ...input, appointmentId: appt!.id, sortOrderBase: 0 });
      await audit(tx, input.businessId, input.createdByUserId, "appointment.create", appt!.id, {
        serviceId: input.serviceId,
        staffId: input.staffId,
        startAt: input.startAt,
      });
      return { appointmentId: appt!.id };
    });
  } catch (e) {
    translate(e);
  }
}

/** Add another service (possibly with a different staff member) to an existing appointment. */
export async function addServiceToAppointment(input: {
  businessId: string;
  appointmentId: string;
  serviceId: string;
  staffId: string;
  startAt: Date;
  actorUserId: string;
}) {
  try {
    await withTenant(input.businessId, async (tx) => {
      const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, input.appointmentId) });
      if (!appt) throw new BookingError("Appointment not found.");
      if (appt.status === "cancelled" || appt.status === "completed" || appt.status === "no_show") {
        throw new BookingError(`Can't add a service to a ${appt.status.replace("_", " ")} appointment.`);
      }
      const [agg] = await tx
        .select({ max: sql<number>`coalesce(max(${schema.appointmentItems.sortOrder}), -1)` })
        .from(schema.appointmentItems)
        .where(eq(schema.appointmentItems.appointmentId, input.appointmentId));
      await insertServiceItems(tx, { ...input, sortOrderBase: Number(agg?.max ?? -1) + 1 });
      await audit(tx, input.businessId, input.actorUserId, "appointment.add_service", input.appointmentId, {
        serviceId: input.serviceId,
        staffId: input.staffId,
        startAt: input.startAt,
      });
    });
  } catch (e) {
    translate(e);
  }
}

/**
 * Move one service within an appointment to a new start (and optionally a new
 * staff member). All segments of that service (e.g. colour + finish) shift by
 * the same delta. Overlap is checked once at commit thanks to the deferrable
 * exclusion constraint.
 */
export async function rescheduleService(input: {
  businessId: string;
  itemId: string;
  newStartAt: Date;
  newStaffId?: string | null;
  actorUserId: string;
}) {
  try {
    await withTenant(input.businessId, async (tx) => {
      const item = await tx.query.appointmentItems.findFirst({ where: eq(schema.appointmentItems.id, input.itemId) });
      if (!item) throw new BookingError("Appointment not found.");
      if (item.status === "cancelled" || item.status === "completed" || item.status === "no_show") {
        throw new BookingError("This appointment can no longer be moved.");
      }
      const siblings = await tx
        .select()
        .from(schema.appointmentItems)
        .where(
          and(
            eq(schema.appointmentItems.appointmentId, item.appointmentId),
            item.serviceId ? eq(schema.appointmentItems.serviceId, item.serviceId) : eq(schema.appointmentItems.id, item.id),
            eq(schema.appointmentItems.staffId, item.staffId),
          ),
        );
      const first = siblings.reduce((a, b) => (a.startAt < b.startAt ? a : b));
      const deltaMs = input.newStartAt.getTime() - first.startAt.getTime();
      const staffId = input.newStaffId ?? item.staffId;
      if (deltaMs === 0 && staffId === item.staffId) return;
      if (staffId !== item.staffId) {
        const target = await tx.query.staff.findFirst({ where: eq(schema.staff.id, staffId) });
        if (!target || !target.active) throw new BookingError("That staff member is not available.");
      }
      await tx.execute(sql`set constraints appointment_items_no_double_booking deferred`);
      for (const s of siblings) {
        await tx
          .update(schema.appointmentItems)
          .set({ startAt: new Date(s.startAt.getTime() + deltaMs), endAt: new Date(s.endAt.getTime() + deltaMs), staffId })
          .where(eq(schema.appointmentItems.id, s.id));
      }
      await audit(tx, input.businessId, input.actorUserId, "appointment.reschedule", item.appointmentId, {
        itemId: item.id,
        from: first.startAt,
        to: input.newStartAt,
        fromStaff: item.staffId,
        toStaff: staffId,
      });
    });
  } catch (e) {
    translate(e);
  }
}

/** Remove one service (all its segments) from an appointment. Cancels the appointment if nothing is left. */
export async function removeServiceFromAppointment(input: { businessId: string; itemId: string; actorUserId: string }) {
  await withTenant(input.businessId, async (tx) => {
    const item = await tx.query.appointmentItems.findFirst({ where: eq(schema.appointmentItems.id, input.itemId) });
    if (!item) return;
    await tx
      .update(schema.appointmentItems)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(schema.appointmentItems.appointmentId, item.appointmentId),
          item.serviceId ? eq(schema.appointmentItems.serviceId, item.serviceId) : eq(schema.appointmentItems.id, item.id),
          eq(schema.appointmentItems.staffId, item.staffId),
        ),
      );
    const [agg] = await tx
      .select({ live: sql<number>`count(*) filter (where ${schema.appointmentItems.status} <> 'cancelled')` })
      .from(schema.appointmentItems)
      .where(eq(schema.appointmentItems.appointmentId, item.appointmentId));
    if (Number(agg?.live ?? 0) === 0) {
      await tx
        .update(schema.appointments)
        .set({ status: "cancelled", cancelledAt: new Date() })
        .where(eq(schema.appointments.id, item.appointmentId));
    }
    await audit(tx, input.businessId, input.actorUserId, "appointment.remove_service", item.appointmentId, { itemId: item.id });
  });
}

export async function setAppointmentStatus(
  businessId: string,
  appointmentId: string,
  status: (typeof schema.appointmentStatus.enumValues)[number],
  actorUserId: string,
  reason?: string | null,
) {
  await withTenant(businessId, async (tx) => {
    await tx
      .update(schema.appointments)
      .set({
        status,
        cancelledAt: status === "cancelled" ? new Date() : null,
        cancellationReason: status === "cancelled" ? (reason ?? null) : null,
      })
      .where(eq(schema.appointments.id, appointmentId));
    await tx
      .update(schema.appointmentItems)
      .set({ status })
      .where(and(eq(schema.appointmentItems.appointmentId, appointmentId), sql`${schema.appointmentItems.status} <> 'cancelled'`));
    await audit(tx, businessId, actorUserId, `appointment.${status}`, appointmentId, reason ? { reason } : undefined);
  });
}

export async function updateAppointmentNotes(businessId: string, appointmentId: string, notes: string | null, actorUserId: string) {
  await withTenant(businessId, async (tx) => {
    await tx.update(schema.appointments).set({ notes }).where(eq(schema.appointments.id, appointmentId));
    await audit(tx, businessId, actorUserId, "appointment.notes", appointmentId);
  });
}
