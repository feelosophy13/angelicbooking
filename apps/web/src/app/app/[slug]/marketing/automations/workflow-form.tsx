import type { WorkflowTrigger } from "@angelic/db";
import { Input, Select, Textarea } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { flattenTree, buildTree, type AnyCategory } from "@/server/categories";
import { TRIGGERS } from "@/lib/workflows-logic";
import type { Workflow } from "@/server/workflows";
import { StepsEditor } from "./steps-editor";
import { saveWorkflowAction } from "./actions";

export type Pickers = {
  services: { id: string; name: string }[];
  categories: AnyCategory[];
  locations: { id: string; name: string }[];
  staff: { id: string; name: string }[];
};

/** Shared create / edit form: trigger, filters, steps, and the stop-on-booking switch. */
export function WorkflowForm({ slug, workflow, trigger, pickers }: { slug: string; workflow: Workflow | null; trigger: WorkflowTrigger; pickers: Pickers }) {
  const f = workflow?.filters ?? {};
  const apptTrigger = trigger.startsWith("appointment_");
  const cats = flattenTree(buildTree(pickers.categories));
  const multi = (name: string, items: { id: string; name: string; depth?: number }[], selected: string[] | undefined) => (
    <div className="grid max-h-40 gap-1 overflow-y-auto rounded-lg border border-stone-200 bg-white p-2 text-sm sm:grid-cols-2">
      {items.map((x) => (
        <label key={x.id} className="flex items-center gap-2" style={{ paddingLeft: `${(x.depth ?? 0) * 12}px` }}>
          <input type="checkbox" name={name} value={x.id} defaultChecked={selected?.includes(x.id)} className="h-4 w-4 accent-brand-600" /> {x.name}
        </label>
      ))}
      {items.length === 0 ? <p className="text-xs text-stone-500">None yet.</p> : null}
    </div>
  );
  return (
    <ActionForm action={saveWorkflowAction} className="space-y-5">
      <input type="hidden" name="slug" value={slug} />
      {workflow ? <input type="hidden" name="workflowId" value={workflow.id} /> : null}
      <input type="hidden" name="trigger" value={trigger} />
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <Field label="Name" name="name" required><Input name="name" defaultValue={workflow?.name ?? ""} required placeholder="Aftercare for colour clients" /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium"><input type="checkbox" name="enabled" defaultChecked={workflow?.enabled ?? false} className="h-4 w-4 accent-brand-600" /> On</label>
      </div>
      <Field label="Description" name="description" hint="For you and your team; clients never see it."><Textarea name="description" rows={2} defaultValue={workflow?.description ?? ""} /></Field>
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm">
        <p className="font-medium">Starts when: {TRIGGERS.find((t) => t.key === trigger)?.label}</p>
        <p className="text-xs text-stone-600">{TRIGGERS.find((t) => t.key === trigger)?.description}{workflow ? " To change the trigger, create a new workflow." : ""}</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-stone-800">Only when… <span className="font-normal text-stone-500">(leave empty for everyone)</span></h2>
        {trigger === "no_visit" ? <Field label="Days since the last visit" name="days" required><Input name="days" type="number" min={7} max={730} defaultValue={f.days ?? 60} className="w-32" required /></Field> : null}
        {apptTrigger || trigger === "form_submitted" || trigger === "review_submitted" ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <div><p className="mb-1 text-xs font-medium text-stone-600">Service category</p>{multi("categoryIds", cats, f.categoryIds)}</div>
            <div><p className="mb-1 text-xs font-medium text-stone-600">Specific services</p>{multi("serviceIds", pickers.services, f.serviceIds)}</div>
            <div><p className="mb-1 text-xs font-medium text-stone-600">Provider</p>{multi("staffIds", pickers.staff, f.staffIds)}</div>
            {pickers.locations.length > 1 ? <div><p className="mb-1 text-xs font-medium text-stone-600">Location</p>{multi("locationIds", pickers.locations, f.locationIds)}</div> : null}
          </div>
        ) : null}
        {trigger === "review_submitted" ? (
          <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
            <Field label="Rating from" name="minRating"><Select name="minRating" defaultValue={f.minRating ?? ""}><option value="">Any</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} ★</option>)}</Select></Field>
            <Field label="Rating to" name="maxRating"><Select name="maxRating" defaultValue={f.maxRating ?? ""}><option value="">Any</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} ★</option>)}</Select></Field>
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Client has a tag" name="tags" hint="Comma-separated; any match counts."><Input name="tags" defaultValue={(f.tags ?? []).join(", ")} placeholder="VIP, Colour client" /></Field>
          {apptTrigger || trigger === "client_created" ? <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="firstVisitOnly" defaultChecked={f.firstVisitOnly ?? false} className="h-4 w-4 accent-brand-600" /> First visit only</label> : null}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-stone-800">Then, in order</h2>
        <StepsEditor initial={workflow?.steps ?? []} trigger={trigger} />
      </section>

      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="exitOnBooking" defaultChecked={workflow?.exitOnBooking ?? false} className="mt-0.5 h-4 w-4 accent-brand-600" /><span>Stop if the client books again <span className="block text-xs text-stone-500">For rebook and we-miss-you flows: remaining steps are dropped as soon as a new appointment is on the calendar.</span></span></label>
      <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">Always applied: each client gets a workflow once per occasion, texts need text consent and carry the STOP notice, emails need email consent and carry an unsubscribe link, and messages from the Visit completed, New client, Birthday and No-visit triggers are held until 9am–8pm in your time zone.</p>
      <SubmitButton pendingText="Saving…">{workflow ? "Save workflow" : "Create workflow"}</SubmitButton>
    </ActionForm>
  );
}
