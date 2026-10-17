"use client";
import { Field, SubmitButton, useFormState } from "@/components/form";
import { Input, Textarea } from "@/components/ui";
import { RowLink, rowClass } from "@/components/row";
import { cn } from "@/lib/utils";

/** The new-client fields: they keep what was typed when the submit comes back (a likely duplicate, a bad number). */
export function NewClientFields() {
  const v = useFormState()?.values ?? {};
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" name="firstName" required><Input name="firstName" required autoFocus defaultValue={v.firstName} /></Field>
        <Field label="Last name" name="lastName"><Input name="lastName" defaultValue={v.lastName} /></Field>
      </div>
      <Field label="Mobile phone" name="phone" hint="Used for text confirmations and reminders."><Input name="phone" type="tel" defaultValue={v.phone} /></Field>
      <Field label="Email" name="email"><Input name="email" type="email" defaultValue={v.email} /></Field>
      <Field label="Birthday" name="birthday" hint="Optional, for birthday messages."><Input name="birthday" type="date" defaultValue={v.birthday} /></Field>
      <Field label="Notes" name="notes"><Textarea name="notes" rows={5} placeholder="Allergies, formulas, preferences" defaultValue={v.notes} /></Field>
    </>
  );
}

/**
 * The submit area. When the server found clients that look like the same person, it lists them (each opens that client) and the
 * button becomes "Create anyway", which resubmits with confirmDuplicate=1.
 */
export function NewClientSubmit() {
  const matches = useFormState()?.matches ?? [];
  if (!matches.length) return <SubmitButton pendingText="Creating…">Create client</SubmitButton>;
  return (
    <div className="space-y-3">
      <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3">
        <p className="text-sm font-medium text-amber-900">{matches.length === 1 ? "This client may already be on file" : "These clients may already be on file"}</p>
        <p className="mt-0.5 text-xs text-amber-800">Open one to use it, or create a new client anyway.</p>
        <ul className="mt-2 divide-y divide-amber-200 overflow-hidden rounded-md border border-amber-200 bg-white">
          {matches.map((m) => (
            <li key={m.href} className={cn(rowClass, "px-3 py-2")}>
              <RowLink href={m.href} className="block text-sm font-medium text-stone-900">{m.name}</RowLink>
              <p className="text-xs text-stone-500">{m.detail}</p>
            </li>
          ))}
        </ul>
      </div>
      <SubmitButton name="confirmDuplicate" value="1" pendingText="Creating…">Create anyway</SubmitButton>
    </div>
  );
}
