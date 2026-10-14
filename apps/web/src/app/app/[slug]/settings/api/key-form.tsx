"use client";
import { useActionState, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, Checkbox, Input, Notice, Select } from "@/components/ui";
import { Field, SubmitButton } from "@/components/form";
import { API_SCOPES } from "@/lib/api-scopes";
import { createApiKey } from "./actions";

/** Create a key. The secret is shown once, right here, then never again. */
export function ApiKeyForm({ slug }: { slug: string }) {
  const [state, act] = useActionState(createApiKey, undefined);
  const [copied, setCopied] = useState(false);
  const key = state?.ok ? state.values?.key : undefined;
  if (key) {
    return (
      <div className="space-y-3">
        <Notice kind="success">Key “{state?.values?.name}” created. Copy it now: it is shown only once and we cannot recover it.</Notice>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 select-all break-all rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs">{key}</code>
          <Button type="button" variant="secondary" onClick={() => { void navigator.clipboard.writeText(key).then(() => setCopied(true)); }}>
            {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}{copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="text-xs text-stone-500">Treat it like a password: keep it on your server, never in a web page or an app you ship.</p>
      </div>
    );
  }
  return (
    <form action={act} className="space-y-4" noValidate>
      {state?.error && !state.fieldErrors ? <Notice>{state.error}</Notice> : null}
      <input type="hidden" name="slug" value={slug} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" name="name" hint="So you can tell keys apart later."><Input name="name" placeholder="Website" maxLength={60} /></Field>
        <Field label="Expires" name="expiresInDays">
          <Select name="expiresInDays" defaultValue="0">
            <option value="0">Never</option><option value="30">In 30 days</option><option value="90">In 90 days</option><option value="365">In a year</option>
          </Select>
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-stone-800">What this key may do</legend>
        <div className="space-y-2">{API_SCOPES.map((s) => <Checkbox key={s.scope} name="scopes" value={s.scope} label={s.label} hint={s.scope} />)}</div>
        {state?.fieldErrors?.scopes ? <p className="mt-1 text-xs text-red-600">{state.fieldErrors.scopes}</p> : null}
      </fieldset>
      <SubmitButton pendingText="Creating…">Create key</SubmitButton>
    </form>
  );
}
