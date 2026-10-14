import "server-only";
import { sql } from "drizzle-orm";
import { adminDb } from "./db";
import { requireAdmin } from "./admin";
import { effectivePriceBook, monthlyBill, type Bill, type PriceBook } from "@angelic/core/platform-pricing";
import { getAllOverrides, getDefaultPriceBook, getOverrides, type Overrides } from "./pricing";

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
  activeStaff: number;
  appointments30d: number;
  sms30d: number;
  hasNumber: boolean;
};

export type TenantWithBill = TenantRow & { bill: Bill; price: PriceBook; hasOverrides: boolean };

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
         (select max(a.created_at) from appointments a where a.business_id = b.id) as "lastAppointmentAt",
         (select count(*)::int from staff s where s.business_id = b.id and s.active) as "activeStaff",
         (select count(*)::int from appointments a where a.business_id = b.id and a.created_at > now() - interval '30 days') as "appointments30d",
         (select count(*)::int from notifications n where n.business_id = b.id and n.channel = 'sms' and n.status = 'sent' and n.sent_at > now() - interval '30 days') as "sms30d",
         exists (select 1 from messaging_numbers mn where mn.business_id = b.id and mn.released_at is null) as "hasNumber"
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

function withBill(t: TenantRow, defaults: PriceBook, overrides: Overrides | undefined): TenantWithBill {
  const price = effectivePriceBook(defaults, overrides);
  const bill = monthlyBill({ locations: t.locations, activeStaff: t.activeStaff, hasNumber: t.hasNumber, smsLast30Days: t.sms30d }, price);
  return { ...t, bill, price, hasOverrides: !!overrides && Object.values(overrides).some((v) => v != null) };
}

export async function listTenantsWithBills(): Promise<{ tenants: TenantWithBill[]; defaults: PriceBook }> {
  const [tenants, defaults, overrides] = await Promise.all([listTenants(), getDefaultPriceBook(), getAllOverrides()]);
  return { tenants: tenants.map((t) => withBill(t, defaults, overrides.get(t.id))), defaults };
}

export async function getTenantWithBill(id: string) {
  const [t, defaults, ov] = await Promise.all([getTenant(id), getDefaultPriceBook(), getOverrides(id)]);
  if (!t) return null;
  return { tenant: withBill(t, defaults, ov.overrides), defaults, overrides: ov.overrides, note: ov.note };
}
