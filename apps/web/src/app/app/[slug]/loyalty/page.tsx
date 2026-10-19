import type { Metadata } from "next";
import Link from "next/link";
import { requireAction } from "@/lib/tenant";
import { BackLink, Card, Empty, PageHeader } from "@/components/ui";
import { rowClass, RowLink } from "@/components/row";
import { withTenant } from "@angelic/db";
import { instantToISODate, zonedToInstant } from "@angelic/core";
import { shiftISODate } from "@/lib/utils";
import { loyaltyStats, recentReferrals, topReferrers } from "@/server/loyalty";

export const metadata: Metadata = { title: "Loyalty activity" };

/** What loyalty has done this month and who is referring: read-only. The rules live in settings. */
export default async function LoyaltyActivityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business: b } = await requireAction(slug, "settings.business");
  const tz = b.timezone;
  const today = instantToISODate(new Date(), tz);
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthStart = shiftISODate(monthStart, -1).slice(0, 8) + "01";
  const at = (d: string) => zonedToInstant(d, "00:00", tz);
  const [thisMonth, lastMonth, leaders, recent] = await withTenant(b.id, async (tx) => [
    await loyaltyStats(tx, at(monthStart), at(shiftISODate(today, 1))),
    await loyaltyStats(tx, at(lastMonthStart), at(monthStart)),
    await topReferrers(tx),
    await recentReferrals(tx),
  ]);
  const base = `/app/${slug}`;
  const fmtDay = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: tz });
  const monthName = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(monthStart + "T00:00:00Z"));
  const stat = (label: string, cur: number, before: number, unit = "") => (
    <div key={label} className="bg-white px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{cur.toLocaleString()}{unit}</p>
      <p className="text-xs text-stone-500">{before.toLocaleString()}{unit} last month</p>
    </div>
  );
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings/loyalty`}>Loyalty settings</BackLink></div>
      <PageHeader title="Loyalty activity">
        <Link href={`/app/${slug}/settings/loyalty`} className="text-sm text-brand-700 underline">Settings</Link>
      </PageHeader>
      {!b.loyaltyEnabled ? (
        <Empty title="Loyalty is off" body="Clients stop earning points when the program is off. Turn it on in loyalty settings." />
      ) : (
        <>
          <Card>
            <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">{monthName} so far</h2>
            <div className="grid grid-cols-2 gap-px bg-stone-100 md:grid-cols-4">
              {stat("Points issued", thisMonth.pointsIssued, lastMonth.pointsIssued)}
              {stat("Points redeemed", thisMonth.pointsRedeemed, lastMonth.pointsRedeemed)}
              {stat("Referrals joined", thisMonth.referralsJoined, lastMonth.referralsJoined)}
              {stat("Referrals converted", thisMonth.referralsConverted, lastMonth.referralsConverted)}
            </div>
            <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-500">Converted means the friend had their first paid visit and the bonus was paid. Any period and the full list: <Link href={`${base}/reports`} className="text-brand-700 underline">Reports</Link>.</p>
          </Card>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Top referrers</h2>
              {leaders.length === 0 ? <div className="p-4"><Empty title="Nobody has referred a friend yet" body="Send a few regulars their code from their client page." /></div> : (
                <ul className="divide-y divide-stone-100 text-sm">
                  {leaders.map((l) => (
                    <li key={l.id} className={`${rowClass} flex items-center gap-3 px-4 py-2`}>
                      <RowLink href={`${base}/clients/${l.id}`} className="min-w-0 flex-1 truncate font-medium">{l.name}</RowLink>
                      <span className="shrink-0 text-xs text-stone-500">{l.referred} referred · {l.converted} visited</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Recent referrals</h2>
              {recent.length === 0 ? <div className="p-4"><Empty title="No referrals yet" /></div> : (
                <ul className="divide-y divide-stone-100 text-sm">
                  {recent.map((r) => (
                    <li key={r.referredId} className={`${rowClass} px-4 py-2`}>
                      <p className="min-w-0 truncate"><Link href={`${base}/clients/${r.referrerId}`} className="font-medium hover:underline">{r.referrerName}</Link> <span className="text-stone-400">→</span> <RowLink href={`${base}/clients/${r.referredId}`} className="font-medium">{r.referredName}</RowLink></p>
                      <p className="text-xs text-stone-500">{r.rewardedAt ? `First paid visit ${fmtDay.format(r.rewardedAt)} · bonus paid` : `Joined ${fmtDay.format(r.joinedAt)} · not visited yet`}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
