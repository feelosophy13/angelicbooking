import type { ChartFieldDef } from "@angelic/core";
import { Checkbox, Input, Textarea } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { ServiceCheckboxes } from "@/components/service-checkboxes";
import type { ServiceTreeNode } from "@/server/service-groups";
import { ChartTemplateBuilder } from "./template-builder";

type Action = Parameters<typeof ActionForm>[0]["action"];

/** Shared create and edit form for a chart template. */
export function ChartTemplateEditor({ action, slug, template, tree, submitLabel }: { action: Action; slug: string; template: { id?: string; name: string; description: string | null; fields: ChartFieldDef[]; serviceIds: string[]; active: boolean; starterKey?: string | null } | null; tree: ServiceTreeNode[]; submitLabel: string }) {
  return (
    <ActionForm action={action}>
      <input type="hidden" name="slug" value={slug} />
      {template?.id ? <input type="hidden" name="templateId" value={template.id} /> : null}
      {template?.starterKey ? <input type="hidden" name="starterKey" value={template.starterKey} /> : null}
      <Field label="Name" name="name" required><Input name="name" defaultValue={template?.name ?? ""} required placeholder="Chemical peel" autoFocus={!template} /></Field>
      <Field label="Notes for the team" name="description" hint="Shown above the chart while it is filled in. Optional."><Textarea name="description" rows={2} defaultValue={template?.description ?? ""} /></Field>
      <div>
        <p className="mb-1 text-sm font-medium text-stone-700">Fields</p>
        <ChartTemplateBuilder initial={template?.fields ?? []} />
      </div>
      <fieldset className="rounded-lg border border-stone-200 p-3">
        <legend className="px-1 text-sm font-medium text-stone-700">Opens first for these services</legend>
        <p className="mb-2 text-xs text-stone-500">&quot;Chart this visit&quot; on one of these services starts with this template. Any template can still be chosen.</p>
        <ServiceCheckboxes name="serviceIds" tree={tree} selected={template?.serviceIds ?? []} />
      </fieldset>
      {template?.id ? <Checkbox name="active" defaultChecked={template.active} label="Active" hint="Inactive templates are not offered for new charts. Charts already written keep their own copy." /> : <input type="hidden" name="active" value="on" />}
      <SubmitButton pendingText="Saving…">{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
