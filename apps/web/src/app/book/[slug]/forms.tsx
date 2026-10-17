"use client";
import { PublicBotCheck } from "@/components/turnstile";
import { useActionState } from "react";
import { bookOnline, joinWaitlistAction, type PublicState } from "./actions";
import { Field, Input, Notice, Textarea, Checkbox } from "@/components/ui";
import { Disclosure } from "@/components/disclosure";
import { SubmitButton } from "@/components/form";
import { policyLine } from "@/lib/policy-text";

export type BookingDefaults = { firstName: string; lastName: string; phone: string | null; email: string | null; smsOptIn: boolean; smsMarketingOptIn?: boolean } | null;

export function BookingForm(props: { extraServiceIds?: string[]; /** The price being confirmed, shown on the button. */ priceLabel?: string; slug: string; serviceId: string; staffId: string; startAt: string; policy: string | null; cancelWindowHours: number; lateFee?: string | null; /** What the page quoted for this stylist, in cents; the server refuses the booking if it has since changed. */ quotedPriceCents?: number; classSessionId?: string | null; referrals?: boolean; defaults?: BookingDefaults; promos?: boolean; embed?: boolean; locationId?: string | null }) {
  const [state, action] = useActionState<PublicState, FormData>(bookOnline, undefined);
  const d = props.defaults;
  return (
    <form action={action} className="space-y-3 rounded-xl border border-stone-200 bg-white p-4">
      <input type="hidden" name="slug" value={props.slug} />
      {props.embed ? <input type="hidden" name="embed" value="1" /> : null}
      {props.classSessionId ? <input type="hidden" name="classSessionId" value={props.classSessionId} /> : null}
      {props.locationId ? <input type="hidden" name="locationId" value={props.locationId} /> : null}
      <input type="hidden" name="serviceId" value={props.serviceId} />
      <input type="hidden" name="staffId" value={props.staffId} />
      <input type="hidden" name="startAt" value={props.startAt} />
      {props.extraServiceIds?.length ? <input type="hidden" name="extraServiceIds" value={props.extraServiceIds.join(",")} /> : null}
      {props.quotedPriceCents !== undefined ? <input type="hidden" name="quotedPriceCents" value={props.quotedPriceCents} /> : null}
      <ContactFields defaults={d} referrals={props.referrals} promos={props.promos} />
      {state?.error ? <Notice>{state.error}</Notice> : null}
      <PublicBotCheck resetKey={state} />
      <SubmitButton className="w-full" style={{ background: "var(--brand)" }} pendingText="Booking…">Confirm booking{props.priceLabel ? ` · ${props.priceLabel}` : ""}</SubmitButton>
      <p className="text-xs text-stone-500">{policyLine(props)} By booking, you agree to this policy.</p>
    </form>
  );
}

/**
 * The details every booking asks for, shared by the free and the paid form so they cannot drift.
 * Codes are rare, so they sit behind one "Have a code?" line.
 */
export function ContactFields({ defaults: d, referrals, promos }: { defaults?: BookingDefaults; referrals?: boolean; promos?: boolean }) {
  const showReferral = !!referrals && !d;
  return (
    <>
      {d ? <p className="text-sm text-stone-600">Booking as <b>{d.firstName} {d.lastName}</b>.</p> : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" required><Input name="firstName" required autoComplete="given-name" defaultValue={d?.firstName} /></Field>
        <Field label="Last name"><Input name="lastName" autoComplete="family-name" defaultValue={d?.lastName} /></Field>
      </div>
      <Field label="Mobile number" required hint={d?.smsOptIn ? "We text your confirmation to this number." : "Tick the box below to get your confirmation and reminders by text."}><Input name="phone" type="tel" required autoComplete="tel" defaultValue={d?.phone ?? ""} /></Field>
      <Field label="Email" required><Input name="email" type="email" required autoComplete="email" defaultValue={d?.email ?? ""} /></Field>
      {d?.smsOptIn ? <input type="hidden" name="smsConsent" value="on" /> : <SmsConsent />}
      {d?.smsMarketingOptIn ? null : <SmsMarketingConsent />}
      <Field label="Anything we should know?"><Textarea name="notes" rows={2} /></Field>
      {showReferral || promos ? (
        <Disclosure title="Have a code?" className="shadow-none">
          <div className="space-y-3">
            {showReferral ? <Field label="Referral code"><Input name="referralCode" placeholder="From a friend who comes here" className="uppercase placeholder:normal-case" /></Field> : null}
            {promos ? <Field label="Promo code"><Input name="promoCode" placeholder="Code" className="uppercase placeholder:normal-case" /></Field> : null}
          </div>
        </Disclosure>
      ) : null}
    </>
  );
}

export function WaitlistForm(props: { slug: string; serviceId: string; staffId: string; date: string; locationId?: string | null; defaults?: BookingDefaults }) {
  const d = props.defaults;
  const [state, action] = useActionState<PublicState, FormData>(joinWaitlistAction, undefined);
  if (state?.ok) return <Notice kind="success">You're on the waitlist. We'll contact you if a spot opens up.</Notice>;
  return (
    <form action={action} className="space-y-3 rounded-xl border border-stone-200 bg-white p-4">
      <input type="hidden" name="slug" value={props.slug} />
      <input type="hidden" name="serviceId" value={props.serviceId} />
      {props.locationId ? <input type="hidden" name="locationId" value={props.locationId} /> : null}
      <input type="hidden" name="staffId" value={props.staffId} />
      <input type="hidden" name="date" value={props.date} />
      <p className="text-sm font-medium">Join the waitlist for this day</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" required><Input name="firstName" required autoComplete="given-name" defaultValue={d?.firstName} /></Field>
        <Field label="Last name"><Input name="lastName" autoComplete="family-name" defaultValue={d?.lastName} /></Field>
      </div>
      <Field label="Mobile number" required><Input name="phone" type="tel" required autoComplete="tel" defaultValue={d?.phone ?? ""} /></Field>
      <Field label="Email"><Input name="email" type="email" autoComplete="email" defaultValue={d?.email ?? ""} /></Field>
      {d?.smsOptIn ? <input type="hidden" name="smsConsent" value="on" /> : <SmsConsent />}
      <Field label="Preferred times"><Input name="notes" placeholder="Afternoons, after 3pm…" /></Field>
      {state?.error ? <Notice>{state.error}</Notice> : null}
      <PublicBotCheck resetKey={state} />
      <SubmitButton variant="secondary" className="w-full" pendingText="Joining…">Join waitlist</SubmitButton>
    </form>
  );
}

/**
 * Explicit SMS opt-in (unchecked by default), worded the way US carriers expect
 * for toll-free verification. The checkbox state becomes the client's smsOptIn.
 */
/** Separate, optional and unticked: marketing texts need their own written consent (TCPA), never bundled with appointment texts. */
export function SmsMarketingConsent() {
  return (
    <Checkbox name="smsMarketingConsent" className="text-xs [&_span]:text-stone-600" label={<>
        Also text me offers and news. Message frequency varies. Msg &amp; data rates may apply. Consent is not required to book. Reply STOP to opt out.
      </>} />
  );
}

export function SmsConsent() {
  return (
    <Checkbox name="smsConsent" className="text-xs [&_span]:text-stone-600" label={<>
        Text me appointment confirmations and reminders at this mobile number. Message frequency varies by appointment. Msg &amp; data rates may apply. Reply STOP to opt out, HELP for help.
      </>} />
  );
}
