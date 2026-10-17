"use client";
import { useState } from "react";
import { Input, Select, Checkbox, MoneyInput } from "@/components/ui";
import { ActionForm, Field, SubmitButton, useFormState } from "@/components/form";
import { Disclosure } from "@/components/disclosure";
import { createPromo } from "../actions";

const LIMIT_FIELDS = ["startsAt", "expiresAt", "maxUses", "minSubtotal"];

/** Dates, uses, minimum spend and service restrictions: collapsed until wanted, open again when one of them has an error. */
function Limits({ services }: { services: { id: string; name: string }[] }) {
  const state = useFormState();
  const hasError = LIMIT_FIELDS.some((k) => state?.fieldErrors?.[k]);
  return (
    <Disclosure title="Limits" hint="optional: dates, uses, minimum spend, services" open={hasError || undefined}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Starts" name="startsAt"><Input name="startsAt" type="date" /></Field>
          <Field label="Expires" name="expiresAt"><Input name="expiresAt" type="date" /></Field>
          <Field label="Max uses" name="maxUses" hint="Blank = unlimited"><Input name="maxUses" type="number" min={1} /></Field>
        </div>
        <Field label="Minimum subtotal" name="minSubtotal"><MoneyInput name="minSubtotal" className="w-40" /></Field>
        {services.length ? (
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-stone-700">Only for these services</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {services.map((s) => <Checkbox key={s.id} name="serviceIds" value={s.id} label={s.name} />)}
            </div>
          </fieldset>
        ) : null}
      </div>
    </Disclosure>
  );
}

export function PromoForm({ slug, services, currency }: { slug: string; services: { id: string; name: string }[]; currency: string }) {
  const [type, setType] = useState<"percent" | "amount">("percent");
  return (
    <ActionForm action={createPromo}>
      <input type="hidden" name="slug" value={slug} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Code" name="code" required><Input name="code" required placeholder="WELCOME20" className="font-mono uppercase" autoFocus /></Field>
        <Field label="Type" name="type"><Select name="type" value={type} onChange={(e) => setType(e.target.value as "percent" | "amount")}><option value="percent">% off</option><option value="amount">$ off</option></Select></Field>
        {type === "percent" ? (
          <Field label="Percent off" name="value" required><Input name="value" required type="number" min={1} max={100} inputMode="numeric" placeholder="20" /></Field>
        ) : (
          <Field label="Amount off" name="value" required><MoneyInput name="value" currency={currency} required /></Field>
        )}
      </div>
      <Limits services={services} />
      <SubmitButton pendingText="Creating…">Create code</SubmitButton>
    </ActionForm>
  );
}
