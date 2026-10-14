import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell, StatusPill, date, dateTime } from "@/components";
import { OverridesForm } from "@/price-forms";
import { TenantControls } from "@/tenant-controls";
import { actionLabel, listAudit } from "@/lib/audit";
import { money } from "@/lib/price-form";
import { actualBilling } from "@/lib/stripe-actual";
import { getTenantWithBill, listLocations, listMembers, listStaff } from "@/lib/tenants";

export const dynamic = "force-dynamic";

export default async function TenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, members, locations, staff, audit] = await Promise.all([getTenantWithBill(id), listMembers(id), listLocations(id), listStaff(id), listAudit({ businessId: id, limit: 20 })]);
  if (!data) notFound();
  const { tenant: t, defaults, overrides, note } = data;
  const actual = await actualBilling(t.stripeSubscriptionId);
  const health: [string, boolean, string][] = [
    ["Has services and staff", t.onboarded, "Never finished setting up"],
    ["Took a booking in the last 30 days", t.appointments30d > 0, "No bookings in 30 days"],
    ["Card payments connected", t.stripeChargesEnabled, "Stripe Connect not finished"],
    ["Has a payment method / subscription", !!t.stripeSubscriptionId || t.comped, "No platform subscription"],
  ];

  const facts: [string, React.ReactNode][] = [
    ["Slug", t.slug],
    ["Owner", t.ownerEmail ?? "—"],
    ["Plan", <span key="p" className="capitalize">{t.plan}</span>],
    ["Subscription", <StatusPill key="s" status={t.subscriptionStatus} />],
    ["Trial ends", date(t.trialEndsAt)],
    ["Current period ends", date(t.currentPeriodEnd)],
    ["Card payments (Stripe Connect)", t.stripeChargesEnabled ? "Enabled" : "Not connected"],
    ["Stripe customer", t.stripeCustomerId ?? "—"],
    ["Signed up", date(t.createdAt)],
    ["Last booking", date(t.lastAppointmentAt)],
  ];
  const usage: [string, number | string][] = [
    ["Locations", t.locations],
    ["Active staff", t.activeStaff],
    ["Clients", t.clients],
    ["Appointments (30 days)", t.appointments30d],
    ["Texts sent (30 days)", t.sms30d],
    ["Text number", t.hasNumber ? "Yes" : "No"],
  ];

  return (
    <Shell>
      <Link href="/" className="text-sm text-stone-600 hover:text-stone-900">← All tenants</Link>
      <h1 className="mt-2 text-xl font-semibold">
        {t.name}
        {t.suspendedAt && <span className="ml-2 rounded bg-red-100 px-2 py-0.5 align-middle text-xs font-medium text-red-800">suspended</span>}
        {t.comped && <span className="ml-2 rounded bg-sky-100 px-2 py-0.5 align-middle text-xs font-medium text-sky-800">comped</span>}
      </h1>
      {t.suspendedAt && <p className="mt-1 text-sm text-red-800">Suspended {date(t.suspendedAt)}{t.suspendedReason ? `: ${t.suspendedReason}` : ""}</p>}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {usage.map(([k, v]) => (
          <div key={k} className="rounded-lg border border-stone-200 bg-white p-3">
            <div className="text-xs text-stone-500">{k}</div>
            <div className="text-2xl font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>

      <h2 className="mt-6 font-semibold">Estimated monthly bill</h2>
      <div className="mt-2 rounded-lg border border-stone-200 bg-white text-sm">
        <ul className="divide-y divide-stone-100">
          {t.bill.lines.map((l) => (
            <li key={l.label} className="flex justify-between gap-4 px-3 py-2">
              <span>{l.label} <span className="text-xs text-stone-500">{l.detail}</span></span>
              <span className="tabular-nums">{money(l.cents)}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-between border-t border-stone-200 px-3 py-2 font-semibold"><span>Total{t.comped ? " (comped, not charged)" : ""}</span><span className="tabular-nums">{money(t.bill.totalCents)}</span></div>
        {actual && (
          <div className={`flex justify-between border-t border-stone-200 px-3 py-2 ${!t.comped && actual.monthlyCents !== t.bill.totalCents ? "bg-amber-50" : ""}`}>
            <span>Actually billed by Stripe <span className="text-xs text-stone-500">({actual.status}, excludes texts)</span></span>
            <span className="tabular-nums">{money(actual.monthlyCents)}</span>
          </div>
        )}
      </div>

      <h2 className="mt-6 font-semibold">Health</h2>
      <ul className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white text-sm">
        {health.map(([label, ok, bad]) => (
          <li key={label} className="flex justify-between gap-4 px-3 py-2"><span>{label}</span><span className={ok ? "text-emerald-700" : "text-amber-700"}>{ok ? "Yes" : bad}</span></li>
        ))}
        <li className="flex justify-between gap-4 px-3 py-2"><span>Last login by anyone on the team</span><span>{dateTime(t.lastLoginAt)}</span></li>
      </ul>

      <h2 className="mt-6 font-semibold">Controls</h2>
      <div className="mt-2"><TenantControls id={t.id} name={t.name} suspended={!!t.suspendedAt} comped={t.comped} hasSubscription={!!t.stripeSubscriptionId} /></div>

      <h2 className="mt-6 font-semibold">Pricing for this business</h2>
      <p className="mt-1 text-sm text-stone-600">Leave a box empty to use the <Link href="/pricing" className="underline">price book</Link> (shown greyed in the box).</p>
      <div className="mt-2 rounded-lg border border-stone-200 bg-white p-4">
        <OverridesForm businessId={t.id} values={overrides} defaults={defaults} note={note} />
      </div>

      <h2 className="mt-6 font-semibold">Account</h2>
      <dl className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white text-sm">
        {facts.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 px-3 py-2"><dt className="text-stone-600">{k}</dt><dd className="text-right">{v}</dd></div>
        ))}
      </dl>
      <h2 className="mt-6 font-semibold">Locations ({locations.length})</h2>
      <ul className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white text-sm">
        {locations.map((l) => (
          <li key={l.name} className="flex justify-between gap-4 px-3 py-2">
            <span>{l.name}{l.isDefault && <span className="ml-2 text-xs text-stone-500">main</span>} <span className="text-stone-500">{[l.city, l.state].filter(Boolean).join(", ")}</span></span>
            <span className="text-stone-600">{l.stripeChargesEnabled ? "Own card account" : ""}</span>
          </li>
        ))}
      </ul>
      <h2 className="mt-6 font-semibold">Staff ({staff.filter((s) => s.active).length} active of {staff.length})</h2>
      <ul className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white text-sm">
        {staff.map((m, i) => (
          <li key={`${m.displayName}${i}`} className={`flex justify-between gap-4 px-3 py-2 ${m.active ? "" : "text-stone-400"}`}>
            <span>{m.displayName} <span className="text-stone-500">{m.position ?? ""}</span></span>
            <span className="text-stone-500">{[m.active ? null : "inactive", m.takesAppointments ? "takes appointments" : null, m.hasLogin ? "has login" : null].filter(Boolean).join(" · ")}</span>
          </li>
        ))}
      </ul>
      <h2 className="mt-6 font-semibold">Team members with a login</h2>
      <ul className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white text-sm">
        {members.map((m) => (
          <li key={m.email} className="flex justify-between gap-4 px-3 py-2">
            <span>{m.name} <span className="text-stone-500">{m.email}</span></span>
            <span className="capitalize text-stone-600">{m.role}</span>
          </li>
        ))}
      </ul>
      <h2 className="mt-6 font-semibold">Changes made here</h2>
      <ul className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white text-sm">
        {audit.map((a) => (
          <li key={a.id} className="flex flex-wrap justify-between gap-x-4 px-3 py-2">
            <span>{actionLabel(a.action)}{typeof a.detail.reason === "string" && a.detail.reason ? <span className="text-stone-500"> · “{a.detail.reason}”</span> : null}{typeof a.detail.days === "number" ? <span className="text-stone-500"> · +{a.detail.days} days</span> : null}</span>
            <span className="text-stone-500">{a.actor} · {dateTime(a.at)}</span>
          </li>
        ))}
        {audit.length === 0 && <li className="px-3 py-3 text-stone-500">Nothing yet.</li>}
      </ul>
    </Shell>
  );
}