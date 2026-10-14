import "server-only";
import { sql } from "drizzle-orm";
import { adminDb } from "./db";
import { requireAdmin } from "./admin";

export type TenantRow = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  subscriptionStatus: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  stripeChargesEnabled: boolean;
  stripeCustomerId: string | null;
  createdAt: Date;
  ownerEmail: string | null;
  clients: number;
  staff: number;
  locations: number;
  appointments: number;
  lastAppointmentAt: Date | null;
};

const SELECT = sql`
  select b.id, b.name, b.slug, b.plan,
         b.subscription_status as "subscriptionStatus",
         b.trial_ends_at as "trialEndsAt",
         b.current_period_end as "currentPeriodEnd",
         b.stripe_charges_enabled as "stripeChargesEnabled",
         b.stripe_customer_id as "stripeCustomerId",
         b.created_at as "createdAt",
         (select u.email from member m join "user" u on u.id = m.user_id
           where m.organization_id = b.id and m.role = 'owner' order by m.created_at limit 1) as "ownerEmail",
         (select count(*)::int from clients c where c.business_id = b.id) as clients,
         (select count(*)::int from staff s where s.business_id = b.id) as staff,
         (select count(*)::int from locations l where l.business_id = b.id) as locations,
         (select count(*)::int from appointments a where a.business_id = b.id) as appointments,
         (select max(a.created_at) from appointments a where a.business_id = b.id) as "lastAppointmentAt"
  from businesses b
`;

export async function listTenants(): Promise<TenantRow[]> {
  await requireAdmin();
  return (await adminDb().execute(sql`${SELECT} order by b.created_at desc`)) as unknown as TenantRow[];
}

export async function getTenant(id: string): Promise<TenantRow | null> {
  await requireAdmin();
  const rows = (await adminDb().execute(sql`${SELECT} where b.id = ${id}`)) as unknown as TenantRow[];
  return rows[0] ?? null;
}

export async function listMembers(id: string): Promise<{ name: string; email: string; role: string; joinedAt: Date }[]> {
  await requireAdmin();
  return (await adminDb().execute(sql`
    select u.name, u.email, m.role, m.created_at as "joinedAt"
    from member m join "user" u on u.id = m.user_id
    where m.organization_id = ${id} order by m.created_at
  `)) as unknown as { name: string; email: string; role: string; joinedAt: Date }[];
}
