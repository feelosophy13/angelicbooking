import "server-only";
import { sql } from "drizzle-orm";
import { adminDb } from "./db";
import { requireAdmin } from "./admin";
import { revive } from "./rows";

export type Week = { week: Date; signups: number; bookings: number; sms: number; clients: number };

const WEEKS = sql`generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week')`;

/** The last 12 weeks across the whole platform. */
export async function platformWeekly(): Promise<Week[]> {
  await requireAdmin();
  const rows = await adminDb().execute(sql`
    with w as (select ${WEEKS} as week)
    select w.week,
      (select count(*)::int from businesses b where b.created_at >= w.week and b.created_at < w.week + interval '1 week') as signups,
      (select count(*)::int from appointments a where a.kind = 'visit' and a.created_at >= w.week and a.created_at < w.week + interval '1 week') as bookings,
      (select count(*)::int from notifications n where n.channel = 'sms' and n.status = 'sent' and n.sent_at >= w.week and n.sent_at < w.week + interval '1 week') as sms,
      (select count(*)::int from clients c where c.created_at >= w.week and c.created_at < w.week + interval '1 week') as clients
    from w order by w.week
  `);
  return revive<Week>(rows, ["week"]);
}

/** The last 12 weeks for one business (signups is always 0). */
export async function tenantWeekly(businessId: string): Promise<Week[]> {
  await requireAdmin();
  const rows = await adminDb().execute(sql`
    with w as (select ${WEEKS} as week)
    select w.week, 0 as signups,
      (select count(*)::int from appointments a where a.business_id = ${businessId} and a.kind = 'visit' and a.created_at >= w.week and a.created_at < w.week + interval '1 week') as bookings,
      (select count(*)::int from notifications n where n.business_id = ${businessId} and n.channel = 'sms' and n.status = 'sent' and n.sent_at >= w.week and n.sent_at < w.week + interval '1 week') as sms,
      (select count(*)::int from clients c where c.business_id = ${businessId} and c.created_at >= w.week and c.created_at < w.week + interval '1 week') as clients
    from w order by w.week
  `);
  return revive<Week>(rows, ["week"]);
}

export type TenantIndexRow = { id: string; name: string; slug: string; owner: string | null };

/** Light list for the ⌘K search. */
export async function tenantIndex(): Promise<TenantIndexRow[]> {
  await requireAdmin();
  return (await adminDb().execute(sql`
    select b.id, b.name, b.slug,
      (select u.email from member m join "user" u on u.id = m.user_id where m.organization_id = b.id and m.role = 'owner' order by m.created_at limit 1) as owner
    from businesses b order by b.name
  `)) as unknown as TenantIndexRow[];
}

export const weekLabel = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
