"use client";
import { useActionState } from "react";
import { Field, Input, Notice, Checkbox } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { requestCode, saveClientProfile, verifyCode, type AccountState } from "./actions";

export function SignInForm({ slug }: { slug: string }) {
  const [state, action] = useActionState<AccountState, FormData>(requestCode, undefined);
  const [vstate, vaction] = useActionState<AccountState, FormData>(verifyCode, undefined);
  const sent = vstate?.sent ?? state?.sent;
  const destination = vstate?.destination ?? state?.destination ?? "";
  if (sent) {
    return (
      <form action={vaction} className="space-y-3">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="destination" value={destination} />
        <p className="text-sm text-stone-700">If <b>{destination}</b> is on file with us, a 6-digit code is on its way{sent === "sms" ? " by text" : " by email"}.</p>
        <Field label="Code"><Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="text-center text-xl tracking-[0.4em]" autoFocus /></Field>
        {vstate?.error ? <Notice>{vstate.error}</Notice> : null}
        <SubmitButton className="w-full" style={{ background: "var(--brand)" }} pendingText="Checking…">Sign in</SubmitButton>
        <p className="text-center text-xs text-stone-500"><a href={`/book/${slug}/account`} className="underline">Use a different email or number</a></p>
      </form>
    );
  }
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <Field label="Email or mobile number"><Input name="destination" autoComplete="username" autoFocus /></Field>
      {state?.error ? <Notice>{state.error}</Notice> : null}
      <SubmitButton className="w-full" style={{ background: "var(--brand)" }} pendingText="Sending…">Send me a code</SubmitButton>
      <p className="text-xs text-stone-500">No password needed. We&apos;ll send a one-time code to the contact details you book with.</p>
    </form>
  );
}

export function ProfileForm({ slug, client }: { slug: string; client: { firstName: string; lastName: string; email: string | null; phone: string | null; birthday: string | null; smsOptIn: boolean; emailOptIn: boolean } }) {
  const [state, action] = useActionState<AccountState, FormData>(saveClientProfile, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name"><Input name="firstName" defaultValue={client.firstName} required /></Field>
        <Field label="Last name"><Input name="lastName" defaultValue={client.lastName} /></Field>
      </div>
      <Field label="Mobile number" required><Input name="phone" type="tel" required defaultValue={client.phone ?? ""} /></Field>
      <Field label="Email"><Input name="email" type="email" defaultValue={client.email ?? ""} /></Field>
      <Field label="Birthday"><Input name="birthday" type="date" defaultValue={client.birthday ?? ""} /></Field>
      <Checkbox name="smsOptIn" defaultChecked={client.smsOptIn} label="Text me confirmations and reminders" />
      <Checkbox name="emailOptIn" defaultChecked={client.emailOptIn} label="Email me confirmations and receipts" />
      {state?.error ? <Notice>{state.error}</Notice> : state?.ok ? <Notice kind="success">Saved.</Notice> : null}
      <SubmitButton variant="secondary" pendingText="Saving…">Save details</SubmitButton>
    </form>
  );
}
