import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell, StatusPill, date } from "@/components";
import { getTenant, listMembers } from "@/lib/tenants";

export const dynamic = "force-dynamic";

export default async function TenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, members] = await Promise.all([getTenant(id), listMembers(id)]);
  if (!t) notFound();

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

  return (
    <Shell>
      <Link href="/" className="text-sm text-stone-600 hover:text-stone-900">← All tenants</Link>
      <h1 className="mt-2 text-xl font-semibold">{t.name}</h1>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([["Clients", t.clients], ["Staff", t.staff], ["Locations", t.locations], ["Appointments", t.appointments]] as const).map(([k, v]) => (
          <div key={k} className="rounded-lg border border-stone-200 bg-white p-3">
            <div className="text-xs text-stone-500">{k}</div>
            <div className="text-2xl font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      <dl className="mt-4 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white text-sm">
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
