"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Bell, BellRing, ChevronDown, Clock, Coins, Mail, MessageSquare, Plus, Star, Tag, Trash2 } from "lucide-react";
import type { WorkflowStep, WorkflowTrigger } from "@angelic/db";
import { Input, Select, Textarea } from "@/components/ui";
import { Field } from "@/components/form";
import { APPOINTMENT_TRIGGERS, consentLine, newStepId, placeholdersFor, STEP_LABELS } from "@/lib/workflows-logic";
import { cn } from "@/lib/utils";

type StepType = WorkflowStep["type"];

const ICON: Record<StepType, typeof Clock> = { wait: Clock, sms: MessageSquare, email: Mail, review_request: Star, reminder: BellRing, tag: Tag, points: Coins, notify_staff: Bell };
const TONE: Record<StepType, string> = { wait: "bg-stone-100 text-stone-600", sms: "bg-sky-50 text-sky-700", email: "bg-violet-50 text-violet-700", review_request: "bg-amber-50 text-amber-700", reminder: "bg-brand-50 text-brand-700", tag: "bg-emerald-50 text-emerald-700", points: "bg-emerald-50 text-emerald-700", notify_staff: "bg-rose-50 text-rose-700" };

function blank(type: StepType): WorkflowStep {
  const id = newStepId();
  switch (type) {
    case "wait": return { id, type, mode: "delay", hours: 24 };
    case "sms": return { id, type, body: "" };
    case "email": return { id, type, subject: "", body: "", ctaLabel: null };
    case "review_request": return { id, type };
    case "reminder": return { id, type };
    case "tag": return { id, type, tag: "" };
    case "points": return { id, type, points: 100, note: null };
    case "notify_staff": return { id, type, to: "owner", body: "" };
  }
}

/** One-line description of a step for the collapsed header. */
function headline(s: WorkflowStep): string {
  const hours = (h: number) => (h >= 24 && h % 24 === 0 ? `${h / 24} day${h === 24 ? "" : "s"}` : `${h} h`);
  switch (s.type) {
    case "wait": return s.mode === "delay" ? `Wait ${hours(s.hours)}` : s.mode === "before_appointment" ? `${hours(s.hours)} before the appointment` : `${hours(s.hours)} after the appointment ends`;
    case "sms": return s.body.trim() ? s.body.trim().slice(0, 70) + (s.body.length > 70 ? "…" : "") : "Text message (empty)";
    case "email": return s.subject.trim() || "Email (no subject yet)";
    case "review_request": return "One-tap star rating, once per visit";
    case "reminder": return "Details, manage link, forms and prep notes, by email and text";
    case "tag": return s.tag.trim() ? `Tag “${s.tag.trim()}”` : "Add a tag (empty)";
    case "points": return `Give ${s.points} points`;
    case "notify_staff": return s.to === "owner" ? "Email the business address" : "Email the provider of the visit";
  }
}

/**
 * Ordered steps for a workflow, shown as a timeline. One step is open for editing at a time;
 * the rest collapse to a single line. Posts the list as JSON in a hidden `steps` field.
 */
