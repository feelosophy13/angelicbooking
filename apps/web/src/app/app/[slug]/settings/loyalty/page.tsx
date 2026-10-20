import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import Link from "next/link";
import { BackLink, Card, PageHeader } from "@/components/ui";
import { LoyaltyForm } from "./loyalty-form";

export const metadata: Metadata = { title: "Loyalty & referrals" };

export default async function LoyaltySettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business: b } = await requireAction(slug, "settings.business");
  const base = `/app/${slug}`;
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Loyalty & referrals">
        <Link href={`/app/${slug}/loyalty`} className="text-sm text-brand-700 underline">Activity</Link>
      </PageHeader>
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <Card className="p-4">
          <LoyaltyForm slug={slug} v={{ loyaltyEnabled: b.loyaltyEnabled, loyaltyPointsPerDollar: b.loyaltyPointsPerDollar, loyaltyPointsPerVisit: b.loyaltyPointsPerVisit, loyaltyPointValueCents: b.loyaltyPointValueCents, loyaltyMinRedeemPoints: b.loyaltyMinRedeemPoints, referralBonusPoints: b.referralBonusPoints, referralFriendBonusPoints: b.referralFriendBonusPoints }} />
        </Card>
        {b.loyaltyEnabled ? (
          <Card className="p-4 text-sm text-stone-600">
            <h2 className="mb-1 font-medium text-stone-900">Redeeming</h2>
            <p>At checkout, pick <b>Redeem points</b>: the points become a payment on the ticket at the value above. Balances and history show on each client&apos;s page, where you can also adjust points by hand.</p>
            <h2 className="mb-1 mt-4 font-medium text-stone-900">Getting codes to clients</h2>
            <p>Every client gets a code at their first checkout. It is on their emailed receipt and in their online account; staff can text or email it from the client page; and the <Link href={`${base}/marketing/automations`} className="text-brand-700 underline">Refer a friend</Link> automation sends it after a first visit.</p>
          </Card>
        ) : null}
      </div>
    </>
  );
}
