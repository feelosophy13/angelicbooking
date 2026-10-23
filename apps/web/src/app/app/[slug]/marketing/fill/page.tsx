import type { Metadata } from "next";
import Link from "next/link";
import { requireAction } from "@/lib/tenant";
import { Card, Empty } from "@/components/ui";
import { Disclosure } from "@/components/disclosure";
import { findOpenings, fillStats, whenLabel } from "@/server/fill-books";
import { aiConfigured } from "@/server/ai";
import { formatDateLong, formatMoney, formatTime } from "@/lib/utils";
import { duration } from "@/lib/format";
import { OpeningCard, type OpeningView } from "./opening-card";
import { FillSettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Fill open slots" };

const ago = (d: Date, now: Date) => {
  const m = Math.max(1, Math.round((now.getTime() - d.getTime()) / 60_000));
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

/**
 * Fill My Books: the open slots over the next few days, each with the clients most likely to take it (waitlist, due back, regulars),
 * and a Send that texts or emails each one a link straight to that slot. Settings (automatic daily mode, limits, wording) and what
 * the invitations filled are below.
 */
export default async function FillPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "marketing.send");
  const now = new Date();
  const tz = business.timezone;
  const [{ openings, sentToday }, stats] = await Promise.all([findOpenings(business, now), fillStats(business, now)]);
  const money = (c: number) => formatMoney(c, business.currency);
  const byDate = new Map<string, OpeningView[]>();
  for (const o of openings) {
    const view: OpeningView = {
      key: o.key,
      staffId: o.staffId,
      staffName: o.staffName,
      start: o.start.toISOString(),
      locationId: o.locationId,
      when: `${formatTime(o.start, tz)}–${formatTime(o.end, tz)}`,
      meta: [`${duration(o.minutes)} open`, o.locationName].filter(Boolean).join(" · "),
      remaining: o.remaining,
      invited: o.invited.map((i) => ({ name: i.name, ago: ago(i.at, now), booked: i.booked })),
      suggestions: o.suggestions.map((s) => ({ clientId: s.clientId, name: s.name, reason: s.reason, detail: s.detail, serviceName: s.serviceName, channel: s.channel, blocked: s.blocked })),
    };
    byDate.set(o.date, [...(byDate.get(o.date) ?? []), view]);
  }
  const withPeople = openings.filter((o) => o.suggestions.some((s) => s.channel)).length;
  return (
    <>
      <p className="mb-4 text-sm text-stone-600">
        Open time on the calendar over the next {business.fillDaysAhead} day{business.fillDaysAhead === 1 ? "" : "s"}, with the clients most likely to want it. Send texts or emails each one a link that opens the booking page at that exact time; the first to book gets it, and nobody else is invited once it&apos;s taken.
        {business.fillAutoEnabled ? <> Automatic invitations are on, daily from {formatTime(new Date(Date.UTC(2000, 0, 1, business.fillAutoHour)), "UTC")}.</> : null}
      </p>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Invitations (30 days)", value: String(stats.invites) },
          { label: "Bookings from them", value: String(stats.booked) },
          { label: "Took the exact slot", value: String(stats.exact) },
          { label: "Booked value", value: money(stats.bookedCents) },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-stone-200 bg-white px-4 py-3">
            <p className="text-xs text-stone-500">{s.label}</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-stone-900">{s.value}</p>
          </div>
        ))}
      </div>
      {openings.length === 0 ? (
        <Empty title="No open slots coming up" body={`Every bookable stylist is booked (or off) for the next ${business.fillDaysAhead} days. Nice.`} />
      ) : (
        <div className="space-y-6">
          <p className="text-xs text-stone-500">{openings.length} opening{openings.length === 1 ? "" : "s"}, {withPeople} with someone to invite · {sentToday} of {business.fillMaxPerDay} invitations sent today</p>
          {[...byDate].map(([date, list]) => (
            <section key={date}>
              <h2 className="mb-2 text-sm font-semibold text-stone-700">{formatDateLong(date)}</h2>
              <div className="grid gap-3 xl:grid-cols-2">
                {list.map((o) => <OpeningCard key={`${o.key}:${o.invited.length}`} slug={slug} o={o} />)}
              </div>
            </section>
          ))}
        </div>
      )}
      <div className="mt-6 space-y-4">
        <Disclosure title="Settings" hint={business.fillAutoEnabled ? "automatic invitations on" : "automatic invitations off"}>
          <FillSettingsForm slug={slug} ai={aiConfigured()} settings={{ fillAutoEnabled: business.fillAutoEnabled, fillAutoHour: business.fillAutoHour, fillDaysAhead: business.fillDaysAhead, fillMaxPerSlot: business.fillMaxPerSlot, fillMaxPerDay: business.fillMaxPerDay, fillMessage: business.fillMessage }} />
        </Disclosure>
        <Disclosure title="Recent invitations" hint={stats.recent.length ? `${stats.recent.length} in the last 30 days` : "none yet"}>
          {stats.recent.length === 0 ? (
            <p className="text-sm text-stone-500">Invitations you send show here with what came of them.</p>
          ) : (
            <Card className="shadow-none">
              <ul className="divide-y divide-stone-100 text-sm">
                {stats.recent.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link href={`/app/${slug}/clients/${r.clientId}`} className="font-medium hover:underline">{`${r.firstName} ${r.lastName}`.trim()}</Link>
                      <p className="truncate text-xs text-stone-500">{whenLabel(r.slotStart, tz, r.createdAt)} with {r.staffName ?? "a stylist"} · {r.channel === "sms" ? "text" : "email"}{r.auto ? " · automatic" : ""} · sent {ago(r.createdAt, now)}{r.status === "skipped" || r.status === "failed" ? ` · not delivered: ${r.error ?? r.status}` : ""}</p>
                    </div>
                    <span className="w-32 shrink-0 text-right text-xs">
                      {r.bookedAppointmentId ? <Link href={`/app/${slug}/appointments/${r.bookedAppointmentId}`} className="font-medium text-emerald-700 hover:underline">{r.exact ? "Booked the slot" : "Booked"}</Link> : <span className="text-stone-400">No booking yet</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </Disclosure>
      </div>
    </>
  );
}