export function StepsEditor({ initial, trigger }: { initial: WorkflowStep[]; trigger: WorkflowTrigger }) {
  const [steps, setSteps] = useState<WorkflowStep[]>(initial);
  const [open, setOpen] = useState<string | null>(initial.length === 1 ? initial[0]!.id : null);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // The add-step menu closes on Escape or a click anywhere else.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    const onDoc = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDoc); };
  }, [menu]);
  const hasAppt = APPOINTMENT_TRIGGERS.includes(trigger);
  const update = (i: number, patch: Partial<WorkflowStep>) => setSteps((s) => s.map((x, j) => (j === i ? ({ ...x, ...patch } as WorkflowStep) : x)));
  const move = (i: number, dir: -1 | 1) => setSteps((s) => { const j = i + dir; if (j < 0 || j >= s.length) return s; const c = [...s]; [c[i], c[j]] = [c[j]!, c[i]!]; return c; });
  const remove = (i: number) => setSteps((s) => s.filter((_, j) => j !== i));
  const add = (type: StepType) => { const s = blank(type); setSteps((list) => [...list, s]); setOpen(s.id); setMenu(false); };
  const placeholders = placeholdersFor(trigger);
  const addable: StepType[] = ["wait", "sms", "email", ...(trigger === "appointment_completed" ? (["review_request"] as StepType[]) : []), ...(trigger === "appointment_booked" ? (["reminder"] as StepType[]) : []), "tag", "points", "notify_staff"];
  const Placeholders = () => (
    <details className="text-xs text-stone-500">
      <summary className="cursor-pointer select-none hover:text-stone-800">Placeholders you can use</summary>
      <p className="mt-1 font-mono text-[11px] leading-5">{placeholders.join("  ")}</p>
    </details>
  );
  return (
    <div>
      <input type="hidden" name="steps" value={JSON.stringify(steps)} />
      {steps.length === 0 ? <p className="mb-3 rounded-xl border border-dashed border-stone-300 p-5 text-center text-sm text-stone-500">No steps yet. Add a wait, a message or an action.</p> : null}
      <ol className="relative space-y-2 border-l-2 border-stone-200 pl-6">
        {steps.map((s, i) => {
          const I = ICON[s.type];
          const isOpen = open === s.id;
          return (
            <li key={s.id} className="relative">
              <span className={cn("absolute -left-[31px] top-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white shadow-sm", TONE[s.type])} aria-hidden><I className="h-4 w-4" /></span>
              <div className={cn("rounded-xl border bg-white transition", isOpen ? "border-brand-300 shadow-sm" : "border-stone-200 hover:border-stone-300")}>
                <div className="flex items-center gap-2 px-3 py-2">
                  <button type="button" onClick={() => setOpen(isOpen ? null : s.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={isOpen}>
                    <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-stone-400">{STEP_LABELS[s.type]}</span>
                    <span className="truncate text-sm text-stone-800">{headline(s)}</span>
                  </button>
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="rounded p-1 text-stone-400 hover:text-stone-800 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label="Move down" className="rounded p-1 text-stone-400 hover:text-stone-800 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                  <button type="button" onClick={() => remove(i)} aria-label="Remove step" className="rounded p-1 text-stone-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                  <button type="button" onClick={() => setOpen(isOpen ? null : s.id)} aria-label={isOpen ? "Collapse" : "Edit"} className="rounded p-1 text-stone-400 hover:text-stone-800"><ChevronDown className={cn("h-4 w-4 transition", isOpen && "rotate-180")} /></button>
                </div>
                {isOpen ? (
                  <div className="space-y-2 border-t border-stone-100 px-3 py-3">
                    {s.type === "wait" ? (
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Input type="number" min={0} max={8760} value={s.hours} onChange={(e) => update(i, { hours: Number(e.target.value) })} className="h-9 w-24" aria-label="Hours" />
                        <span>hours</span>
                        {hasAppt ? (
                          <Select value={s.mode} onChange={(e) => update(i, { mode: e.target.value as "delay" })} className="h-9 w-auto" aria-label="Counted from">
                            <option value="delay">after the previous step</option>
                            {trigger === "appointment_booked" ? <option value="before_appointment">before the appointment</option> : null}
                            <option value="after_appointment">after the appointment ends</option>
                          </Select>
                        ) : <span>after the previous step</span>}
                        {s.hours >= 24 ? <span className="text-xs text-stone-500">= {(s.hours / 24).toFixed(s.hours % 24 ? 1 : 0)} days</span> : null}
                      </div>
                    ) : null}
                    {s.type === "sms" ? (
                      <>
                        <Textarea rows={5} value={s.body} onChange={(e) => update(i, { body: e.target.value })} placeholder="Your message. Your business name is added at the start." maxLength={1000} />
                        <div className="flex items-center justify-between gap-3"><Placeholders /><span className="text-[11px] text-stone-400">{s.body.length}/1000</span></div>
                        <p className="text-xs text-stone-500">{consentLine(s, trigger, steps, i)}</p>
                      </>
                    ) : null}
                    {s.type === "email" ? (
                      <>
                        <Field label="Subject"><Input value={s.subject} onChange={(e) => update(i, { subject: e.target.value })} maxLength={150} /></Field>
                        <Field label="Message" hint="Blank lines make paragraphs; your logo and colors are added."><Textarea rows={5} value={s.body} onChange={(e) => update(i, { body: e.target.value })} /></Field>
                        <Field label="Button label (optional)" className="max-w-xs"><Input value={s.ctaLabel ?? ""} onChange={(e) => update(i, { ctaLabel: e.target.value || null })} maxLength={40} /></Field>
                        <Placeholders />
                        <p className="text-xs text-stone-500">{consentLine(s, trigger, steps, i)}</p>
                      </>
                    ) : null}
                    {s.type === "reminder" ? <p className="text-sm text-stone-600">The standard reminder: appointment details, manage link, outstanding forms and the “before your visit” notes of the services booked, by email and text to clients who allow each. Wording lives under Settings → Messages; prep notes on each service or category.</p> : null}
                    {s.type === "review_request" ? <p className="text-sm text-stone-600">Email when the client has one, otherwise a text. Wording lives under Settings → Messages; the Google link under Settings → Review requests.</p> : null}
                    {s.type === "tag" ? <Input value={s.tag} onChange={(e) => update(i, { tag: e.target.value })} placeholder="Tag, e.g. Color client" maxLength={40} className="max-w-xs" aria-label="Tag" /> : null}
                    {s.type === "points" ? (
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Input type="number" min={1} max={100000} value={s.points} onChange={(e) => update(i, { points: Number(e.target.value) })} className="h-9 w-28" aria-label="Points" />
                        <span>points</span>
                        <Input value={s.note ?? ""} onChange={(e) => update(i, { note: e.target.value || null })} placeholder="Note on the client's points history (optional)" maxLength={120} className="h-9 max-w-xs" aria-label="Note" />
                      </div>
                    ) : null}
                    {s.type === "notify_staff" ? (
                      <>
                        {hasAppt ? (
                          <Select value={s.to} onChange={(e) => update(i, { to: e.target.value as "owner" })} className="h-9 max-w-xs" aria-label="Who">
                            <option value="owner">Email the business address</option>
                            <option value="provider">Email the provider of the visit</option>
                          </Select>
                        ) : null}
                        <Textarea rows={5} value={s.body} onChange={(e) => update(i, { body: e.target.value })} placeholder="What the team should know" />
                        <Placeholders />
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
        <li className="relative">
          <span className="absolute -left-[31px] top-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-stone-900 text-white shadow-sm" aria-hidden><Plus className="h-4 w-4" /></span>
          <div className="relative inline-block" ref={menuRef}>
            <button type="button" onClick={() => setMenu((m) => !m)} className="inline-flex h-10 items-center gap-1 rounded-lg border border-stone-300 bg-white px-3 text-sm font-medium hover:bg-stone-50" aria-expanded={menu} aria-haspopup="menu">Add a step <ChevronDown className="h-4 w-4 text-stone-400" /></button>
            {menu ? (
              <ul role="menu" className="absolute left-0 z-20 mt-1 w-60 overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-lg">
                {addable.map((t) => { const I = ICON[t]; return (
                  <li key={t} role="none"><button type="button" role="menuitem" onClick={() => add(t)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-stone-50"><span className={cn("flex h-6 w-6 items-center justify-center rounded-full", TONE[t])}><I className="h-3.5 w-3.5" /></span>{STEP_LABELS[t]}</button></li>
                ); })}
              </ul>
            ) : null}
          </div>
        </li>
      </ol>
    </div>
  );
}
