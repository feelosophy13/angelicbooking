"use client";
import { useActionState } from "react";
import { bookOnline, joinWaitlistAction, type PublicState } from "./actions";
import { Field, Input, Notice, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/form";

export function BookingForm(props: { slug: string; serviceId: string; staffId: string; startAt: string; policy: string | null; cancelWindowHours: number }) {
  const [state, action] = useActionState<PublicState, FormData>(bookOnline, undefined);
  return (
    <form action={action} className="space-y-3 rounded-xl border border-stone-200 bg-white p-4">
      <input type="hidden" name="slug" value={props.slug} />
      <input type="hidden" name="serviceId" value={props.serviceId} />
      <input type="hidden" name="staffId" value={props.staffId} />
      <input type="hidden" name="startAt" value={props.startAt} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name"><Input name="firstName" required autoComplete="given-name" /></Field>
        <Field label="Last name"><Input name="lastName" autoComplete="family-name" /></Field>
      </div>
      <Field label="Mobile number"><Input name="phone" type="tel" autoComplete="tel" /></Field>
      <Field label="Email"><Input name="email" type="email" autoComplete="email" /></Field>
      <SmsConsent />
      <Field label="Anything we should know?"><Textarea name="notes" rows={2} /></Field>
      {state?.error ? <Notice>{state.error}</Notice> : null}
      <SubmitButton className="w-full" style={{ background: "var(--brand)" }} pendingText="Booking…">Confirm booking</SubmitButton>
      <p className="text-xs text-stone-500">You can cancel or reschedule online up to {props.cancelWindowHours} hours before.{props.policy ? ` ${props.policy}` : ""}</p>
    </form>
  );
}

export function WaitlistForm(props: { slug: string; serviceId: string; staffId: string; date: string }) {
  const [state, action] = useActionState<PublicState, FormData>(joinWaitlistAction, undefined);
  if (state?.ok) return <Notice kind="success">You're on the waitlist. We'll contact you if a spot opens up.</Notice>;
  return (
    <form action={action} className="space-y-3 rounded-xl border border-stone-200 bg-white p-4">
      <input type="hidden" name="slug" value={props.slug} />
      <input type="hidden" name="serviceId" value={props.serviceId} />
      <input type="hidden" name="staffId" value={props.staffId} />
      <input type="hidden" name="date" value={props.date} />
      <p className="text-sm font-medium">Join the waitlist for this day</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name"><Input name="firstName" required /></Field>
        <Field label="Last name"><Input name="lastName" /></Field>
      </div>
      <Field label="Mobile number"><Input name="phone" type="tel" /></Field>
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
    <label className="flex items-start gap-2 text-xs text-stone-600">
      <input type="checkbox" name="smsConsent" className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" />
      <span>
        Text me appointment confirmations and reminders at this mobile number. Message frequency varies by appointment. Msg &amp; data rates may apply. Reply STOP to opt out, HELP for help.
      </span>
    </label>
  );
}
