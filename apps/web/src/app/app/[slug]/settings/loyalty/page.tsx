import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { BackLink, Card, Input, PageHeader } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { saveLoyaltySettings } from "./actions";

export const metadata: Metadata = { title: "Loyalty & referrals" };

export default async function LoyaltySettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business: b } = await requireAction(slug, "business.manage");
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Loyalty & referrals" />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="p-4">
          <ActionForm action={saveLoyaltySettings}>
            <input type="hidden" name="slug" value={slug} />
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" name="loyaltyEnabled" defaultChecked={b.loyaltyEnabled} className="h-4 w-4 accent-brand-600" />
              Clients earn points on every paid visit
            </label>
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
        </Card>
      </div>
    </>
  );
}
