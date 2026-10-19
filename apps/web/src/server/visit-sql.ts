import { sql, type SQL } from "drizzle-orm";

/**
 * The one definition of a client's visits that the We miss you automation (noVisitReach, the daily scan) and the Reports Clients card
 * share, so "lapsed" means the same thing on both pages. Raw SQL fragments for `tx.execute` inside `withTenant`.
 */

/** Completed visits, one row per appointment: `client_id`, `appointment_id`, `start_at` (the first line's start). Blocks have no client. */
export function completedVisits(locationId?: string | null): SQL {
  return sql`
    select a.client_id, a.id as appointment_id, i.start_at
    from appointments a join appointment_items i on i.appointment_id = a.id and i.sort_order = 0
    where a.status = 'completed' and a.kind = 'visit' and a.client_id is not null ${locationId ? sql`and a.location_id = ${locationId}` : sql``}`;
}

/** Each client's latest completed visit: `client_id`, `appointment_id`, `last_visit`. */
export function lastCompletedVisits(locationId?: string | null): SQL {
  return sql`
    select distinct on (a.client_id) a.client_id, a.id as appointment_id, i.start_at as last_visit
    from appointments a join appointment_items i on i.appointment_id = a.id and i.sort_order = 0
    where a.status = 'completed' and a.kind = 'visit' and a.client_id is not null ${locationId ? sql`and a.location_id = ${locationId}` : sql``}
    order by a.client_id, i.start_at desc`;
}

/** True when the client (`clientRef`, a column) has a booked or confirmed visit starting after `after` (an instant expression), at any site. */
export function bookedAhead(clientRef: SQL, after: SQL): SQL {
  return sql`exists (select 1 from appointments a2 join appointment_items i2 on i2.appointment_id = a2.id and i2.sort_order = 0
    where a2.client_id = ${clientRef} and a2.status in ('booked','confirmed') and i2.start_at > ${after})`;
}

/**
 * True when, as of the instant `asOf`, the client had a visit booked for later: an appointment made before `asOf`, starting at or after
 * it, that was not cancelled or a no-show. For today that is a booked or confirmed visit; for a past period end it is what has since
 * been completed (the booking existed then), so a historical period reads the way it did at the time.
 */
export function bookedAheadAsOf(clientRef: SQL, asOf: SQL): SQL {
  return sql`exists (select 1 from appointments a3 join appointment_items i3 on i3.appointment_id = a3.id and i3.sort_order = 0
    where a3.client_id = ${clientRef} and a3.kind = 'visit' and a3.status not in ('cancelled','no_show') and i3.start_at >= ${asOf} and a3.created_at < ${asOf})`;
}
