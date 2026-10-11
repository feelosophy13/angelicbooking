import type { FormFieldDef } from "@angelic/db";
import { Input, Select, Textarea, Checkbox } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { FieldBuilder } from "./builder";
import { OfferedAt } from "@/components/offered-at";
import { ServiceCheckboxes } from "@/components/service-checkboxes";
import type { ServiceGroup } from "@/components/service-picker";

type Action = Parameters<typeof ActionForm>[0]["action"];

/** Shared create/edit form for an intake or consent form. */
export function FormEditor({ action, slug, form, groups, locations = [], submitLabel }: { action: Action; slug: string; form: { id?: string; name: string; kind: string; description: string | null; fields: FormFieldDef[]; requireSignature: boolean; applyToAll: boolean; serviceIds: string[]; renewDays: number | null; active: boolean; locationIds?: string[] } | null; groups: ServiceGroup[]; locations?: { id: string; name: string }[]; submitLabel: string }) {
  return (
    <ActionForm action={action}>
      <input type="hidden" name="slug" value={slug} />
      {form?.id ? <input type="hidden" name="formId" value={form.id} /> : null}
      {form && !form.id ? <p className="rounded-lg border border-brand-100 bg-brand-50/60 px-3 py-2 text-xs text-stone-700">Started from a template. Read the wording and adjust it to your studio before you publish; it is a sensible default, not legal advice.</p> : null}
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
        <FieldBuilder initial={form?.fields ?? []} description={form?.description ?? null} requireSignature={form?.requireSignature ?? true} />
      </div>
      <Checkbox name="requireSignature" defaultChecked={form?.requireSignature ?? true} label="Require a typed signature" />
      <fieldset className="rounded-lg border border-stone-200 p-3">
        <legend className="px-1 text-sm font-medium text-stone-700">Who has to complete it</legend>
        <Checkbox name="applyToAll" defaultChecked={form?.applyToAll ?? false} label="Every client, before any visit" />
        <p className="mb-1 mt-2 text-xs text-stone-500">…or only before these services:</p>
        <ServiceCheckboxes name="serviceIds" groups={groups} selected={form?.serviceIds ?? []} />
      </fieldset>
      <OfferedAt locations={locations} selected={form?.locationIds ?? []} legend="Required at" hint="Untick a location if visits there don't need this form (e.g. a different legal entity with its own waiver)." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ask again after (days)" name="renewDays" hint="Blank = sign once, valid forever."><Input name="renewDays" type="number" min={1} defaultValue={form?.renewDays ?? ""} placeholder="365" /></Field>
        {form ? <Checkbox name="active" defaultChecked={form.active} label="Active" className="mt-7" /> : <input type="hidden" name="active" value="on" />}
      </div>
      <SubmitButton pendingText="Saving…">{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
