import { and, asc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { zonedToInstant } from "@angelic/core";
import { shiftISODate } from "@/lib/utils";
import { staffLocationIndex, worksAt } from "./locations";

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
  /** Set when this row is a class session (one card for the whole group). */
  classSessionId?: string | null;
  /** Where the visit happens (appointments.location_id / class_sessions.location_id). */
  locationId?: string | null;
};

/** Active staff plus every appointment item starting within [fromDate, fromDate + days). */
export async function getRangeAgenda(businessId: string, timeZone: string, fromDate: string, days: number) {
  const rangeStart = zonedToInstant(fromDate, "00:00", timeZone);
  const rangeEnd = zonedToInstant(shiftISODate(fromDate, days), "00:00", timeZone);
  return withTenant(businessId, async (tx) => {
    const [staffRows, items, sessions, locIndex] = await Promise.all([
      tx.select().from(schema.staff).where(and(eq(schema.staff.active, true), eq(schema.staff.takesAppointments, true))).orderBy(asc(schema.staff.sortOrder), asc(schema.staff.displayName)),
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
          locationId: schema.appointments.locationId,
        })
        .from(schema.appointmentItems)
        .innerJoin(schema.appointments, eq(schema.appointments.id, schema.appointmentItems.appointmentId))
        .leftJoin(schema.clients, eq(schema.clients.id, schema.appointments.clientId))
        .where(and(gte(schema.appointmentItems.startAt, rangeStart), lt(schema.appointmentItems.startAt, rangeEnd), isNull(schema.appointmentItems.classSessionId)))
        .orderBy(asc(schema.appointmentItems.startAt)),
      tx
        .select({
          id: schema.classSessions.id,
          staffId: schema.classSessions.staffId,
          startAt: schema.classSessions.startAt,
          endAt: schema.classSessions.endAt,
          status: schema.classSessions.status,
          capacity: schema.classSessions.capacity,
          priceCents: schema.classSessions.priceCents,
          notes: schema.classSessions.notes,
          locationId: schema.classSessions.locationId,
          serviceName: schema.services.name,
          booked: sql<number>`(select count(*) from appointment_items ai where ai.class_session_id = ${schema.classSessions.id} and ai.status in ('booked','confirmed','checked_in','in_progress','completed'))`,
        })
        .from(schema.classSessions)
        .innerJoin(schema.services, eq(schema.services.id, schema.classSessions.serviceId))
        .where(and(gte(schema.classSessions.startAt, rangeStart), lt(schema.classSessions.startAt, rangeEnd)))
        .orderBy(asc(schema.classSessions.startAt)),
      staffLocationIndex(tx),
    ]);
    const agenda: AgendaItem[] = [
      ...items.map((i) => ({ ...i, clientName: i.firstName ? `${i.firstName} ${i.lastName ?? ""}`.trim() : null })),
      ...sessions.map((s) => ({
        id: `class:${s.id}`,
        appointmentId: `class:${s.id}`,
        staffId: s.staffId,
        serviceName: s.serviceName,
        startAt: s.startAt,
        endAt: s.endAt,
        status: s.status === "cancelled" ? "cancelled" : "class",
        priceCents: s.priceCents * Number(s.booked),
        clientName: `${s.serviceName} · ${Number(s.booked)}/${s.capacity}`,
        notes: s.notes,
        classSessionId: s.id,
        locationId: s.locationId,
      })),
    ].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    return { staff: staffRows, items: agenda, locations: locIndex };
  });
}

/**
 * Narrow an agenda to one location: staff who work there on the day (day view) or on
 * any day (week/month), plus anyone with a visit booked there; items at that location
 * (or without one) for those staff.
 */
export function filterAgendaByLocation<T extends Awaited<ReturnType<typeof getRangeAgenda>>>(agenda: T, locationId: string | null, weekday: number | null) {
  if (!locationId) return { staff: agenda.staff, items: agenda.items };
  const bookedHere = new Set(agenda.items.filter((i) => i.locationId === locationId).map((i) => i.staffId));
  const staff = agenda.staff.filter((s) => (weekday === null ? (agenda.locations.any.get(s.id)?.has(locationId) ?? false) : worksAt(agenda.locations, s.id, weekday, locationId)) || bookedHere.has(s.id));
  const ids = new Set(staff.map((s) => s.id));
  const items = agenda.items.filter((i) => ids.has(i.staffId) && (!i.locationId || i.locationId === locationId));
  return { staff, items };
}

export const getDayAgenda = (businessId: string, timeZone: string, date: string) => getRangeAgenda(businessId, timeZone, date, 1);
