"use client";
import { useActionState, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, Checkbox, Input, LinkButton, Notice, Select } from "@/components/ui";
import { Field, SubmitButton } from "@/components/form";
import { Disclosure } from "@/components/disclosure";
import { API_SCOPES, type ApiScope } from "@/lib/api-scopes";
import { createApiKey } from "./actions";

const BASE = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.angelicbooking.com"}/api/v1`;

/** What a new key starts from. `replaces` is the id of the key it will take over from (its own revoke happens on create). */
export type KeyDefaults = { name: string; scopes: ApiScope[]; replaces?: { id: string; name: string } };

const PRESETS: { label: string; scopes: (s: (typeof API_SCOPES)[number]) => boolean; hint: string }[] = [
  { label: "Read only", scopes: (s) => s.scope.endsWith(":read"), hint: "Looks at everything, changes nothing" },
  { label: "Booking tool", scopes: (s) => ["catalog:read", "clients:read", "clients:write", "appointments:read", "appointments:write"].includes(s.scope), hint: "Clients and bookings" },
  { label: "Everything but powerful", scopes: (s) => !("sensitive" in s && s.sensitive), hint: "Leaves out pay, roles, marketing sends, settings" },
];

/** Which preset the selection matches exactly, or "Custom". */
function levelOf(picked: Set<string>): string {
  const match = PRESETS.find((p) => {
    const want = API_SCOPES.filter(p.scopes).map((x) => x.scope);
    return want.length === picked.size && want.every((x) => picked.has(x));
  });
  return match?.label ?? "Custom";
}

/** One plain sentence for the selection: "clients (read & change), appointments (read only)". */
function summarize(picked: Set<string>): string {
  const groups = [...new Set(API_SCOPES.map((s) => s.group))];
  const parts = groups.flatMap((g) => {
    const on = API_SCOPES.filter((s) => s.group === g && picked.has(s.scope));
    if (!on.length) return [];
    const change = on.some((s) => s.scope.endsWith(":write"));
    return [`${g.toLowerCase()} (${change ? "read & change" : "read only"})`];
  });
  return parts.length ? parts.join(", ") : "nothing yet. Choose a level below.";
}

/** Create a key. The secret is shown once, right here, then never again. Creating another remounts the form, which clears its action state. */
export function ApiKeyForm({ slug, defaults, backHref }: { slug: string; defaults?: KeyDefaults; backHref: string }) {
  const [round, setRound] = useState(0);
  return <ApiKeyRound key={round} slug={slug} defaults={defaults} backHref={backHref} onAnother={() => setRound((r) => r + 1)} />;
}

function ApiKeyRound({ slug, defaults, backHref, onAnother }: { slug: string; defaults?: KeyDefaults; backHref: string; onAnother: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(defaults?.scopes ?? []));
  const toggle = (scope: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(scope); else next.delete(scope);
      return next;
    });
  const setMany = (scopes: string[], on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      for (const x of scopes) if (on) next.add(x); else next.delete(x);
      return next;
    });
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
        <div className="flex flex-wrap gap-2 pt-1">
          <LinkButton href={backHref} variant="primary">Done</LinkButton>
          <Button type="button" variant="secondary" onClick={onAnother}>Create another key</Button>
        </div>
      </div>
    );
  }
  return (
    <form action={act} className="space-y-4" noValidate>
      {state?.error && !state.fieldErrors ? <Notice>{state.error}</Notice> : null}
      <input type="hidden" name="slug" value={slug} />
      {defaults?.replaces ? <input type="hidden" name="replaces" value={defaults.replaces.id} /> : null}
      {defaults?.replaces ? (
        <Notice kind="success">Replacing “{defaults.replaces.name}”. It stops working the moment this key is created, so update your tool first or right after.</Notice>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" name="name" hint="So you can tell keys apart later."><Input name="name" placeholder="Website" maxLength={60} defaultValue={defaults?.name} /></Field>
        <Field label="Expires" name="expiresInDays">
          <Select name="expiresInDays" defaultValue="0">
            <option value="0">Never</option><option value="30">In 30 days</option><option value="90">In 90 days</option><option value="365">In a year</option>
          </Select>
        </Field>
      </div>
      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-medium text-stone-800">What can this key do?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {PRESETS.map((p) => {
            const on = levelOf(picked) === p.label;
            return (
              <label key={p.label} className={`cursor-pointer rounded-lg border px-3 py-2.5 text-sm transition-colors ${on ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-stone-200 hover:bg-stone-50"}`}>
                <input type="radio" name="access_level" className="sr-only" checked={on} onChange={() => setPicked(new Set(API_SCOPES.filter(p.scopes).map((x) => x.scope)))} />
                <span className="block font-medium text-stone-800">{p.label}</span>
                <span className="block text-xs text-stone-500">{p.hint}</span>
              </label>
            );
          })}
        </div>
        <div className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">
          <span className="font-medium text-stone-700">This key can: </span>{summarize(picked)}
        </div>
        <Disclosure title="Customize permissions" hint={`${picked.size} of ${API_SCOPES.length} selected`} open={picked.size > 0 && levelOf(picked) === "Custom" ? true : undefined}>
          <div className="space-y-5">
            {[...new Set(API_SCOPES.map((s) => s.group))].map((group) => {
              const inGroup = API_SCOPES.filter((s) => s.group === group);
              const onCount = inGroup.filter((s) => picked.has(s.scope)).length;
              const allOn = onCount === inGroup.length;
              return (
                <div key={group}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-stone-800">{group} <span className="text-xs font-normal text-stone-400">{onCount} of {inGroup.length}</span></span>
                    <button type="button" className="text-xs text-stone-500 underline hover:text-stone-800" onClick={() => setMany(inGroup.map((x) => x.scope), !allOn)}>{allOn ? "None" : "All"}</button>
                  </div>
                  <div className="space-y-2">
                    {inGroup.map((s) => (
                      <Checkbox key={s.scope} name="scopes" value={s.scope} checked={picked.has(s.scope)} onChange={(e) => toggle(s.scope, e.target.checked)} label={<>{s.label}{"sensitive" in s && s.sensitive ? <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">powerful</span> : null}</>} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Disclosure>
        {state?.fieldErrors?.scopes ? <p className="text-xs text-red-600">{state.fieldErrors.scopes}</p> : null}
      </fieldset>
      <SubmitButton pendingText="Creating…">{defaults?.replaces ? "Create and replace" : "Create key"}</SubmitButton>
    </form>
  );
}
