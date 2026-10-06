import { asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";

export async function getAppointmentDetail(businessId: string, appointmentId: string) {
  return withTenant(businessId, async (tx) => {
    const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, appointmentId) });
    if (!appt) return null;
    const [items, client, services, staff] = await Promise.all([
      tx
        .select({
          id: schema.appointmentItems.id,
          staffId: schema.appointmentItems.staffId,
          staffName: schema.staff.displayName,
          staffColor: schema.staff.color,
          serviceId: schema.appointmentItems.serviceId,
          serviceName: schema.appointmentItems.serviceName,
          startAt: schema.appointmentItems.startAt,
          endAt: schema.appointmentItems.endAt,
          priceCents: schema.appointmentItems.priceCents,
          status: schema.appointmentItems.status,
          sortOrder: schema.appointmentItems.sortOrder,
        })
        .from(schema.appointmentItems)
        .innerJoin(schema.staff, eq(schema.staff.id, schema.appointmentItems.staffId))
        .where(eq(schema.appointmentItems.appointmentId, appointmentId))
        .orderBy(asc(schema.appointmentItems.sortOrder), asc(schema.appointmentItems.startAt)),
      appt.clientId ? tx.query.clients.findFirst({ where: eq(schema.clients.id, appt.clientId) }) : Promise.resolve(null),
      tx.select().from(schema.services).where(eq(schema.services.active, true)).orderBy(asc(schema.services.name)),
      tx.select().from(schema.staff).where(eq(schema.staff.active, true)).orderBy(asc(schema.staff.displayName)),
    ]);
    return { appointment: appt, items, client: client ?? null, services, staff };
  });
}
