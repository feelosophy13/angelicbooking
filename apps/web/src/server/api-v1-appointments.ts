import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { SERIES_INTERVALS, MAX_SERIES_OCCURRENCES } from "./series";
import { listSessions, getSession } from "./classes";

/**
 * Appointment extras for the public REST API: editing the services on a visit, standing appointments (series), classes. Same rules as api-v1.ts:
 * the business id comes from the key, every query runs inside withTenant and names business_id explicitly, serializers are allow-lists, and every
 * id a request names is proven to belong to the business by the route before it reaches the booking code (foreign keys bypass row-level security).
 * Fees, deposits and refunds are money and are not here.
 */
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** An ISO 8601 instant that carries its offset: a bare local time would be ambiguous. */
export const at = z.string().refine((s) => /(Z|[+-]\d{2}:\d{2})$/.test(s) && !Number.isNaN(Date.parse(s)), "Use an ISO 8601 time with an offset, e.g. 2026-11-02T14:00:00-05:00");
const id = z.string().min(1).max(100);

/**
 * Some server functions (createSeries, createSession, enrolClient) store the acting user in a column that is a foreign key to the user table, and
 * their types say `string`. An API key is not a user, so these calls pass null (the columns are nullable; the audit row written by apiAudit names
 * the key). The cast only bridges the types, which were written for staff sessions.
 */
export const NO_USER = null as unknown as string;

// ---- Services on a visit ----
export const addServiceBody = z.object({ service_id: id, staff_id: id, start_at: at }).strict();
export const moveItemBody = z.object({ start_at: at, staff_id: id.nullish(), notify: z.boolean().default(true) }).strict();

/** The item, only when it belongs to this appointment of this business and the appointment is a client visit (never blocked time). */
export async function findVisitItem(businessId: string, appointmentId: string, itemId: string) {
  return withTenant(businessId, async (tx) => {
    const appt = await tx.query.appointments.findFirst({ where: and(eq(schema.appointments.id, appointmentId), eq(schema.appointments.businessId, businessId)), columns: { id: true, kind: true, status: true } });
    if (!appt || appt.kind !== "visit") return null;
    const item = await tx.query.appointmentItems.findFirst({ where: and(eq(schema.appointmentItems.id, itemId), eq(schema.appointmentItems.appointmentId, appointmentId), eq(schema.appointmentItems.businessId, businessId)), columns: { id: true, status: true } });
    return item ? { appointment: appt, item } : null;
  });
}

// ---- Standing appointments ----
export const seriesCreate = z.object({
  client_id: id.nullish(),
  service_id: id,
  staff_id: id,
  start_at: at,
  interval_weeks: z.number().int().refine((n) => (SERIES_INTERVALS as readonly number[]).includes(n), `interval_weeks must be one of: ${SERIES_INTERVALS.join(", ")}`),
  occurrences: z.number().int().min(2).max(MAX_SERIES_OCCURRENCES),
  notes: z.string().trim().max(2000).nullish(),
  location_id: id.nullish(),
  notify: z.boolean().default(true),
  /** Reminder automations, separately from the confirmation (on by default). */
  reminders: z.boolean().default(true),
}).strict();

export const cancelSeriesBody = z.object({ reason: z.string().trim().max(500).nullish(), notify: z.boolean().default(true) }).strict();

export const serializeSeries = (s: typeof schema.appointmentSeries.$inferSelect, occurrences: { id: string; status: string; startAt: Date }[]) => ({
  id: s.id, client_id: s.clientId, service_id: s.serviceId, staff_id: s.staffId, interval_weeks: s.intervalWeeks, first_start_at: iso(s.firstStartAt),
  planned_occurrences: s.occurrences, notes: s.notes, ended_at: iso(s.endedAt), created_at: iso(s.createdAt),
  occurrences: occurrences.map((o) => ({ appointment_id: o.id, status: o.status, start_at: iso(o.startAt) })),
});

export async function getSeriesApi(businessId: string, seriesId: string) {
  return withTenant(businessId, async (tx) => {
    const s = await tx.query.appointmentSeries.findFirst({ where: and(eq(schema.appointmentSeries.id, seriesId), eq(schema.appointmentSeries.businessId, businessId)) });
    if (!s) return null;
    const rows = await tx
      .select({ id: schema.appointments.id, status: schema.appointments.status, startAt: schema.appointmentItems.startAt })
      .from(schema.appointments)
      .innerJoin(schema.appointmentItems, and(eq(schema.appointmentItems.appointmentId, schema.appointments.id), eq(schema.appointmentItems.sortOrder, 0)))
      .where(and(eq(schema.appointments.seriesId, s.id), eq(schema.appointments.businessId, businessId)))
      .orderBy(asc(schema.appointmentItems.startAt));
    return serializeSeries(s, rows);
  });
}

// ---- Classes ----
export const classCreate = z.object({ service_id: id, staff_id: id, start_at: at, capacity: z.number().int().min(1).max(500).nullish(), notes: z.string().trim().max(300).nullish() }).strict();
export const enrolBody = z.object({ client_id: id.nullable(), notes: z.string().trim().max(300).nullish(), notify: z.boolean().default(true) }).strict();
export const classCancelBody = z.object({ reason: z.string().trim().max(200).nullish(), notify: z.boolean().default(true) }).strict();

type Session = typeof schema.classSessions.$inferSelect;
export const serializeSession = (s: Session, extra: { serviceName: string; staffName: string; booked: number; seatsLeft: number }) => ({
  id: s.id, service_id: s.serviceId, service_name: extra.serviceName, staff_id: s.staffId, staff_name: extra.staffName, location_id: s.locationId,
  start_at: iso(s.startAt), end_at: iso(s.endAt), capacity: s.capacity, booked: extra.booked, seats_left: extra.seatsLeft, price_cents: s.priceCents,
  notes: s.notes, status: s.status, created_at: iso(s.createdAt),
});

/** Sessions in a window, ordered by start. The window is capped at a year so one call cannot scan the whole history. */
export async function listSessionsApi(businessId: string, opts: { from: Date; to: Date; serviceId?: string | null; includeCancelled: boolean }) {
  const rows = await listSessions(businessId, opts);
  return rows.filter((r) => r.businessId === businessId).map((r) => serializeSession(r, r));
}

/** One session with its roster. The roster shows who holds a seat (name and appointment), not their contact details. */
export async function getSessionApi(businessId: string, sessionId: string) {
  const s = await getSession(businessId, sessionId);
  if (!s || s.session.businessId !== businessId) return null;
  return {
    ...serializeSession(s.session, { serviceName: s.service?.name ?? "", staffName: s.staff?.displayName ?? "", booked: s.booked, seatsLeft: s.seatsLeft }),
    roster: s.roster.map((r) => ({ appointment_id: r.appointmentId, status: r.status, client_id: r.clientId, first_name: r.firstName, last_name: r.lastName, source: r.source, booked_at: iso(r.createdAt) })),
  };
}
