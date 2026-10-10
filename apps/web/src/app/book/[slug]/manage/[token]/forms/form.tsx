"use client";
import { useActionState } from "react";
import type { FormFieldDef } from "@angelic/db";
import { Input, Notice, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { submitPublicForm, type FormState } from "./actions";

export function PublicForm({ slug, token, form, clientName }: { slug: string; token: string; form: { id: string; name: string; description: string | null; fields: FormFieldDef[]; requireSignature: boolean }; clientName: string }) {
  const [state, action] = useActionState<FormState, FormData>(submitPublicForm, undefined);
  if (state?.ok) return <Notice kind="success">Thanks, {form.name} is complete.</Notice>;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="formId" value={form.id} />
      {form.description ? <p className="whitespace-pre-line text-sm text-stone-700">{form.description}</p> : null}
      {form.fields.map((f) => {
        const name = `a_${f.id}`;
        if (f.type === "statement") return <p key={f.id} className="text-sm text-stone-700">{f.label}</p>;
        if (f.type === "checkbox") {
          return (
            <label key={f.id} className="flex items-start gap-2 text-sm">
              <input type="checkbox" name={name} required={f.required} className="mt-0.5 h-4 w-4 accent-brand-600" /> <span>{f.label}{f.required ? " *" : ""}</span>
            </label>
          );
        }
        return (
          <label key={f.id} className="block text-sm">
            <span className="mb-1 block font-medium text-stone-700">{f.label}{f.required ? " *" : ""}</span>
            {f.type === "textarea" ? <Textarea name={name} rows={3} required={f.required} /> : f.type === "select" ? (
              <Select name={name} required={f.required} defaultValue="">
                <option value="" disabled>Choose…</option>
                {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </Select>
            ) : <Input name={name} type={f.type === "date" ? "date" : "text"} required={f.required} />}
          </label>
        );
      })}
      {form.requireSignature ? (
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-stone-700">Type your full name to sign *</span>
          <Input name="signatureName" placeholder={clientName} required className="font-serif italic" />
          <span className="mt-1 block text-xs text-stone-500">By typing your name you agree this is your electronic signature.</span>
        </label>
      ) : null}
      {state?.error ? <Notice>{state.error}</Notice> : null}
      <SubmitButton className="w-full" style={{ background: "var(--brand)" }} pendingText="Saving…">{form.requireSignature ? "Sign and submit" : "Submit"}</SubmitButton>
    </form>
  );
}
