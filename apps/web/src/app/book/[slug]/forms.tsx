"use client";
import { useActionState } from "react";
import { bookOnline, joinWaitlistAction, type PublicState } from "./actions";
import { Field, Input, Notice, Textarea, Checkbox } from "@/components/ui";
import { SubmitButton } from "@/components/form";

export type BookingDefaults = { firstName: string; lastName: string; phone: string | null; email: string | null; smsOptIn: boolean } | null;

export function BookingForm(props: { slug: string; serviceId: string; staffId: string; startAt: string; policy: string | null; cancelWindowHours: number; lateFee?: string | null; /** What the page quoted for this stylist, in cents; the server refuses the booking if it has since changed. */ quotedPriceCents?: number; classSessionId?: string | null; referrals?: boolean; defaults?: BookingDefaults; promos?: boolean; embed?: boolean; locationId?: string | null }) {
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
      {props.quotedPriceCents !== undefined ? <input type="hidden" name="quotedPriceCents" value={props.quotedPriceCents} /> : null}
      {d ? <p className="text-sm text-stone-600">Booking as <b>{d.firstName} {d.lastName}</b>.</p> : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" required><Input name="firstName" required autoComplete="given-name" defaultValue={d?.firstName} /></Field>
        <Field label="Last name"><Input name="lastName" autoComplete="family-name" defaultValue={d?.lastName} /></Field>
      </div>
      <Field label="Mobile number" required><Input name="phone" type="tel" required autoComplete="tel" defaultValue={d?.phone ?? ""} /></Field>
      <Field label="Email"><Input name="email" type="email" autoComplete="email" defaultValue={d?.email ?? ""} /></Field>
      <p className="-mt-2 text-xs text-stone-500">We text your confirmation to this number.</p>
      {d?.smsOptIn ? <input type="hidden" name="smsConsent" value="on" /> : <SmsConsent />}
      <Field label="Anything we should know?"><Textarea name="notes" rows={4} /></Field>
      {props.referrals && !d ? <Field label="Referral code (optional)"><Input name="referralCode" placeholder="From a friend who comes here" className="uppercase placeholder:normal-case" /></Field> : null}
      {props.promos ? <Field label="Promo code (optional)"><Input name="promoCode" placeholder="Code" className="uppercase placeholder:normal-case" /></Field> : null}
      {state?.error ? <Notice>{state.error}</Notice> : null}
      <SubmitButton className="w-full" style={{ background: "var(--brand)" }} pendingText="Booking…">Confirm booking</SubmitButton>
      <p className="text-xs text-stone-500">You can cancel or reschedule online up to {props.cancelWindowHours} hours before.{props.lateFee ? ` Cancellations inside that window carry a fee of ${props.lateFee}.` : ""}{props.policy ? ` ${props.policy}` : ""}</p>
    </form>
  );
}

export function WaitlistForm(props: { slug: string; serviceId: string; staffId: string; date: string; locationId?: string | null }) {
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
        <Field label="First name" required><Input name="firstName" required /></Field>
        <Field label="Last name"><Input name="lastName" /></Field>
      </div>
      <Field label="Mobile number" required><Input name="phone" type="tel" required autoComplete="tel" /></Field>
      <Field label="Email"><Input name="email" type="email" /></Field>
      <SmsConsent />
      <Field label="Preferred times"><Input name="notes" placeholder="Afternoons, after 3pm…" /></Field>
      {state?.error ? <Notice>{state.error}</Notice> : null}
      <SubmitButton variant="secondary" className="w-full" pendingText="Joining…">Join waitlist</SubmitButton>
    </form>
  );
}

/**
 * Explicit SMS opt-in (unchecked by default), worded the way US carriers expect
 * for toll-free verification. The checkbox state becomes the client's smsOptIn.
 */
export function SmsConsent() {
  return (
    <Checkbox name="smsConsent" className="text-xs [&_span]:text-stone-600" label={<>
        Text me appointment confirmations and reminders at this mobile number. Message frequency varies by appointment. Msg &amp; data rates may apply. Reply STOP to opt out, HELP for help.
      </>} />
  );
}
