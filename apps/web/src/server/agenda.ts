import { and, asc, eq, gte, lt } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { zonedToInstant } from "@angelic/core";
import { shiftISODate } from "@/lib/utils";

export type AgendaItem = {
  id: string;
  appointmentId: string;
  staffId: string;
  serviceName: string;
  startAt: Date;
  endAt: Date;
  status: string;
  priceCents: number;
  clientName: string | null;
  notes: string | null;
};

/** Active staff plus every appointment item starting within [fromDate, fromDate + days). */
export async function getRangeAgenda(businessId: string, timeZone: string, fromDate: string, days: number) {
  const rangeStart = zonedToInstant(fromDate, "00:00", timeZone);
  const rangeEnd = zonedToInstant(shiftISODate(fromDate, days), "00:00", timeZone);
  return withTenant(businessId, async (tx) => {
    const [staffRows, items] = await Promise.all([
      tx.select().from(schema.staff).where(eq(schema.staff.active, true)).orderBy(asc(schema.staff.sortOrder), asc(schema.staff.displayName)),
      tx
        .select({
          id: schema.appointmentItems.id,
          appointmentId: schema.appointmentItems.appointmentId,
          staffId: schema.appointmentItems.staffId,
          serviceName: schema.appointmentItems.serviceName,
          startAt: schema.appointmentItems.startAt,
          endAt: schema.appointmentItems.endAt,
          status: schema.appointmentItems.status,
          priceCents: schema.appointmentItems.priceCents,
          firstName: schema.clients.firstName,
          lastName: schema.clients.lastName,
          notes: schema.appointments.notes,
        })
        .from(schema.appointmentItems)
        .innerJoin(schema.appointments, eq(schema.appointments.id, schema.appointmentItems.appointmentId))
        .leftJoin(schema.clients, eq(schema.clients.id, schema.appointments.clientId))
        .where(and(gte(schema.appointmentItems.startAt, rangeStart), lt(schema.appointmentItems.startAt, rangeEnd)))
        .orderBy(asc(schema.appointmentItems.startAt)),
    ]);
    const agenda: AgendaItem[] = items.map((i) => ({
      ...i,
      clientName: i.firstName ? `${i.firstName} ${i.lastName ?? ""}`.trim() : null,
    }));
    return { staff: staffRows, items: agenda };
  });
}

export const getDayAgenda = (businessId: string, timeZone: string, date: string) => getRangeAgenda(businessId, timeZone, date, 1);
