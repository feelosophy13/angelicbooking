"use client";
import { useState } from "react";
import Link from "next/link";
import { Input, Textarea, Checkbox, Select, MoneyInput } from "@/components/ui";
import { Disclosure } from "@/components/disclosure";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { saveBookingSettings } from "./actions";

export type BookingValues = {
  onlineBookingEnabled: boolean;
  minNoticeMin: number;
  maxAdvanceDays: number;
  cancelWindowHours: number;
  lapsedAfterDays: number;
  bookingOrder: string;
  anyProviderMode: string;
  noShowFeeCents: number;
  lateCancelFeeType: "none" | "flat" | "percent";
  lateCancelFeeValue: number;
  lateCancelDeposit: string;
  depositRefundAs: string;
  requireCardOnline: boolean;
  clientAccountsEnabled: boolean;
  clientPhotosOnBooking: boolean;
  verifyBookingContact: boolean;
  bookingPolicy: string | null;
  addressLine: string | null;
};

/** Hidden copy of a value whose control is not on screen, so saving never resets it. */
function Keep({ name, value }: { name: string; value: string | boolean }) {
  if (value === false) return null;
  return <input type="hidden" name={name} value={value === true ? "on" : value} />;
}

/**
 * Online booking rules. Fields that only matter when booking is on, when a fee is set, or
 * when Stripe can charge cards appear only then; hidden values are posted unchanged.
 */
