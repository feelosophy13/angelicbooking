import "server-only";
import { sql } from "drizzle-orm";
import { adminDb } from "./db";
import { requireAdmin } from "./admin";
import { revive } from "./rows";
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
  suspendedAt: Date | null;
  suspendedReason: string | null;
  comped: boolean;
  stripeSubscriptionId: string | null;
  lastLoginAt: Date | null;
  services: number;
  onboarded: boolean;
  customDomain: string | null;
  customDomainStatus: string;
  customDomainError: string | null;
  termsAcceptedAt: Date | null;
  termsVersion: string | null;
  ownerVerified: boolean;
  publishRequiresVerified: boolean;
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
         exists (select 1 from messaging_numbers mn where mn.business_id = b.id and mn.released_at is null) as "hasNumber",
         b.suspended_at as "suspendedAt",
         b.suspended_reason as "suspendedReason",
         b.comped,
         b.stripe_subscription_id as "stripeSubscriptionId",
         (select max(se.updated_at) from session se join member m2 on m2.user_id = se.user_id where m2.organization_id = b.id) as "lastLoginAt",
         (select count(*)::int from services sv where sv.business_id = b.id) as services,
         (select count(*) > 0 from services sv where sv.business_id = b.id) and (select count(*) > 0 from staff s2 where s2.business_id = b.id) as onboarded,
         b.custom_domain as "customDomain",
         b.custom_domain_status as "customDomainStatus",
         b.custom_domain_error as "customDomainError",
         b.terms_accepted_at as "termsAcceptedAt",
         b.terms_version as "termsVersion",
         b.publish_requires_verified as "publishRequiresVerified",
         exists (select 1 from member mv join "user" uv on uv.id = mv.user_id where mv.organization_id = b.id and mv.role = 'owner' and uv.email_verified) as "ownerVerified"
  from businesses b
`;

const TENANT_DATES = ["trialEndsAt", "currentPeriodEnd", "createdAt", "lastAppointmentAt", "suspendedAt", "lastLoginAt", "termsAcceptedAt"] as const;

export async function listTenants(): Promise<TenantRow[]> {
  await requireAdmin();
  return revive<TenantRow>(await adminDb().execute(sql`${SELECT} order by b.created_at desc`), TENANT_DATES);
}

export async function getTenant(id: string): Promise<TenantRow | null> {
  await requireAdmin();
  const rows = revive<TenantRow>(await adminDb().execute(sql`${SELECT} where b.id = ${id}`), TENANT_DATES);
  return rows[0] ?? null;
}

export async function listMembers(id: string): Promise<{ name: string; email: string; role: string; joinedAt: Date }[]> {
  await requireAdmin();
  return revive<{ name: string; email: string; role: string; joinedAt: Date }>(await adminDb().execute(sql`
    select u.name, u.email, m.role, m.created_at as "joinedAt"
    from member m join "user" u on u.id = m.user_id
    where m.organization_id = ${id} order by m.created_at
  `), ["joinedAt"]);
}

function withBill(t: TenantRow, defaults: PriceBook, overrides: Overrides | undefined): TenantWithBill {
  const price = effectivePriceBook(defaults, overrides);
  const full = monthlyBill({ locations: t.locations, activeStaff: t.activeStaff, hasNumber: t.hasNumber, smsLast30Days: t.sms30d }, price);
  // A comped business is never charged: keep the lines so you can see what it would cost, but the total is $0.
  const bill: Bill = t.comped ? { lines: full.lines, totalCents: 0 } : full;
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

export async function listLocations(id: string): Promise<{ name: string; city: string | null; state: string | null; isDefault: boolean; stripeChargesEnabled: boolean }[]> {
  await requireAdmin();
  return (await adminDb().execute(sql`
    select name, city, state, is_default as "isDefault", stripe_charges_enabled as "stripeChargesEnabled"
    from locations where business_id = ${id} order by is_default desc, name
  `)) as unknown as { name: string; city: string | null; state: string | null; isDefault: boolean; stripeChargesEnabled: boolean }[];
}

export async function listStaff(id: string): Promise<{ displayName: string; position: string | null; active: boolean; takesAppointments: boolean; hasLogin: boolean }[]> {
  await requireAdmin();
  return (await adminDb().execute(sql`
    select display_name as "displayName", position, active, takes_appointments as "takesAppointments", user_id is not null as "hasLogin"
    from staff where business_id = ${id} order by active desc, sort_order, display_name
  `)) as unknown as { displayName: string; position: string | null; active: boolean; takesAppointments: boolean; hasLogin: boolean }[];
}
