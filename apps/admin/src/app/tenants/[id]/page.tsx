import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell, StatusPill, date } from "@/components";
import { OverridesForm } from "@/price-forms";
import { money } from "@/lib/price-form";
import { getTenantWithBill, listMembers } from "@/lib/tenants";

export const dynamic = "force-dynamic";

export default async function TenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, members] = await Promise.all([getTenantWithBill(id), listMembers(id)]);
  if (!data) notFound();
  const { tenant: t, defaults, overrides, note } = data;

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
      <h1 className="mt-2 text-xl font-semibold">{t.name}</h1>
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
        <div className="flex justify-between border-t border-stone-200 px-3 py-2 font-semibold"><span>Total</span><span className="tabular-nums">{money(t.bill.totalCents)}</span></div>
      </div>

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
      <h2 className="mt-6 font-semibold">Team members with a login</h2>
      <ul className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white text-sm">
        {members.map((m) => (
          <li key={m.email} className="flex justify-between gap-4 px-3 py-2">
            <span>{m.name} <span className="text-stone-500">{m.email}</span></span>
            <span className="capitalize text-stone-600">{m.role}</span>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
