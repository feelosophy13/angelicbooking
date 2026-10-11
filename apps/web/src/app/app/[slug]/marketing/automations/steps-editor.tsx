"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { WorkflowStep, WorkflowTrigger } from "@angelic/db";
import { Input, Select, Textarea } from "@/components/ui";
import { APPOINTMENT_TRIGGERS, newStepId, placeholdersFor, STEP_LABELS } from "@/lib/workflows-logic";

type StepType = WorkflowStep["type"];

function blank(type: StepType): WorkflowStep {
  const id = newStepId();
  switch (type) {
    case "wait": return { id, type, mode: "delay", hours: 24 };
    case "sms": return { id, type, body: "" };
    case "email": return { id, type, subject: "", body: "", ctaLabel: null };
    case "review_request": return { id, type };
    case "tag": return { id, type, tag: "" };
    case "points": return { id, type, points: 100, note: null };
    case "notify_staff": return { id, type, to: "owner", body: "" };
  }
}

/**
 * Ordered steps for a workflow. Keeps state locally and posts the list as JSON in a
 * hidden `steps` field; the server validates it against the trigger.
 */
export function StepsEditor({ initial, trigger }: { initial: WorkflowStep[]; trigger: WorkflowTrigger }) {
  const [steps, setSteps] = useState<WorkflowStep[]>(initial);
  const hasAppt = APPOINTMENT_TRIGGERS.includes(trigger);
  const update = (i: number, patch: Partial<WorkflowStep>) => setSteps((s) => s.map((x, j) => (j === i ? ({ ...x, ...patch } as WorkflowStep) : x)));
  const move = (i: number, dir: -1 | 1) => setSteps((s) => { const j = i + dir; if (j < 0 || j >= s.length) return s; const c = [...s]; [c[i], c[j]] = [c[j]!, c[i]!]; return c; });
  const remove = (i: number) => setSteps((s) => s.filter((_, j) => j !== i));
  const add = (type: StepType) => setSteps((s) => [...s, blank(type)]);
  const placeholders = placeholdersFor(trigger);
  const addable: StepType[] = ["wait", "sms", "email", ...(trigger === "appointment_completed" ? (["review_request"] as StepType[]) : []), "tag", "points", "notify_staff"];
  return (
    <div className="space-y-3">
      <input type="hidden" name="steps" value={JSON.stringify(steps)} />
      {steps.length === 0 ? <p className="rounded-lg border border-dashed border-stone-300 p-4 text-center text-sm text-stone-500">No steps yet. Add a wait, a message or an action below.</p> : null}
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.id} className="rounded-xl border border-stone-200 bg-white p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-stone-900 text-xs font-semibold text-white">{i + 1}</span>
              <span className="text-sm font-medium">{STEP_LABELS[s.type]}</span>
              <span className="flex-1" />
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="rounded p-1 text-stone-400 hover:text-stone-800 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label="Move down" className="rounded p-1 text-stone-400 hover:text-stone-800 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
              <button type="button" onClick={() => remove(i)} aria-label="Remove step" className="rounded p-1 text-stone-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
            </div>
            {s.type === "wait" ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Input type="number" min={0} max={8760} value={s.hours} onChange={(e) => update(i, { hours: Number(e.target.value) })} className="h-9 w-24" aria-label="Hours" />
                <span>hours</span>
                <Select value={s.mode} onChange={(e) => update(i, { mode: e.target.value as "delay" })} className="h-9 w-auto" aria-label="Counted from">
                  <option value="delay">after the previous step</option>
                  {hasAppt && trigger === "appointment_booked" ? <option value="before_appointment">before the appointment</option> : null}
                  {hasAppt ? <option value="after_appointment">after the appointment ends</option> : null}
                </Select>
                <span className="text-xs text-stone-500">{s.hours >= 24 ? `(${(s.hours / 24).toFixed(s.hours % 24 ? 1 : 0)} days)` : ""}</span>
              </div>
            ) : null}
            {s.type === "sms" ? (
              <div>
                <Textarea rows={3} value={s.body} onChange={(e) => update(i, { body: e.target.value })} placeholder="{business}: …" maxLength={1000} />
                <p className="mt-1 text-xs text-stone-500">Starts with your business name automatically. Marketing texts end with “Reply STOP to opt out”. {s.body.length}/1000.</p>
              </div>
            ) : null}
            {s.type === "email" ? (
              <div className="space-y-2">
                <Input value={s.subject} onChange={(e) => update(i, { subject: e.target.value })} placeholder="Subject" maxLength={150} aria-label="Subject" />
                <Textarea rows={5} value={s.body} onChange={(e) => update(i, { body: e.target.value })} placeholder="Message (blank lines make paragraphs)" />
                <Input value={s.ctaLabel ?? ""} onChange={(e) => update(i, { ctaLabel: e.target.value || null })} placeholder="Button label (default: Book now, or Manage appointment)" maxLength={40} aria-label="Button label" className="max-w-sm" />
                <p className="text-xs text-stone-500">Sent with your logo and colours and an unsubscribe link.</p>
              </div>
            ) : null}
            {s.type === "review_request" ? <p className="text-sm text-stone-600">Sends the one-tap star rating (email when the client has one, otherwise a text), once per visit. Wording: Settings → Messages. Google link: Settings → Review requests.</p> : null}
            {s.type === "tag" ? <Input value={s.tag} onChange={(e) => update(i, { tag: e.target.value })} placeholder="Tag, e.g. Colour client" maxLength={40} className="max-w-xs" aria-label="Tag" /> : null}
            {s.type === "points" ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Input type="number" min={1} max={100000} value={s.points} onChange={(e) => update(i, { points: Number(e.target.value) })} className="h-9 w-28" aria-label="Points" />
                <span>points</span>
                <Input value={s.note ?? ""} onChange={(e) => update(i, { note: e.target.value || null })} placeholder="Shown on the client's points history" maxLength={120} className="h-9 max-w-xs" aria-label="Note" />
              </div>
            ) : null}
            {s.type === "notify_staff" ? (
              <div className="space-y-2">
                <Select value={s.to} onChange={(e) => update(i, { to: e.target.value as "owner" })} className="h-9 max-w-xs" aria-label="Who">
                  <option value="owner">Email the business address</option>
                  {hasAppt ? <option value="provider">Email the provider of the visit</option> : null}
                </Select>
                <Textarea rows={3} value={s.body} onChange={(e) => update(i, { body: e.target.value })} placeholder="What the team should know" />
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-stone-500">Add step</span>
        {addable.map((t) => (
          <button key={t} type="button" onClick={() => add(t)} className="inline-flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-xs hover:bg-stone-50"><Plus className="h-3 w-3" /> {STEP_LABELS[t]}</button>
        ))}
      </div>
      <p className="text-xs text-stone-500">Placeholders for messages: {placeholders.join(" ")}</p>
    </div>
  );
}
