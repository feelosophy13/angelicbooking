import { ChevronDown, Zap } from "lucide-react";
import type { WorkflowFilters, WorkflowTrigger } from "@angelic/db";
import { Input, Select, Textarea, Checkbox } from "@/components/ui";
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

/** Chips describing the active conditions, e.g. "Hair, Nails · Ava Martinez · first visit". */
function conditionChips(f: WorkflowFilters, trigger: WorkflowTrigger, p: Pickers): string[] {
  const name = (list: { id: string; name: string }[], ids?: string[]) => (ids ?? []).map((id) => list.find((x) => x.id === id)?.name).filter((x): x is string => !!x);
  const chips: string[] = [];
  if (trigger === "no_visit") chips.push(`${f.days ?? 60} days since the last visit`);
  const cats = name(p.categories, f.categoryIds); if (cats.length) chips.push(cats.join(", "));
  const svcs = name(p.services, f.serviceIds); if (svcs.length) chips.push(svcs.join(", "));
  const staff = name(p.staff, f.staffIds); if (staff.length) chips.push(staff.join(", "));
  const locs = name(p.locations, f.locationIds); if (locs.length) chips.push(locs.map((l) => l.replace(/^.*? - /, "")).join(", "));
  if (f.tags?.length) chips.push(`tag ${f.tags.join(" or ")}`);
  if (f.minRating != null || f.maxRating != null) chips.push(`${f.minRating ?? 1}–${f.maxRating ?? 5} stars`);
  if (f.firstVisitOnly) chips.push("first visit only");
  if (f.onlineOnly) chips.push("booked online only");
  return chips;
}

