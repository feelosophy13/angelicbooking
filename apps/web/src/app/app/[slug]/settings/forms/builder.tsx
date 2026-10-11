"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { FormFieldDef } from "@angelic/db";
import { Input, Select, Textarea, Checkbox } from "@/components/ui";

const TYPES: { type: FormFieldDef["type"]; label: string }[] = [
  { type: "text", label: "Short answer" },
  { type: "textarea", label: "Paragraph" },
  { type: "number", label: "Number" },
  { type: "checkbox", label: "Checkbox (must tick)" },
  { type: "select", label: "Choose one" },
  { type: "multiselect", label: "Choose any" },
  { type: "date", label: "Date" },
  { type: "file", label: "Photo or PDF upload" },
  { type: "statement", label: "Statement (no answer)" },
];

const newId = () => `f_${Math.random().toString(36).slice(2, 8)}`;

/**
 * Editable list of questions; posts as f{i}_label / f{i}_type / f{i}_required /
 * f{i}_options / f{i}_id / f{i}_showif_field / f{i}_showif_value. Questions can
 * be reordered and shown only when an earlier yes/no or choice answer matches.
 */
export function FieldBuilder({ initial }: { initial: FormFieldDef[] }) {
  const [rows, setRows] = useState<FormFieldDef[]>(initial.length ? initial.map((r) => ({ ...r, id: r.id || newId() })) : [{ id: newId(), type: "text", label: "", required: true }]);
  const update = (i: number, patch: Partial<FormFieldDef>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const move = (i: number, dir: -1 | 1) =>
    setRows((r) => {
      const j = i + dir;
      if (j < 0 || j >= r.length) return r;
      const next = [...r];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  return (
    <div className="space-y-3">
      {rows.map((r, i) => {
        // Only earlier yes/no or choice questions can drive a condition.
        const drivers = rows.slice(0, i).filter((d) => d.type === "checkbox" || d.type === "select" || d.type === "multiselect");
        const driver = drivers.find((d) => d.id === r.showIf?.fieldId) ?? null;
        return (
          <div key={r.id} className="rounded-lg border border-stone-200 bg-stone-50 p-3">
            <input type="hidden" name={`f${i}_id`} value={r.id} />
            <div className="grid gap-2 sm:grid-cols-[1fr_11rem_auto]">
              <Input name={`f${i}_label`} value={r.label} onChange={(e) => update(i, { label: e.target.value })} placeholder={r.type === "statement" ? "I confirm that I have read the aftercare instructions…" : "Question"} />
              <Select name={`f${i}_type`} value={r.type} onChange={(e) => update(i, { type: e.target.value as FormFieldDef["type"] })}>
                {TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </Select>
              <div className="flex gap-1">
                <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="rounded-lg border border-stone-300 bg-white px-2 text-stone-500 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                <button type="button" aria-label="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)} className="rounded-lg border border-stone-300 bg-white px-2 text-stone-500 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                <button type="button" aria-label="Remove question" onClick={() => setRows((x) => x.filter((_, k) => k !== i))} className="rounded-lg border border-stone-300 bg-white px-2 text-stone-500 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
            {r.type === "select" || r.type === "multiselect" ? <Textarea name={`f${i}_options`} rows={5} className="mt-2" placeholder={"One option per line"} defaultValue={(r.options ?? []).join("\n")} /> : null}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-stone-600">
              {r.type !== "statement" ? (
                <Checkbox name={`f${i}_required`} checked={r.required ?? false} onChange={(e) => update(i, { required: e.target.checked })} label="Required" className="text-xs" />
              ) : null}
              {drivers.length ? (
                <span className="flex flex-wrap items-center gap-2">
                  Only show when
                  <select name={`f${i}_showif_field`} value={r.showIf?.fieldId ?? ""} onChange={(e) => update(i, { showIf: e.target.value ? { fieldId: e.target.value, equals: "" } : null })} className="h-7 rounded border border-stone-300 bg-white px-1 text-xs">
                    <option value="">(always)</option>
                    {drivers.map((d) => <option key={d.id} value={d.id}>{d.label || "(untitled)"}</option>)}
                  </select>
                  {driver ? (
                    driver.type === "checkbox" ? (
                      <select name={`f${i}_showif_value`} value={r.showIf?.equals ?? ""} onChange={(e) => update(i, { showIf: { fieldId: driver.id, equals: e.target.value } })} className="h-7 rounded border border-stone-300 bg-white px-1 text-xs">
                        <option value="">…</option>
                        <option value="true">is ticked</option>
                        <option value="false">is not ticked</option>
                      </select>
                    ) : (
                      <select name={`f${i}_showif_value`} value={r.showIf?.equals ?? ""} onChange={(e) => update(i, { showIf: { fieldId: driver.id, equals: e.target.value } })} className="h-7 rounded border border-stone-300 bg-white px-1 text-xs">
                        <option value="">is…</option>
                        {(driver.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    )
                  ) : null}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
      <button type="button" onClick={() => setRows((x) => [...x, { id: newId(), type: "text", label: "", required: false }])} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-stone-300 px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-50"><Plus className="h-4 w-4" /> Add question</button>
    </div>
  );
}