export function BookingForm({ slug, v, stripeReady, paymentsHref, feeSummary, feeLabel, policyConflict }: { slug: string; v: BookingValues; stripeReady: boolean; /** Settings → Payments, or null when the viewer cannot open it. */ paymentsHref: string | null; feeSummary: string; feeLabel: string; policyConflict: string | null }) {
  const [online, setOnline] = useState(v.onlineBookingEnabled);
  const [feeType, setFeeType] = useState(v.lateCancelFeeType);
  const feeValue = v.lateCancelFeeType === "flat" ? (v.lateCancelFeeValue / 100).toFixed(2) : v.lateCancelFeeType === "percent" ? String(v.lateCancelFeeValue / 100) : "";
  return (
    <ActionForm action={saveBookingSettings}>
      <input type="hidden" name="slug" value={slug} />
      <Checkbox name="onlineBookingEnabled" checked={online} onChange={(e) => setOnline(e.target.checked)} label="Allow clients to book online" />
      {online ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Minimum notice" name="minNoticeMin" hint="Minutes before a slot can still be booked."><Input name="minNoticeMin" type="number" min={0} defaultValue={v.minNoticeMin} /></Field>
            <Field label="Book up to" name="maxAdvanceDays" hint="Days ahead."><Input name="maxAdvanceDays" type="number" min={1} max={365} defaultValue={v.maxAdvanceDays} /></Field>
          </div>
          <Field label="Order of steps" name="bookingOrder" hint="Clients can't change this. Provider first suits salons where people ask for a stylist; time first suits clients who just want the earliest slot.">
            <Select name="bookingOrder" defaultValue={v.bookingOrder}>
              <option value="provider">Choose a provider, then a day and time</option>
              <option value="time">Choose a day and time, then a provider</option>
            </Select>
          </Field>
          <Field label="When a client picks “Any available provider”" name="anyProviderMode" hint="What happens when several people are free at the same time.">
            <Select name="anyProviderMode" defaultValue={v.anyProviderMode}>
              <option value="choose">Show who is free and let the client choose</option>
              <option value="first">Give it to the first in the Staff list order</option>
              <option value="lowest_price">Give it to the lowest price</option>
              <option value="fewest_bookings">Give it to whoever has the fewest bookings that day</option>
            </Select>
          </Field>
          <Checkbox name="verifyBookingContact" defaultChecked={v.verifyBookingContact} label="Confirm the client's mobile number with a code before they book" hint="A 6-digit code by text (or email when texting isn't set up). Stops bookings under someone else's number, and makes sure consent to marketing texts comes from the number's owner. Signed-in clients skip it." />
          <Checkbox name="clientPhotosOnBooking" defaultChecked={v.clientPhotosOnBooking} label="Let clients attach photos when booking" hint="Up to 5 pictures with their details: inspiration, a reference style, or their current lashes or brows. Shown on the appointment and kept private to your team." />
        </>
      ) : (
        <>
          <Keep name="minNoticeMin" value={String(v.minNoticeMin)} />
          <Keep name="maxAdvanceDays" value={String(v.maxAdvanceDays)} />
          <Keep name="bookingOrder" value={v.bookingOrder} />
          <Keep name="anyProviderMode" value={v.anyProviderMode} />
          <Keep name="clientPhotosOnBooking" value={v.clientPhotosOnBooking} />
          <Keep name="verifyBookingContact" value={v.verifyBookingContact} />
        </>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Cancellation window" name="cancelWindowHours" hint="Hours before the visit. Cancelling inside it counts as late."><Input name="cancelWindowHours" type="number" min={0} defaultValue={v.cancelWindowHours} /></Field>
        <Field label="Consider a client lapsed after" name="lapsedAfterDays" hint="Days since their last visit with nothing booked. Reports count who came back in time and who was lost by it, and list who is lapsed right now. Set it to your clients' usual gap between visits."><Input name="lapsedAfterDays" type="number" min={7} max={730} defaultValue={v.lapsedAfterDays} /></Field>
      </div>
      <Disclosure variant="inset" title="Fees, deposits and cards" hint={feeSummary} open={v.requireCardOnline || v.noShowFeeCents > 0 || v.lateCancelFeeType !== "none"}>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Late cancellation fee" name="lateCancelFeeType" hint="Inside the cancellation window; shown in the booking policy.">
              <Select name="lateCancelFeeType" value={feeType} onChange={(e) => setFeeType(e.target.value as BookingValues["lateCancelFeeType"])}>
                <option value="none">No fee</option>
                <option value="flat">Flat amount</option>
                <option value="percent">Percent of services</option>
              </Select>
            </Field>
            {feeType === "flat" ? (
              <Field label="Fee amount" name="lateCancelFeeValue"><MoneyInput name="lateCancelFeeValue" defaultValue={feeValue} /></Field>
            ) : feeType === "percent" ? (
              <Field label="Percent of the services booked" name="lateCancelFeeValue"><Input name="lateCancelFeeValue" inputMode="decimal" defaultValue={feeValue} placeholder="25" /></Field>
            ) : null}
            {stripeReady ? (
              <>
                <Field label="No-show fee" name="noShowFee" hint="Charged to a saved card from the appointment page.">
                  <MoneyInput name="noShowFee" defaultValue={v.noShowFeeCents ? (v.noShowFeeCents / 100).toFixed(2) : ""} />
                </Field>
                {feeType !== "none" ? (
                  <Field label="A paid deposit, on a late cancellation" name="lateCancelDeposit">
                    <Select name="lateCancelDeposit" defaultValue={v.lateCancelDeposit}>
                      <option value="toward">Counts toward the fee</option>
                      <option value="extra">Is kept on top of the fee</option>
                    </Select>
                  </Field>
                ) : (
                  <Keep name="lateCancelDeposit" value={v.lateCancelDeposit} />
                )}
                <Field label="Returned deposits go" name="depositRefundAs" hint="On an in-window cancellation or a staff refund.">
                  <Select name="depositRefundAs" defaultValue={v.depositRefundAs}>
                    <option value="original">Back to the card</option>
                    <option value="store_credit">To the client as store credit</option>
                  </Select>
                </Field>
              </>
            ) : (
              <>
                <Keep name="noShowFee" value={v.noShowFeeCents ? (v.noShowFeeCents / 100).toFixed(2) : ""} />
                <Keep name="lateCancelDeposit" value={v.lateCancelDeposit} />
                <Keep name="depositRefundAs" value={v.depositRefundAs} />
              </>
            )}
          </div>
          {stripeReady && online ? (
            <Checkbox name="requireCardOnline" defaultChecked={v.requireCardOnline} label="Require a card on file to book online" hint="Nothing is charged at booking; the card is kept for fees." />
          ) : (
            <Keep name="requireCardOnline" value={v.requireCardOnline} />
          )}
          {stripeReady ? (
            <p className="text-xs text-stone-500">Deposits themselves are set per service.</p>
          ) : (
            <p className="text-xs text-stone-500">No-show fees, deposits and cards on file need card payments. {paymentsHref ? <Link href={paymentsHref} className="text-brand-700 underline">Connect Stripe under Payments</Link> : "Ask the owner to connect Stripe under Payments"}.</p>
          )}
        </div>
      </Disclosure>
      <Disclosure variant="inset" title={online ? "Policy, address and client accounts" : "Policy and address"} open={!!v.bookingPolicy || v.clientAccountsEnabled}>
        <div className="space-y-3">
          <Field label="Booking policy" name="bookingPolicy" hint={feeType !== "none" ? "Shown to clients when they book. The late cancellation fee above is added for you, so there is no need to repeat it." : "Shown to clients when they book."}><Textarea name="bookingPolicy" rows={5} defaultValue={v.bookingPolicy ?? ""} placeholder="Please arrive 5 minutes early. Late cancellations may be charged." /></Field>
          {policyConflict ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Your policy says &ldquo;{policyConflict}&rdquo; but the late cancellation fee is set to {feeLabel}. Clients see both, and the fee above is the one that is charged. Edit the policy text so they agree.</p>
          ) : null}
          <Field label="Address shown on the booking page and in messages" name="addressLine"><Input name="addressLine" defaultValue={v.addressLine ?? ""} placeholder="123 Main St, Springfield" /></Field>
          {online ? (
            <Checkbox name="clientAccountsEnabled" defaultChecked={v.clientAccountsEnabled} label="Client accounts on the booking page" hint="Clients sign in with a code by email or text to see upcoming visits, rebook, and use saved cards and points." />
          ) : (
            <Keep name="clientAccountsEnabled" value={v.clientAccountsEnabled} />
          )}
        </div>
      </Disclosure>
      <p className="text-xs text-stone-500">Reminder timing and wording live under <Link href={`/app/${slug}/marketing/automations`} className="text-brand-700 underline">Automations → Appointment reminder</Link>.</p>
      <SubmitButton pendingText="Saving…">Save</SubmitButton>
    </ActionForm>
  );
}
