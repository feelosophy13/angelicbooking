"use client";
import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import type { ChartAnswer, ChartAnswers, ChartFieldDef, ChartMark } from "@angelic/core";
import { Checkbox, Input, Radio, RadioGroup, Select, Textarea } from "@/components/ui";
import { useFormState } from "@/components/form";
import { ChartDiagramField } from "@/components/chart-diagram";
import { cn } from "@/lib/utils";

export type ChartPhoto = { id: string; thumbUrl: string; phase: string };

/**
 * The questions of a chart, for filling in on a tablet: big targets, choices as buttons where there are few, the diagram to tap, and the
 * visit's own photos to tick. Posts `a_<fieldId>` per answer (see chartAnswersFromForm in @angelic/core). Used inside an ActionForm.
 */
export function ChartFill({ fields, answers: initial, photos, photosHref }: { fields: ChartFieldDef[]; answers: ChartAnswers; photos: ChartPhoto[]; photosHref: string | null }) {
  const state = useFormState();
  // Controlled throughout: React resets uncontrolled fields after a form action, and a failed save must never wipe a chart.
  const [answers, setAnswers] = useState<ChartAnswers>(initial);
  const set = (id: string, v: ChartAnswer | undefined) => setAnswers((a) => { const next = { ...a }; if (v === undefined) delete next[id]; else next[id] = v; return next; });
  const errorFor = (id: string) => state?.fieldErrors?.[id] ?? null;
  return (
    <div className="space-y-5">
      {fields.some((f) => f.required) ? <p className="text-xs text-stone-500">Fields marked <span className="text-red-600">*</span> are needed before you sign. A draft can be saved with gaps.</p> : null}
      {fields.map((f) => <Question key={f.id} field={f} value={answers[f.id]} set={(v) => set(f.id, v)} photos={photos} photosHref={photosHref} error={errorFor(f.id)} />)}
    </div>
  );
}

function Question({ field: f, value, set, photos, photosHref, error }: { field: ChartFieldDef; value: ChartAnswer | undefined; set: (v: ChartAnswer | undefined) => void; photos: ChartPhoto[]; photosHref: string | null; error: string | null }) {
  const name = `a_${f.id}`;
  const str = typeof value === "string" ? value : "";
  const list = Array.isArray(value) ? (value as string[]) : [];
  const toggle = (o: string, on: boolean) => set(on ? [...list.filter((x) => x !== o), o] : list.filter((x) => x !== o));
  const text = (e: { target: { value: string } }) => set(e.target.value);
  if (f.type === "heading") return <h3 className="border-b border-stone-200 pb-1 pt-3 text-base font-semibold text-stone-900">{f.label}</h3>;
  if (f.type === "statement") return <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">{f.label}</p>;
  const label = (
    <span className="mb-1 block text-sm font-medium text-stone-700">
      {f.label}{f.required ? <span className="text-red-600"> *</span> : null}
      {f.hint ? <span className="block text-xs font-normal text-stone-500">{f.hint}</span> : null}
    </span>
  );
  const err = error ? <p className="mt-1 text-xs text-red-600" role="alert">{error}</p> : null;
  const box = cn(error && "[&_input]:border-red-400 [&_select]:border-red-400 [&_textarea]:border-red-400");
  if (f.type === "yesno" || (f.type === "select" && (f.options ?? []).length <= 4)) {
    const opts = f.type === "yesno" ? ["Yes", "No"] : f.options ?? [];
    return (
      <div data-q={f.id} data-field-error={error ? "" : undefined} className={box}>
        <RadioGroup legend={label} inline>
          {opts.map((o) => <Radio key={o} name={name} value={o} checked={str === o} onChange={() => set(o)} label={o} />)}
        </RadioGroup>
        {err}
      </div>
    );
  }
  if (f.type === "multiselect") {
    return (
      <fieldset data-q={f.id} data-field-error={error ? "" : undefined}>
        <legend>{label}</legend>
        <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
          {(f.options ?? []).map((o) => <Checkbox key={o} name={name} value={o} checked={list.includes(o)} onChange={(e) => toggle(o, e.target.checked)} label={o} />)}
        </div>
        {err}
      </fieldset>
    );
  }
  if (f.type === "diagram") {
    return (
      <div data-q={f.id} data-field-error={error ? "" : undefined}>
        {label}
        <ChartDiagramField kind={f.diagram ?? "face"} name={name} marks={Array.isArray(value) ? (value as ChartMark[]) : []} onChange={(m) => set(m.length ? m : undefined)} />
        {err}
      </div>
    );
  }
  if (f.type === "photo") {
    return (
      <fieldset data-q={f.id} data-field-error={error ? "" : undefined}>
        <legend>{label}</legend>
        {photos.length ? (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {photos.map((p) => (
              <li key={p.id}>
                <label className="group relative block cursor-pointer overflow-hidden rounded-lg border border-stone-200 has-[:checked]:border-brand-500 has-[:checked]:ring-2 has-[:checked]:ring-brand-200">
                  <input type="checkbox" name={name} value={p.id} checked={list.includes(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} className="peer sr-only" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumbUrl} alt={`${p.phase} photo`} width={160} height={160} loading="lazy" className="aspect-square w-full object-cover" />
                  <span className="absolute left-1 top-1 rounded bg-white/90 px-1 text-[11px] capitalize text-stone-700">{p.phase}</span>
                  <span className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white peer-checked:flex"><Check className="h-3.5 w-3.5" /></span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-stone-500">No photos on this visit yet.{photosHref ? <> Add them under <Link href={photosHref} className="underline">Photos on the appointment</Link>, then come back.</> : " Charts made from a visit can include its photos."}</p>
        )}
        {err}
      </fieldset>
    );
  }
  return (
    <label data-q={f.id} data-field-error={error ? "" : undefined} className={cn("block", box)}>
      {label}
      {f.type === "textarea" ? (
        <Textarea name={name} rows={3} value={str} onChange={text} aria-label={f.label} />
      ) : f.type === "select" ? (
        <Select name={name} value={str} onChange={text} aria-label={f.label}>
          <option value="">Choose…</option>
          {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      ) : (
        <Input name={name} aria-label={f.label} type={f.type === "date" ? "date" : "text"} inputMode={f.type === "number" ? "decimal" : undefined} value={str} onChange={text} className={f.type === "number" || f.type === "date" ? "max-w-48" : undefined} />
      )}
      {err}
    </label>
  );
}
