"use client";
import type { FormAnswer, FormFieldDef } from "@angelic/db";
import { FormFill } from "@/components/form-fill";
import { Field, Input } from "@/components/ui";
import { submitSharedForm } from "./actions";

/** The shareable-link version of a form: asks who is filling it in unless a client is signed in. */
export function SharedForm({ slug, form, me, defaults }: { slug: string; form: { id: string; name: string; description: string | null; fields: FormFieldDef[]; requireSignature: boolean }; me: { firstName: string; lastName: string } | null; defaults?: Record<string, FormAnswer> | null }) {
  const who = me ? (
    <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">Filling in as <b>{me.firstName} {me.lastName}</b>.</p>
  ) : (
    <fieldset className="space-y-3 rounded-xl border border-stone-200 bg-stone-50/60 p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-stone-500">About you</legend>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name"><Input name="firstName" required autoComplete="given-name" /></Field>
        <Field label="Last name"><Input name="lastName" autoComplete="family-name" /></Field>
      </div>
      <Field label="Mobile number"><Input name="phone" type="tel" autoComplete="tel" /></Field>
      <Field label="Email"><Input name="email" type="email" autoComplete="email" /></Field>
      <p className="text-xs text-stone-500">We use your number or email to attach this form to your client record.</p>
    </fieldset>
  );
  return <FormFill action={submitSharedForm} hidden={{ slug, formId: form.id }} form={form} clientName={me ? `${me.firstName} ${me.lastName}`.trim() : ""} before={who} defaults={defaults} botCheck />;
}
