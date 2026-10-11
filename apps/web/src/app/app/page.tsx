import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Building2, Plus, Search } from "lucide-react";
import { requireSession } from "@/lib/session";
import { myBusinesses, businessSnapshot, searchClientsAcross } from "@/server/overview";
import { formatMoney, formatTime } from "@/lib/utils";
import { Wordmark } from "@/components/brand";
import { Button, Card, Input, LinkButton } from "@/components/ui";
import { can } from "@angelic/core";

export const metadata: Metadata = { title: "All my businesses" };

/**
 * Read-only roll-up across every business the user belongs to. Each card is
 * built inside that business's own tenant scope with that business's permissions.
 */
export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await requireSession();
  const { q = "" } = await searchParams;
  const mine = await myBusinesses(session.user.id);
  if (mine.length === 0) redirect("/onboarding");
  if (mine.length === 1) redirect(`/app/${mine[0]!.business.slug}`);
  const now = new Date();
  const snapshots = await Promise.all(mine.map((m) => businessSnapshot(m, now)));
  const canSearch = mine.filter((m) => can(m.permissions, "clients.read")).length > 1;
  const hits = canSearch && q ? await searchClientsAcross(mine, q) : [];
  const totals = snapshots.reduce(
    (t, s) => ({ today: t.today + s.today.total, week: t.week + s.upcoming7, salesToday: t.salesToday + (s.sales?.todayCents ?? 0), salesMonth: t.salesMonth + (s.sales?.monthCents ?? 0), anySales: t.anySales || !!s.sales }),
    { today: 0, week: 0, salesToday: 0, salesMonth: 0, anySales: false },
  );
  const currency = mine[0]!.business.currency;
  const dateLabel = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: mine[0]!.business.timezone }).format(now);

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Wordmark />
          <div className="flex items-center gap-2 text-sm">
            <span className="hidden text-stone-500 sm:inline">{session.user.name}</span>
            <LinkButton href="/account" size="sm" variant="ghost">Account</LinkButton>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">All my businesses</h1>
            <p className="text-sm text-stone-500">{dateLabel} · {mine.length} businesses</p>
          </div>
          <LinkButton href="/onboarding" size="sm"><Plus className="h-4 w-4" /> Add a business</LinkButton>
        </div>

        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Appointments today" value={String(totals.today)} />
          <Stat label="Next 7 days" value={String(totals.week)} />
          {totals.anySales ? <Stat label="Sales today" value={formatMoney(totals.salesToday, currency)} /> : null}
          {totals.anySales ? <Stat label="Sales this month" value={formatMoney(totals.salesMonth, currency)} /> : null}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {mine.map((m, i) => {
            const s = snapshots[i]!;
            const b = m.business;
            const href = `/app/${b.slug}`;
            return (
              <Card key={b.id} className="p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={href} className="flex items-center gap-2 text-lg font-semibold hover:underline"><Building2 className="h-5 w-5 text-stone-400" /><span className="truncate">{b.name}</span></Link>
                    <p className="text-xs text-stone-500">{m.role.replace("_", " ")}{b.addressLine ? ` · ${b.addressLine}` : ""}</p>
                  </div>
                  <LinkButton href={href} size="sm" variant="primary">Open <ArrowRight className="h-4 w-4" /></LinkButton>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                  <dt className="text-stone-500">Today</dt>
                  <dd className="sm:col-span-2">
                    {s.today.total} appointment{s.today.total === 1 ? "" : "s"}
                    {s.today.done ? ` · ${s.today.done} done` : ""}
                    {s.today.unconfirmed ? ` · ${s.today.unconfirmed} unconfirmed` : ""}
                    {s.today.noShows ? ` · ${s.today.noShows} no-show` : ""}
                  </dd>
                  <dt className="text-stone-500">Next up</dt>
                  <dd className="sm:col-span-2">
                    {s.nextUp ? (
                      <Link href={`${href}/appointments/${s.nextUp.appointmentId}`} className="hover:underline">{formatTime(s.nextUp.startAt, b.timezone)} · {s.nextUp.clientName ?? "Walk-in"} · {s.nextUp.serviceName} with {s.nextUp.staffName}</Link>
                    ) : (
                      <span className="text-stone-400">Nothing more today</span>
                    )}
                  </dd>
                  <dt className="text-stone-500">Next 7 days</dt>
                  <dd className="sm:col-span-2">{s.upcoming7} booked</dd>
                  {s.sales ? (
                    <>
                      <dt className="text-stone-500">Sales</dt>
                      <dd className="sm:col-span-2">{formatMoney(s.sales.todayCents, b.currency)} today · {formatMoney(s.sales.monthCents, b.currency)} this month ({s.sales.monthTickets} ticket{s.sales.monthTickets === 1 ? "" : "s"}){s.openTickets ? ` · ${s.openTickets} open` : ""}</dd>
                    </>
                  ) : null}
                </dl>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <Link href={href} className="text-brand-700 underline">Calendar</Link>
                  <Link href={`${href}/clients`} className="text-brand-700 underline">Clients</Link>
                  {s.sales ? <Link href={`${href}/reports`} className="text-brand-700 underline">Sales report</Link> : null}
                  {can(m.permissions, "business.manage") ? <Link href={`${href}/settings`} className="text-brand-700 underline">Settings</Link> : null}
                </div>
              </Card>
            );
          })}
        </div>

        {canSearch ? (
          <Card className="mt-6 p-4">
            <h2 className="font-medium">Find a client anywhere</h2>
            <p className="mb-3 text-xs text-stone-500">Searches the client lists of every business you can see. Each business keeps its own records; this only looks them up side by side.</p>
            <form className="flex gap-2">
              <Input name="q" defaultValue={q} placeholder="Name, phone or email" className="max-w-sm" />
              <Button type="submit" variant="secondary" aria-label="Search"><Search className="h-4 w-4" /></Button>
            </form>
            {q ? (
              hits.length === 0 ? (
                <p className="mt-3 text-sm text-stone-500">No matches for “{q}”.</p>
              ) : (
                <ul className="mt-3 divide-y divide-stone-100 text-sm">
                  {hits.map((h) => (
                    <li key={`${h.business.id}:${h.client.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div>
                        <Link href={`/app/${h.business.slug}/clients/${h.client.id}`} className="font-medium hover:underline">{h.client.firstName} {h.client.lastName}</Link>
                        <p className="text-xs text-stone-500">{[h.client.phone, h.client.email].filter(Boolean).join(" · ") || "no contact info"}{h.client.lastVisit ? ` · last visit ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(h.client.lastVisit)}` : ""}</p>
                      </div>
                      <span className="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{h.business.name}</span>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </Card>
        ) : null}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
    </Card>
  );
}
