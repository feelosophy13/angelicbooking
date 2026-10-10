"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { FormFieldDef } from "@angelic/db";
import { Input, Select, Textarea } from "@/components/ui";

const TYPES: { type: FormFieldDef["type"]; label: string }[] = [
  { type: "text", label: "Short answer" },
  { type: "textarea", label: "Paragraph" },
  { type: "checkbox", label: "Checkbox (must tick)" },
  { type: "select", label: "Choose one" },
  { type: "date", label: "Date" },
  { type: "statement", label: "Statement (no answer)" },
];

/** Editable list of questions; posts as f{i}_label / f{i}_type / f{i}_required / f{i}_options / f{i}_id. */
export function FieldBuilder({ initial }: { initial: FormFieldDef[] }) {
  const [rows, setRows] = useState<FormFieldDef[]>(initial.length ? initial : [{ id: "", type: "text", label: "", required: true }]);
  const update = (i: number, patch: Partial<FormFieldDef>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <div key={i} className="rounded-lg border border-stone-200 bg-stone-50 p-3">
          <input type="hidden" name={`f${i}_id`} value={r.id} />
          <div className="grid gap-2 sm:grid-cols-[1fr_11rem_auto]">
            <Input name={`f${i}_label`} value={r.label} onChange={(e) => update(i, { label: e.target.value })} placeholder={r.type === "statement" ? "I confirm that I have read the aftercare instructions…" : "Question"} />
            <Select name={`f${i}_type`} value={r.type} onChange={(e) => update(i, { type: e.target.value as FormFieldDef["type"] })}>
              {TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
            </Select>
            <button type="button" aria-label="Remove question" onClick={() => setRows((x) => x.filter((_, k) => k !== i))} className="rounded-lg border border-stone-300 bg-white px-2 text-stone-500 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
          </div>
          {r.type === "select" ? <Textarea name={`f${i}_options`} rows={3} className="mt-2" placeholder={"One option per line"} defaultValue={(r.options ?? []).join("\n")} /> : null}
          {r.type !== "statement" ? (
            <label className="mt-2 flex items-center gap-2 text-xs text-stone-600"><input type="checkbox" name={`f${i}_required`} checked={r.required ?? false} onChange={(e) => update(i, { required: e.target.checked })} className="h-4 w-4 accent-brand-600" /> Required</label>
          ) : null}
        </div>
      ))}
      <button type="button" onClick={() => setRows((x) => [...x, { id: "", type: "text", label: "", required: false }])} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-stone-300 px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-50"><Plus className="h-4 w-4" /> Add question</button>
    </div>
  );
}
