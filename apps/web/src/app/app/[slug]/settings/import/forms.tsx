"use client";
import { useActionState } from "react";
import { commitImport, uploadImport, type UploadState } from "./actions";
import { Button, Field, Notice, Select } from "@/components/ui";
import type { FieldSpec } from "@/lib/import/mapping";

export function UploadForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadImport, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <Field label="What are you importing?">
        <Select name="kind" defaultValue="clients">
          <option value="clients">Clients (customer list)</option>
          <option value="services">Services (menu)</option>
          <option value="appointments">Appointments (upcoming or history)</option>
        </Select>
      </Field>
      <Field label="File" hint="CSV or Excel export from Vagaro. Title rows above the header are fine.">
        <input type="file" name="file" accept=".csv,.xlsx,.xls,text/csv" required className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:text-sm" />
      </Field>
      {state?.error ? <Notice>{state.error}</Notice> : null}
      <Button type="submit" disabled={pending}>{pending ? "Reading file…" : "Upload and preview"}</Button>
    </form>
  );
}

export function MappingForm({ slug, staged, headers, fields, mapping, rowCount }: { slug: string; staged: string; headers: string[]; fields: FieldSpec[]; mapping: Record<string, string>; rowCount: number }) {
  const [state, action, pending] = useActionState<UploadState, FormData>(commitImport, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="staged" value={staged} />
      <div className="grid gap-2 sm:grid-cols-2">
        {fields.map((f) => (
          <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`}>
            <Select name={`map_${f.key}`} defaultValue={mapping[f.key] ?? ""}>
              <option value="">— not in file —</option>
              {headers.map((h) => <option key={h} value={h}>{h}</option>)}
            </Select>
          </Field>
        ))}
      </div>
      {state?.error ? <Notice>{state.error}</Notice> : null}
      <Button type="submit" disabled={pending}>{pending ? "Importing…" : `Import ${rowCount} rows`}</Button>
    </form>
  );
}
