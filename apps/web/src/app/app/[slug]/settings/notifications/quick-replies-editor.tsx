"use client";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Input, Textarea } from "@/components/ui";
import { Field } from "@/components/form";
import { MAX_QUICK_REPLIES, type QuickReply } from "@/lib/notify/quick-replies";

/** Rows of title + wording inside the settings form; "Add one" appends a blank row, × removes a row. Posts qr_title_N / qr_body_N. */
export function QuickRepliesEditor({ initial }: { initial: QuickReply[] }) {
  const [rows, setRows] = useState<(QuickReply & { k: number })[]>(initial.map((r, k) => ({ ...r, k })));
  const [seq, setSeq] = useState(initial.length);
  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <div key={r.k} className="rounded-lg border border-stone-200 p-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 space-y-2">
              <Field label="Button" name={`qr_title_${i}`}><Input name={`qr_title_${i}`} defaultValue={r.title} placeholder="Running late" maxLength={40} /></Field>
              <Field label="Text" name={`qr_body_${i}`}><Textarea name={`qr_body_${i}`} rows={2} defaultValue={r.body} placeholder="No problem {first_name}, see you soon!" maxLength={500} /></Field>
            </div>
            <button type="button" onClick={() => setRows((cur) => cur.filter((x) => x.k !== r.k))} aria-label={`Remove ${r.title || "this reply"}`} className="mt-6 rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"><X className="h-4 w-4" /></button>
          </div>
        </div>
      ))}
      {rows.length < MAX_QUICK_REPLIES ? (
        <button type="button" onClick={() => { setRows((cur) => [...cur, { title: "", body: "", k: seq }]); setSeq((n) => n + 1); }} className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"><Plus className="h-4 w-4" /> Add one</button>
      ) : null}
      {rows.length === 0 ? <p className="text-xs text-stone-500">No quick replies: saving brings the starter set back.</p> : null}
    </div>
  );
}