function Section({ n, title, aside, children }: { n: number; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t border-stone-100 pt-5 first:border-t-0 first:pt-0">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-stone-900 text-[11px] font-semibold text-white">{n}</span>
        <h2 className="text-sm font-semibold text-stone-900">{title}</h2>
        {aside ? <span className="text-xs text-stone-500">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

type PickItem = { id: string; name: string; depth?: number };

/**
 * A collapsible picker: "Service category · 2 selected" that opens into checkboxes.
 * Items are grouped so a parent and its indented children always stay together in one
 * column; a flat list is just a list of one-item groups.
 */
function Picker({ name, label, groups, selected }: { name: string; label: string; groups: PickItem[][]; selected?: string[] }) {
  const all = groups.flat();
  const n = (selected ?? []).filter((id) => all.some((x) => x.id === id)).length;
  return (
    <details className="group rounded-lg border border-stone-200 bg-white" open={n > 0}>
      <summary className="flex cursor-pointer select-none items-center justify-between px-3 py-2 text-sm"><span>{label}{n ? <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">{n} selected</span> : <span className="ml-2 text-xs text-stone-400">any</span>}</span><ChevronDown className="h-4 w-4 text-stone-400 transition group-open:rotate-180" /></summary>
      <div className="max-h-48 columns-1 gap-x-4 overflow-y-auto border-t border-stone-100 p-2 text-sm sm:columns-2">
        {groups.map((g, gi) => (
          <div key={g[0]?.id ?? gi} className="mb-1 break-inside-avoid space-y-1">
            {g.map((x) => (
              <Checkbox key={x.id} name={name} value={x.id} defaultChecked={selected?.includes(x.id)} label={<span className={x.depth ? "text-stone-700" : "font-medium"}>{x.name}</span>} style={{ paddingLeft: `${(x.depth ?? 0) * 16}px` }} />
            ))}
          </div>
        ))}
        {all.length === 0 ? <p className="text-xs text-stone-500">None yet.</p> : null}
      </div>
    </details>
  );
}

const flatGroups = (items: PickItem[]): PickItem[][] => items.map((x) => [x]);

/** Shared create / edit form: name and switch, trigger, conditions (collapsed), steps timeline, options. */
export function WorkflowForm({ slug, workflow, trigger, pickers }: { slug: string; workflow: Workflow | null; trigger: WorkflowTrigger; pickers: Pickers }) {
  const f = workflow?.filters ?? {};
  const meta = TRIGGERS.find((t) => t.key === trigger)!;
  const apptTrigger = trigger.startsWith("appointment_");
  const showPickers = apptTrigger || trigger === "form_submitted" || trigger === "review_submitted";
  // One group per top-level category: the root followed by its sub-categories, depth-first.
  const catGroups = buildTree(pickers.categories).map((root) => flattenTree([root]).map((c) => ({ id: c.id, name: c.name, depth: c.depth })));
  const chips = conditionChips(f, trigger, pickers);
  const hasConditions = chips.length > 0 || trigger === "no_visit";
  return (
    <ActionForm action={saveWorkflowAction} className="space-y-6">
      <input type="hidden" name="slug" value={slug} />
      {workflow ? <input type="hidden" name="workflowId" value={workflow.id} /> : null}
      <input type="hidden" name="trigger" value={trigger} />

      <Section n={1} title="Name">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1"><Field label="Name" name="name" required className="[&>label]:sr-only"><Input name="name" defaultValue={workflow?.name ?? ""} required placeholder="Aftercare for colour clients" className="text-base font-medium" /></Field></div>
          <Checkbox name="enabled" defaultChecked={workflow?.enabled ?? false} label="On" className="h-10 cursor-pointer !items-center rounded-lg border border-stone-300 bg-white px-3 font-medium has-[:checked]:border-green-300 has-[:checked]:bg-green-50 has-[:checked]:text-green-800 [&>input]:accent-green-600 [&>input]:mt-0" />
        </div>
        <details className="mt-2 text-sm" open={!!workflow?.description}>
          <summary className="cursor-pointer select-none text-xs text-stone-500 hover:text-stone-800">{workflow?.description ? "Description" : "Add a description (for your team)"}</summary>
          <Textarea name="description" rows={4} defaultValue={workflow?.description ?? ""} className="mt-2" placeholder="What this is for. Clients never see it." />
        </details>
      </Section>

      <Section n={2} title="Starts when">
        <div className="flex items-start gap-3 rounded-xl border border-stone-200 bg-stone-50 p-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-700" aria-hidden><Zap className="h-4 w-4" /></span>
          <div className="min-w-0 text-sm">
            <p className="font-medium">{meta.label}</p>
            <p className="text-xs text-stone-500">{meta.description}</p>
          </div>
        </div>
        {trigger === "no_visit" ? (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span>after</span>
            <Input name="days" type="number" min={7} max={730} defaultValue={f.days ?? 60} className="h-9 w-24" required aria-label="Days since the last visit" />
            <span>days without a visit and nothing booked</span>
          </div>
        ) : null}
      </Section>

      <Section n={3} title="Only when" aside={hasConditions ? undefined : "optional · currently everyone"}>
        <details className="group rounded-xl border border-stone-200" open={chips.length > 0}>
          <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-3 py-2.5 text-sm">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              {chips.length ? chips.map((c) => <span key={c} className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">{c}</span>) : <span className="text-stone-500">No conditions: every matching event starts this workflow.</span>}
            </span>
            <span className="flex shrink-0 items-center gap-1 text-xs text-stone-500">{chips.length ? "Edit" : "Add conditions"}<ChevronDown className="h-4 w-4 transition group-open:rotate-180" /></span>
          </summary>
          <div className="space-y-3 border-t border-stone-100 p-3">
            {showPickers ? (
              <div className="grid gap-2 lg:grid-cols-2">
                <Picker name="categoryIds" label="Service category" groups={catGroups} selected={f.categoryIds} />
                <Picker name="serviceIds" label="Specific services" groups={flatGroups(pickers.services)} selected={f.serviceIds} />
                <Picker name="staffIds" label="Provider" groups={flatGroups(pickers.staff)} selected={f.staffIds} />
                {pickers.locations.length > 1 ? <Picker name="locationIds" label="Location" groups={flatGroups(pickers.locations)} selected={f.locationIds} /> : null}
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              {trigger === "review_submitted" ? (
                <div>
                  <p className="mb-1 text-sm font-medium text-stone-700">Rating</p>
                  <div className="flex items-center gap-2 text-sm text-stone-600">
                    <span>from</span>
                    <Select name="minRating" defaultValue={f.minRating ?? ""} className="h-9 w-24" aria-label="Lowest rating"><option value="">any</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} ★</option>)}</Select>
                    <span>to</span>
                    <Select name="maxRating" defaultValue={f.maxRating ?? ""} className="h-9 w-24" aria-label="Highest rating"><option value="">any</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} ★</option>)}</Select>
                  </div>
                </div>
              ) : null}
              <Field label="Client has a tag" name="tags" hint="Comma-separated; any match counts."><Input name="tags" defaultValue={(f.tags ?? []).join(", ")} placeholder="VIP, Colour client" className="h-9" /></Field>
              {apptTrigger || trigger === "client_created" ? <Checkbox name="firstVisitOnly" defaultChecked={f.firstVisitOnly ?? false} label="First visit only" /> : null}
              {apptTrigger ? <Checkbox name="onlineOnly" defaultChecked={f.onlineOnly ?? false} label="Booked online only" hint="Skips appointments the desk enters or imports." /> : null}
            </div>
          </div>
        </details>
      </Section>

      <Section n={4} title="Then, in order" aside="click a step to edit it">
        <StepsEditor initial={workflow?.steps ?? []} trigger={trigger} />
      </Section>

      <Section n={5} title="Options">
        <Checkbox name="exitOnBooking" defaultChecked={workflow?.exitOnBooking ?? false} label="Stop if the client books again" hint="Remaining steps are dropped as soon as a new appointment is on the calendar. For rebook and we-miss-you flows." />
        <details className="mt-3 text-xs text-stone-500">
          <summary className="cursor-pointer select-none hover:text-stone-800">What is always applied</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li>Each client goes through a workflow once per occasion.</li>
            <li>Texts need text consent and carry “Reply STOP to opt out”; emails need email consent and carry an unsubscribe link.</li>
            <li>Messages from the Visit completed, New client, Birthday and No-visit triggers wait until 9am–8pm in your time zone.</li>
            <li>Runs move with a rescheduled appointment and stop when it is cancelled.</li>
          </ul>
        </details>
      </Section>

      <div className="sticky bottom-0 -mx-5 -mb-5 flex items-center justify-between gap-3 border-t border-stone-200 bg-white/95 px-5 py-3 backdrop-blur">
        <p className="text-xs text-stone-500">{workflow ? "Changes apply to new runs; runs already in progress keep their current steps." : "You can turn it on now or after a look at the steps."}</p>
        <SubmitButton pendingText="Saving…">{workflow ? "Save workflow" : "Create workflow"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
