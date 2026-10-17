"use client";
import { useState } from "react";
import { Input, Checkbox } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { saveLoyaltySettings } from "./actions";

export type LoyaltyValues = { loyaltyEnabled: boolean; loyaltyPointsPerDollar: number; loyaltyPointsPerVisit: number; loyaltyPointValueCents: number; loyaltyMinRedeemPoints: number; referralBonusPoints: number; referralFriendBonusPoints: number };

const NUMBERS = ["loyaltyPointsPerDollar", "loyaltyPointsPerVisit", "loyaltyPointValueCents", "loyaltyMinRedeemPoints", "referralBonusPoints", "referralFriendBonusPoints"] as const;

/** Points and referral settings show only while the programme is on; off, the stored values are posted unchanged. */
export function LoyaltyForm({ slug, v }: { slug: string; v: LoyaltyValues }) {
  const [enabled, setEnabled] = useState(v.loyaltyEnabled);
  return (
    <ActionForm action={saveLoyaltySettings}>
      <input type="hidden" name="slug" value={slug} />
      <Checkbox name="loyaltyEnabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} label="Clients earn points on every paid visit" />
      {enabled ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Points per $1 spent" name="loyaltyPointsPerDollar" hint="On services and products after discounts (not tips or tax)."><Input name="loyaltyPointsPerDollar" type="number" min={0} defaultValue={v.loyaltyPointsPerDollar} /></Field>
            <Field label="Bonus points per visit" name="loyaltyPointsPerVisit"><Input name="loyaltyPointsPerVisit" type="number" min={0} defaultValue={v.loyaltyPointsPerVisit} /></Field>
            <Field label="Value of 1 point (cents)" name="loyaltyPointValueCents" hint="1 = 100 points are worth $1."><Input name="loyaltyPointValueCents" type="number" min={1} defaultValue={v.loyaltyPointValueCents} /></Field>
            <Field label="Minimum points to redeem" name="loyaltyMinRedeemPoints"><Input name="loyaltyMinRedeemPoints" type="number" min={1} defaultValue={v.loyaltyMinRedeemPoints} /></Field>
          </div>
          <h2 className="pt-2 text-sm font-semibold text-stone-700">Referrals</h2>
          <p className="text-xs text-stone-500">Every client gets a code on their page and in their online account. A new client enters it when booking; after their first paid visit, points are awarded.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Points for the referrer" name="referralBonusPoints"><Input name="referralBonusPoints" type="number" min={0} defaultValue={v.referralBonusPoints} /></Field>
            <Field label="Points for the new client" name="referralFriendBonusPoints"><Input name="referralFriendBonusPoints" type="number" min={0} defaultValue={v.referralFriendBonusPoints} /></Field>
          </div>
        </>
      ) : (
        NUMBERS.map((n) => <input key={n} type="hidden" name={n} value={String(v[n])} />)
      )}
      <SubmitButton pendingText="Saving…">Save</SubmitButton>
    </ActionForm>
  );
}
