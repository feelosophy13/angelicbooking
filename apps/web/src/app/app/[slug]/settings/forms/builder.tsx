"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Eye, Plus, Trash2 } from "lucide-react";
import type { FormFieldDef } from "@angelic/db";
import { Input, Select, Textarea, Checkbox } from "@/components/ui";
import { DISPLAY_TYPES, DRIVER_TYPES, FIELD_TYPES, mapTargetsFor } from "@/lib/forms-logic";
import { FormFill } from "@/components/form-fill";
import { CHART_DIAGRAMS } from "@angelic/core";

/** A row in the builder: a form question, or a chart field (which adds types such as the diagram, and picks which diagram). */
type BuilderField = Omit<FormFieldDef, "type"> & { type: string; diagram?: string; hint?: string };

const newId = () => `f_${Math.random().toString(36).slice(2, 8)}`;

/**
 * Editable list of questions; posts as f{i}_label / f{i}_type / f{i}_required /
 * f{i}_options / f{i}_id / f{i}_showif_field / f{i}_showif_value / f{i}_mapto / f{i}_tag.
 * Questions can be reordered, shown only when an earlier answer matches, and copied onto
 * the client record. "Preview" shows the form as the client will see it.
 */
export function FieldBuilder({ initial, description, requireSignature, types = FIELD_TYPES, chart = false, preview: renderPreview }: {
  initial: BuilderField[];
  description?: string | null;
  requireSignature?: boolean;
  /** The types on offer (forms by default). */
  types?: readonly { type: string; label: string }[];
  /** Chart templates: no "show only when" and nothing copied to the client record; required means "needed to sign"; diagrams choose a picture. */
  chart?: boolean;
  /** How the preview draws the rows (forms: the client's view). */
  preview?: (rows: BuilderField[]) => React.ReactNode;
}) {
  const [rows, setRows] = useState<BuilderField[]>(initial.length ? initial.map((r) => ({ ...r, id: r.id || newId() })) : [{ id: newId(), type: chart ? "textarea" : "text", label: "", required: true }]);
  const [preview, setPreview] = useState(false);
  const update = (i: number, patch: Partial<BuilderField>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const dependents = (id: string) => rows.filter((x) => x.showIf?.fieldId === id);
  const move = (i: number, dir: -1 | 1) =>
    setRows((r) => {
      const j = i + dir;
      if (j < 0 || j >= r.length) return r;
      const next = [...r];
      [next[i], next[j]] = [next[j]!, next[i]!];
      // A condition may only point at an earlier question; drop any that now point forward.
      const seen = new Set<string>();
      return next.map((x) => {
        const ok = !x.showIf || seen.has(x.showIf.fieldId);
        seen.add(x.id);
        return ok ? x : { ...x, showIf: null };
      });
    });
  const remove = (i: number) => {
    const deps = dependents(rows[i]!.id);
    if (deps.length && !window.confirm(`${deps.length} later question${deps.length === 1 ? "" : "s"} only show${deps.length === 1 ? "s" : ""} based on this one. Remove it anyway? They will always show.`)) return;
    setRows((x) => x.filter((_, k) => k !== i).map((y) => (y.showIf?.fieldId === rows[i]!.id ? { ...y, showIf: null } : y)));
  };
  const isDriver = (type: string) => DRIVER_TYPES.includes(type as FormFieldDef["type"]);
  const targetsOf = (type: string) => (chart ? [] : mapTargetsFor(type as FormFieldDef["type"]));
  const changeType = (i: number, type: string) => {
    const deps = dependents(rows[i]!.id);
    if (deps.length && !isDriver(type) && !window.confirm("Later questions depend on this answer. Change the type anyway?")) return;
    // Options are kept so switching Choose one ↔ Choose any loses nothing.
    update(i, { type, mapTo: targetsOf(type).some((t) => t.value === rows[i]!.mapTo) ? rows[i]!.mapTo : null, ...(type === "diagram" && !rows[i]!.diagram ? { diagram: "face" } : {}) });
    if (!isDriver(type)) setRows((r) => r.map((y) => (y.showIf?.fieldId === rows[i]!.id ? { ...y, showIf: null } : y)));
  };
  return (
    <div className="space-y-3">
      {rows.map((r, i) => {
        const drivers = chart ? [] : rows.slice(0, i).filter((d) => isDriver(d.type));
        const driver = drivers.find((d) => d.id === r.showIf?.fieldId) ?? null;
        const display = DISPLAY_TYPES.includes(r.type as FormFieldDef["type"]);
        const targets = targetsOf(r.type);
        return (
          <div key={r.id} className={`rounded-lg border border-stone-200 p-3 ${r.type === "heading" ? "bg-white" : "bg-stone-50"}`}>
            <input type="hidden" name={`f${i}_id`} value={r.id} />
            <div className="grid gap-2 sm:grid-cols-[1fr_12rem_auto]">
              {r.type === "statement" ? (
                <Textarea name={`f${i}_label`} rows={3} value={r.label} onChange={(e) => update(i, { label: e.target.value })} placeholder="I understand that…" />
              ) : (
                <Input name={`f${i}_label`} value={r.label} onChange={(e) => update(i, { label: e.target.value })} placeholder={r.type === "heading" ? "Section title" : r.type === "initials" ? "Initial here" : "Question"} className={r.type === "heading" ? "font-semibold" : ""} />
              )}
              <Select name={`f${i}_type`} value={r.type} onChange={(e) => changeType(i, e.target.value)}>
                {types.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </Select>
              <div className="flex gap-1">
                <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="hit rounded-lg border border-stone-300 bg-white px-2 text-stone-500 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                <button type="button" aria-label="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)} className="hit rounded-lg border border-stone-300 bg-white px-2 text-stone-500 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                <button type="button" aria-label="Remove question" onClick={() => remove(i)} className="hit rounded-lg border border-stone-300 bg-white px-2 text-stone-500 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
            {r.type === "select" || r.type === "multiselect" ? <Textarea name={`f${i}_options`} rows={4} className="mt-2" placeholder={"One option per line"} value={(r.options ?? []).join("\n")} onChange={(e) => update(i, { options: e.target.value.split("\n") })} /> : null}
            {r.hint ? <input type="hidden" name={`f${i}_hint`} value={r.hint} /> : null}
            {r.type === "diagram" ? (
              <Select name={`f${i}_diagram`} value={r.diagram ?? "face"} onChange={(e) => update(i, { diagram: e.target.value })} aria-label="Which picture" className="mt-2 sm:w-64">
                {CHART_DIAGRAMS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </Select>
            ) : null}
            {r.options?.length && r.type !== "select" && r.type !== "multiselect" ? <input type="hidden" name={`f${i}_options`} value={r.options.join("\n")} /> : null}
            {!display ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-stone-600">
                <Checkbox name={`f${i}_required`} checked={r.required ?? false} onChange={(e) => update(i, { required: e.target.checked })} label={chart ? "Needed to sign" : r.type === "checkbox" ? "Must be ticked" : "Required"} className="text-xs" />
                {drivers.length ? (
                  <span className="flex flex-wrap items-center gap-2">
                    Only show when
                    <select name={`f${i}_showif_field`} value={r.showIf?.fieldId ?? ""} onChange={(e) => update(i, { showIf: e.target.value ? { fieldId: e.target.value, equals: "" } : null })} className="h-10 rounded border border-stone-300 bg-white px-1 text-xs lg:pointer-fine:h-7">
                      <option value="">(always)</option>
                      {drivers.map((d) => <option key={d.id} value={d.id}>{d.label || "(untitled)"}</option>)}
                    </select>
                    {driver ? (
                      <select name={`f${i}_showif_value`} value={r.showIf?.equals ?? ""} onChange={(e) => update(i, { showIf: { fieldId: driver.id, equals: e.target.value } })} className="h-10 rounded border border-stone-300 bg-white px-1 text-xs lg:pointer-fine:h-7">
                        <option value="">is…</option>
                        {driver.type === "checkbox" ? (<><option value="true">is ticked</option><option value="false">is not ticked</option></>) : driver.type === "yesno" ? (<><option value="Yes">is Yes</option><option value="No">is No</option></>) : (driver.options ?? []).filter(Boolean).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : null}
                  </span>
                ) : null}
                {targets.length ? (
                  <span className="flex flex-wrap items-center gap-2">
                    Saves to
                    <select name={`f${i}_mapto`} value={r.mapTo ?? ""} onChange={(e) => update(i, { mapTo: (e.target.value || null) as BuilderField["mapTo"] })} className="h-10 rounded border border-stone-300 bg-white px-1 text-xs lg:pointer-fine:h-7">
                      <option value="">(nothing)</option>
                      {targets.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    {r.mapTo === "tag" ? <input name={`f${i}_tag`} value={r.tag ?? ""} onChange={(e) => update(i, { tag: e.target.value })} placeholder={r.label || "Tag name"} className="h-7 w-36 rounded border border-stone-300 bg-white px-1.5 text-xs" /> : null}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setRows((x) => [...x, { id: newId(), type: "text", label: "", required: false }])} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-stone-300 px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-50"><Plus className="h-4 w-4" /> {chart ? "Add field" : "Add question"}</button>
        <button type="button" onClick={() => setRows((x) => [...x, { id: newId(), type: "heading", label: "" }])} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-stone-300 px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-50"><Plus className="h-4 w-4" /> Add section</button>
        <button type="button" onClick={() => setPreview((p) => !p)} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50" aria-pressed={preview}><Eye className="h-4 w-4" /> {preview ? "Hide preview" : "Preview"}</button>
      </div>
      {preview ? (
        <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          {renderPreview ? renderPreview(rows.filter((r) => r.label.trim())) : (<>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-stone-400">How the client sees it</p>
          <FormFill action={async () => ({ error: "This is a preview; answers aren't saved." })} hidden={{}} form={{ id: "preview", name: "Preview", description: description ?? null, fields: rows.filter((r) => r.label.trim()) as FormFieldDef[], requireSignature: requireSignature ?? true }} clientName="Jane Doe" preview />
          </>)}
        </div>
      ) : null}
    </div>
  );
}
