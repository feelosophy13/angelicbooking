"use client";
import { useActionState, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, Checkbox, Input, Notice, Select } from "@/components/ui";
import { Field, SubmitButton } from "@/components/form";
import { API_SCOPES } from "@/lib/api-scopes";
import { createApiKey } from "./actions";

const BASE = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.angelicbooking.com"}/api/v1`;

/** Create a key. The secret is shown once, right here, then never again. Creating another remounts the form, which clears its action state. */
export function ApiKeyForm({ slug }: { slug: string }) {
  const [round, setRound] = useState(0);
  return <ApiKeyRound key={round} slug={slug} onAnother={() => setRound((r) => r + 1)} />;
}

function ApiKeyRound({ slug, onAnother }: { slug: string; onAnother: () => void }) {
  const [state, act] = useActionState(createApiKey, undefined);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const keyRef = useRef<HTMLElement>(null);
  const key = state?.ok ? state.values?.key : undefined;
  if (key) {
    const quickStart = `curl ${BASE}/services \\\n  -H "Authorization: Bearer ${key}"`;
    const copy = async (text: string, mark: () => void) => {
      try {
        await navigator.clipboard.writeText(text);
        mark();
        setCopyFailed(false);
      } catch {
        // Clipboard access is blocked in some browsers and on plain http: select the text so the user can copy it by hand.
        setCopyFailed(true);
        const el = keyRef.current;
        if (el) window.getSelection()?.selectAllChildren(el);
      }
    };
    return (
      <div className="space-y-4">
        <Notice kind="success">Key “{state?.values?.name}” created. Copy it now: it is shown only once and we cannot recover it.</Notice>
        <div className="flex items-center gap-2">
          <code ref={keyRef} className="min-w-0 flex-1 select-all break-all rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs">{key}</code>
          <Button type="button" variant="secondary" onClick={() => copy(key, () => setCopied(true))}>
            {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}{copied ? "Copied" : "Copy"}
          </Button>
        </div>
        {copyFailed ? <p className="text-xs text-red-600">Couldn’t reach the clipboard. The key is selected above: press ⌘C (or Ctrl+C) to copy it.</p> : null}
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-stone-700">Try it</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => copy(quickStart, () => undefined)}>Copy command</Button>
          </div>
          <pre className="overflow-x-auto rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs">{quickStart}</pre>
          <p className="mt-1 text-xs text-stone-500">This lists your services. Full reference: <a className="underline" href="/developers" target="_blank" rel="noreferrer">API documentation</a>, or the <a className="underline" href="/openapi/v1.json" target="_blank" rel="noreferrer">OpenAPI file</a> for code generators.</p>
        </div>
        <p className="text-xs text-stone-500">Treat it like a password: keep it on your server, never in a web page or an app you ship.</p>
        <Button type="button" variant="secondary" onClick={onAnother}>Create another key</Button>
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
        <div className="space-y-4">
          {[...new Set(API_SCOPES.map((s) => s.group))].map((group) => (
            <div key={group}>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">{group}</div>
              <div className="space-y-2">
                {API_SCOPES.filter((s) => s.group === group).map((s) => (
                  <Checkbox key={s.scope} name="scopes" value={s.scope} label={<>{s.label}{"sensitive" in s && s.sensitive ? <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">powerful</span> : null}</>} hint={s.scope} />
                ))}
              </div>
            </div>
          ))}
        </div>
        {state?.fieldErrors?.scopes ? <p className="mt-1 text-xs text-red-600">{state.fieldErrors.scopes}</p> : null}
      </fieldset>
      <SubmitButton pendingText="Creating…">Create key</SubmitButton>
    </form>
  );
}
