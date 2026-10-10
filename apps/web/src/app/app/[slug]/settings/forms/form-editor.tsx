import type { FormFieldDef } from "@angelic/db";
import { Input, Select, Textarea } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { FieldBuilder } from "./builder";

type Action = Parameters<typeof ActionForm>[0]["action"];

/** Shared create/edit form for an intake or consent form. */
export function FormEditor({ action, slug, form, services, submitLabel }: { action: Action; slug: string; form: { id?: string; name: string; kind: string; description: string | null; fields: FormFieldDef[]; requireSignature: boolean; applyToAll: boolean; serviceIds: string[]; renewDays: number | null; active: boolean } | null; services: { id: string; name: string }[]; submitLabel: string }) {
  return (
    <ActionForm action={action}>
      <input type="hidden" name="slug" value={slug} />
      {form?.id ? <input type="hidden" name="formId" value={form.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <Field label="Name" name="name" required><Input name="name" defaultValue={form?.name ?? ""} required placeholder="New client intake" autoFocus={!form} /></Field>
        <Field label="Type" name="kind">
          <Select name="kind" defaultValue={form?.kind ?? "intake"}>
            <option value="intake">Intake (questions)</option>
            <option value="consent">Consent / waiver</option>
          </Select>
        </Field>
      </div>
      <Field label="Text shown at the top" name="description" hint="For a waiver, put the full text here; clients sign underneath."><Textarea name="description" rows={5} defaultValue={form?.description ?? ""} /></Field>
      <div>
        <p className="mb-1 text-sm font-medium text-stone-700">Questions</p>
        <FieldBuilder initial={form?.fields ?? []} />
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="requireSignature" defaultChecked={form?.requireSignature ?? true} className="h-4 w-4 accent-brand-600" /> Require a typed signature</label>
      <fieldset className="rounded-lg border border-stone-200 p-3">
        <legend className="px-1 text-sm font-medium text-stone-700">Who has to complete it</legend>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="applyToAll" defaultChecked={form?.applyToAll ?? false} className="h-4 w-4 accent-brand-600" /> Every client, before any visit</label>
        <p className="mt-2 text-xs text-stone-500">…or only before these services:</p>
        <div className="mt-1 grid gap-1 sm:grid-cols-2">
          {services.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="serviceIds" value={s.id} defaultChecked={form?.serviceIds.includes(s.id) ?? false} className="h-4 w-4 accent-brand-600" /> {s.name}</label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ask again after (days)" name="renewDays" hint="Blank = sign once, valid forever."><Input name="renewDays" type="number" min={1} defaultValue={form?.renewDays ?? ""} placeholder="365" /></Field>
        {form ? <label className="mt-7 flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={form.active} className="h-4 w-4 accent-brand-600" /> Active</label> : <input type="hidden" name="active" value="on" />}
      </div>
      <SubmitButton pendingText="Saving…">{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
