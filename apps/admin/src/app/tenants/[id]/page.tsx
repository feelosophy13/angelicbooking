import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell, date, dateTime } from "@/components";
import { actionLabel, listAudit } from "@/lib/audit";
import { tenantWeekly, weekLabel } from "@/lib/metrics";
import { money } from "@/lib/price-form";
import { actualBilling } from "@/lib/stripe-actual";
import { getTenantWithBill, listLocations, listMembers, listStaff } from "@/lib/tenants";
import { OverridesForm } from "@/price-forms";
import { TenantControls } from "@/tenant-controls";
import { Bars, Meter, Sparkline } from "@/ui/chart";
import { Icon } from "@/ui/icons";
import { Avatar, Badge, Card, Empty, PageHeader, Stat, StatusBadge, relativeDay } from "@/ui/kit";

export const metadata: Metadata = { title: "Tenant" };
export const dynamic = "force-dynamic";

const WEB_URL = process.env.WEB_APP_URL ?? "https://app.angelicbooking.com";
const TABS = [
  ["overview", "Overview"],
  ["usage", "Usage"],
  ["billing", "Billing"],
  ["team", "Team"],
  ["activity", "Activity"],
] as const;
type Tab = (typeof TABS)[number][0];

export default async function TenantPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const tabParam = (await searchParams).tab;
  const tab: Tab = TABS.some(([k]) => k === tabParam) ? (tabParam as Tab) : "overview";
  const [data, weekly] = await Promise.all([getTenantWithBill(id), tenantWeekly(id)]);
  if (!data) notFound();
  const { tenant: t, defaults, overrides, note } = data;
  const now = Date.now();
  const sum = (k: "bookings" | "sms" | "clients") => weekly.reduce((s, w) => s + w[k], 0);
  const series = (k: "bookings" | "sms" | "clients") => weekly.map((w) => ({ label: weekLabel(w.week), value: w[k] }));

  return (
    <Shell>
      <PageHeader
        back={{ href: "/tenants", label: "All tenants" }}
        title={
          <span className="flex items-center gap-3">
            <Avatar name={t.name} size={44} />
            <span className="min-w-0">
              <span className="block truncate">{t.name}</span>
              <span className="mt-1 flex flex-wrap items-center gap-1.5 text-sm font-normal">
                {t.suspendedAt ? <Badge tone="warn">suspended</Badge> : <StatusBadge status={t.subscriptionStatus} plan={t.plan} />}
                {t.comped && <Badge tone="info">comped</Badge>}
                {t.hasOverrides && <Badge tone="brand">custom pricing</Badge>}
                <span className="text-ink-3">Signed up {relativeDay(t.createdAt, now)}</span>
              </span>
            </span>
          </span>
        }
        actions={
          <>
            {t.ownerEmail && <a href={`mailto:${t.ownerEmail}`} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2">Email {t.ownerEmail}</a>}
            <a href={`${WEB_URL}/book/${t.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2">Booking page <Icon name="external" /></a>
          </>
        }
      />
      {t.suspendedAt && (
        <div className="mb-4 rounded-xl border border-warn/50 bg-warn-soft px-4 py-3 text-sm text-warn">
          Suspended {date(t.suspendedAt)}{t.suspendedReason ? `: ${t.suspendedReason}` : ""}. The staff app, booking page and outgoing messages are closed.
        </div>
      )}

      <nav className="no-scrollbar mb-6 flex gap-1 overflow-x-auto border-b border-line" aria-label="Sections">
        {TABS.map(([k, label]) => (
          <Link key={k} href={k === "overview" ? `/tenants/${id}` : `/tenants/${id}?tab=${k}`} aria-current={tab === k ? "page" : undefined} className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? "border-brand text-brand" : "border-transparent text-ink-2 hover:text-ink"}`}>
            {label}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Locations" value={t.locations} />
              <Stat label="Active staff" value={t.activeStaff} hint={t.staff > t.activeStaff ? `${t.staff} including inactive` : undefined} />
              <Stat label="Clients" value={t.clients.toLocaleString()} hint={`+${sum("clients")} in 12 weeks`} />
              <Stat label="Bookings (30d)" value={t.appointments30d} hint={`${t.appointments.toLocaleString()} ever`} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Bookings made" value={sum("bookings")} hint="Last 12 weeks" spark={<Sparkline values={weekly.map((w) => w.bookings)} label="Bookings per week" />} />
              <Stat label="New clients" value={sum("clients")} hint="Last 12 weeks" spark={<Sparkline values={weekly.map((w) => w.clients)} label="New clients per week" color="var(--good)" />} />
              <Stat label="Texts sent" value={sum("sms")} hint="Last 12 weeks" spark={<Sparkline values={weekly.map((w) => w.sms)} label="Texts per week" color="var(--info)" />} />
            </div>
            <Card title="Health" pad={false}>
              <ul className="divide-y divide-line text-sm">
                {([
                  ["Has services and staff", t.onboarded, "Never finished setting up"],
                  ["Took a booking in the last 30 days", t.appointments30d > 0, "No bookings in 30 days"],
                  ["Card payments connected", t.stripeChargesEnabled, "Stripe Connect not finished"],
                  ["Platform subscription", !!t.stripeSubscriptionId || t.comped, "No subscription yet"],
                ] as const).map(([label, ok, bad]) => (
                  <li key={label} className="flex items-center justify-between gap-4 px-4 py-2.5">
                    <span>{label}</span>
                    <Badge tone={ok ? "good" : "warn"}>{ok ? "Yes" : bad}</Badge>
                  </li>
                ))}
                <li className="flex items-center justify-between gap-4 px-4 py-2.5"><span>Last login by anyone on the team</span><span className="text-ink-2" title={dateTime(t.lastLoginAt)}>{relativeDay(t.lastLoginAt, now)}</span></li>
              </ul>
            </Card>
            <Card title="Account" pad={false}>
              <dl className="divide-y divide-line text-sm">
                {([
                  ["Owner", t.ownerEmail ?? "—"],
                  ["Slug", t.slug],
                  ["Plan", <span key="p" className="capitalize">{t.plan}</span>],
                  ["Trial ends", date(t.trialEndsAt)],
                  ["Current period ends", date(t.currentPeriodEnd)],
                  ["Stripe customer", t.stripeCustomerId ?? "—"],
                  ["Signed up", dateTime(t.createdAt)],
                  ["Last booking", date(t.lastAppointmentAt)],
                ] as [string, React.ReactNode][]).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-ink-2">{k}</dt><dd className="text-right">{v}</dd></div>
                ))}
              </dl>
            </Card>
          </div>
          <div className="space-y-6">
            <Card title="Estimated monthly bill" aside={<Link href={`/tenants/${id}?tab=billing`} className="text-brand hover:underline">Details</Link>}>
              <div className="text-3xl font-semibold tabular-nums">{money(t.bill.totalCents)}</div>
              <div className="mt-1 text-xs text-ink-2">{t.comped ? "Comped: never charged" : "From the price book and what they use"}</div>
            </Card>
            <Card title="Controls">
              <TenantControls id={t.id} name={t.name} suspended={!!t.suspendedAt} comped={t.comped} hasSubscription={!!t.stripeSubscriptionId} />
            </Card>
          </div>
        </div>
      )}

      {tab === "usage" && (
        <div className="space-y-6">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
            <Card title="Bookings made per week" aside={`${sum("bookings")} in 12 weeks`}><Bars label="Bookings per week" data={series("bookings")} /></Card>
            <Card title="New clients per week" aside={`${sum("clients")} in 12 weeks`}><Bars label="New clients per week" data={series("clients")} color="var(--good)" /></Card>
            <Card title="Texts sent per week" aside={`${sum("sms")} in 12 weeks`}><Bars label="Texts per week" data={series("sms")} color="var(--info)" /></Card>
            <Card title="Against the plan">
              <div className="space-y-4 text-sm">
                {([
                  ["Locations", t.locations, t.price.includedLocations],
                  ["Active staff", t.activeStaff, t.price.includedStaff],
                  ["Texts (30 days)", t.sms30d, t.price.smsIncluded],
                ] as const).map(([label, used, included]) => (
                  <div key={label}>
                    <div className="mb-1 flex justify-between"><span>{label}</span><span className="tabular-nums text-ink-2">{used} of {included} included{used > included ? ` · ${used - included} extra` : ""}</span></div>
                    <Meter used={used} limit={included} label={label} />
                  </div>
                ))}
                <div className="flex justify-between border-t border-line pt-3"><span>Dedicated text number</span><Badge tone={t.hasNumber ? "good" : "neutral"}>{t.hasNumber ? "Yes" : "No"}</Badge></div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === "billing" && <BillingTab id={id} />}
      {tab === "team" && <TeamTab id={id} />}
      {tab === "activity" && <ActivityTab id={id} />}
    </Shell>
  );

  async function BillingTab({ id }: { id: string }) {
    const actual = await actualBilling(t.stripeSubscriptionId);
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <Card title="Estimated monthly bill" pad={false}>
            <ul className="divide-y divide-line text-sm">
              {t.bill.lines.map((l) => (
                <li key={l.label} className="flex justify-between gap-4 px-4 py-2.5"><span>{l.label} <span className="text-xs text-ink-3">{l.detail}</span></span><span className="tabular-nums">{money(l.cents)}</span></li>
              ))}
            </ul>
            <div className="flex justify-between border-t border-line px-4 py-3 font-semibold"><span>Total{t.comped ? " (comped, not charged)" : ""}</span><span className="tabular-nums">{money(t.bill.totalCents)}</span></div>
            {actual && (
              <div className={`flex justify-between border-t border-line px-4 py-3 text-sm ${!t.comped && actual.monthlyCents !== t.bill.totalCents ? "bg-warn-soft text-warn" : ""}`}>
                <span>Actually billed by Stripe <span className="text-xs opacity-80">({actual.status}, excludes texts)</span></span>
                <span className="tabular-nums">{money(actual.monthlyCents)}</span>
              </div>
            )}
          </Card>
          <Card title="Subscription" pad={false}>
            <dl className="divide-y divide-line text-sm">
              {([["Status", <StatusBadge key="s" status={t.subscriptionStatus} plan={t.plan} />], ["Stripe customer", t.stripeCustomerId ?? "—"], ["Trial ends", date(t.trialEndsAt)], ["Current period ends", date(t.currentPeriodEnd)]] as [string, React.ReactNode][]).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-ink-2">{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
          </Card>
        </div>
        <Card title="Pricing for this business">
          <p className="mb-4 text-sm text-ink-2">Leave a box empty to use the <Link href="/pricing" className="underline">price book</Link> (shown greyed in the box).</p>
          <OverridesForm businessId={id} values={overrides} defaults={defaults} note={note} />
        </Card>
      </div>
    );
  }

  async function TeamTab({ id }: { id: string }) {
    const [members, locations, staff] = await Promise.all([listMembers(id), listLocations(id), listStaff(id)]);
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        <Card title={`Logins (${members.length})`} pad={false}>
          <ul className="divide-y divide-line text-sm">
            {members.map((m) => (
              <li key={m.email} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="flex min-w-0 items-center gap-3"><Avatar name={m.name} size={28} /><span className="min-w-0"><span className="block truncate font-medium">{m.name}</span><span className="block truncate text-xs text-ink-3">{m.email}</span></span></span>
                <Badge tone={m.role === "owner" ? "brand" : "neutral"}>{m.role}</Badge>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={`Locations (${locations.length})`} pad={false}>
          <ul className="divide-y divide-line text-sm">
            {locations.map((l) => (
              <li key={l.name} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span><span className="font-medium">{l.name}</span>{l.isDefault && <span className="ml-2 text-xs text-ink-3">main</span>}<span className="block text-xs text-ink-3">{[l.city, l.state].filter(Boolean).join(", ") || "No address"}</span></span>
                {l.stripeChargesEnabled && <Badge tone="good">own card account</Badge>}
              </li>
            ))}
          </ul>
        </Card>
        <div className="lg:col-span-2">
          <Card title={`Staff (${staff.filter((s) => s.active).length} active of ${staff.length})`} pad={false}>
            <ul className="divide-y divide-line text-sm sm:columns-2 sm:divide-y-0">
              {staff.map((m, i) => (
                <li key={`${m.displayName}${i}`} className={`flex break-inside-avoid items-center justify-between gap-3 border-b border-line px-4 py-2.5 ${m.active ? "" : "opacity-50"}`}>
                  <span className="min-w-0"><span className="block truncate font-medium">{m.displayName}</span><span className="block truncate text-xs text-ink-3">{m.position ?? "—"}</span></span>
                  <span className="flex gap-1">{!m.active && <Badge>inactive</Badge>}{m.hasLogin && <Badge tone="brand">login</Badge>}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    );
  }

  async function ActivityTab({ id }: { id: string }) {
    const audit = await listAudit({ businessId: id, limit: 50 });
    if (audit.length === 0) return <Empty title="No changes made from this app">Suspensions, comps, trial extensions and pricing changes for this business are listed here.</Empty>;
    return (
      <Card title="Changes made here" pad={false}>
        <ul className="divide-y divide-line text-sm">
          {audit.map((a) => (
            <li key={a.id} className="flex flex-wrap justify-between gap-x-4 px-4 py-2.5">
              <span>{actionLabel(a.action)}{typeof a.detail.reason === "string" && a.detail.reason ? <span className="text-ink-3"> · “{a.detail.reason}”</span> : null}{typeof a.detail.days === "number" ? <span className="text-ink-3"> · +{a.detail.days} days</span> : null}</span>
              <span className="text-ink-3">{a.actor} · {dateTime(a.at)}</span>
            </li>
          ))}
        </ul>
      </Card>
    );
  }
}
