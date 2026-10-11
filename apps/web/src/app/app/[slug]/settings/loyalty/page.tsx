import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import Link from "next/link";
import { BackLink, Card, Empty, Input, PageHeader, Checkbox } from "@/components/ui";
import { rowClass, RowLink } from "@/components/row";
import { withTenant } from "@angelic/db";
import { instantToISODate, zonedToInstant } from "@angelic/core";
import { shiftISODate } from "@/lib/utils";
import { loyaltyStats, recentReferrals, topReferrers } from "@/server/loyalty";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { saveLoyaltySettings } from "./actions";

export const metadata: Metadata = { title: "Loyalty & referrals" };

export default async function LoyaltySettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business: b } = await requireAction(slug, "business.manage");
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
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Loyalty & referrals">
        <Link href={`/app/${slug}/marketing`} className="text-sm text-brand-700 underline">Marketing</Link>
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="p-4">
          <ActionForm action={saveLoyaltySettings}>
            <input type="hidden" name="slug" value={slug} />
            <Checkbox name="loyaltyEnabled" defaultChecked={b.loyaltyEnabled} label="Clients earn points on every paid visit" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Points per $1 spent" name="loyaltyPointsPerDollar" hint="On services and products after discounts (not tips or tax)."><Input name="loyaltyPointsPerDollar" type="number" min={0} defaultValue={b.loyaltyPointsPerDollar} /></Field>
              <Field label="Bonus points per visit" name="loyaltyPointsPerVisit"><Input name="loyaltyPointsPerVisit" type="number" min={0} defaultValue={b.loyaltyPointsPerVisit} /></Field>
              <Field label="Value of 1 point (cents)" name="loyaltyPointValueCents" hint="1 = 100 points are worth $1."><Input name="loyaltyPointValueCents" type="number" min={1} defaultValue={b.loyaltyPointValueCents} /></Field>
              <Field label="Minimum points to redeem" name="loyaltyMinRedeemPoints"><Input name="loyaltyMinRedeemPoints" type="number" min={1} defaultValue={b.loyaltyMinRedeemPoints} /></Field>
            </div>
            <h2 className="pt-2 text-sm font-semibold text-stone-700">Referrals</h2>
            <p className="text-xs text-stone-500">Every client gets a code on their page and in their online account. A new client enters it when booking; after their first paid visit, points are awarded.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Points for the referrer" name="referralBonusPoints"><Input name="referralBonusPoints" type="number" min={0} defaultValue={b.referralBonusPoints} /></Field>
              <Field label="Points for the new client" name="referralFriendBonusPoints"><Input name="referralFriendBonusPoints" type="number" min={0} defaultValue={b.referralFriendBonusPoints} /></Field>
            </div>
            <SubmitButton pendingText="Saving…">Save</SubmitButton>
          </ActionForm>
        </Card>
        <Card className="p-4 text-sm text-stone-600">
          <h2 className="mb-1 font-medium text-stone-900">Redeeming</h2>
          <p>At checkout, pick <b>Redeem points</b>: the points become a payment on the ticket at the value above. Balances and history show on each client&apos;s page, where you can also adjust points by hand.</p>
          <h2 className="mb-1 mt-4 font-medium text-stone-900">Getting codes to clients</h2>
          <p>Every client gets a code at their first checkout. It is on their emailed receipt and in their online account; staff can text or email it from the client page; and the <Link href={`${base}/marketing/automations`} className="text-brand-700 underline">Refer a friend</Link> automation sends it after a first visit.</p>
        </Card>
      </div>

      {b.loyaltyEnabled ? (
        <>
          <Card className="mt-6">
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
      ) : null}
    </>
  );
}
