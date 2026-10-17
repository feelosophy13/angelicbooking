"use client";
import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button, Input, Notice } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { QuickClientResult } from "@/app/app/[slug]/clients/actions";

type Hit = { id: string; name: string; subtitle: string };

/**
 * Type-ahead client field for the desk: searches by name, phone or email as you
 * type (any number of clients), can be cleared to "Walk-in", and can create a
 * client inline without leaving the form. Posts the id as a hidden input.
 */
export function ClientPicker(props: {
  slug: string;
  name?: string;
  initial: { id: string; name: string } | null;
  canCreate: boolean;
  createClient?: (input: { slug: string; firstName: string; lastName: string; phone: string; email: string; confirmDuplicate?: boolean }) => Promise<QuickClientResult>;
  placeholder?: string;
  allowWalkIn?: boolean;
  /** Called after a pick (the hidden input is already updated). */
  onPick?: (c: { id: string; name: string } | null) => void;
}) {
  const name = props.name ?? "clientId";
  const [picked, setPicked] = useState(props.initial);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Likely duplicates of the client being added, and what was typed (to add them anyway).
  const [matches, setMatches] = useState<{ id: string; name: string; detail: string }[] | null>(null);
  const typed = useRef<{ firstName: string; lastName: string; phone: string; email: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const hidden = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/app/${props.slug}/search?q=${encodeURIComponent(q.trim())}`, { signal: ctl.signal });
        const j = (await r.json()) as { hits: { kind: string; title: string; subtitle?: string; href: string }[] };
        setHits(j.hits.filter((h) => h.kind === "client").map((h) => ({ id: h.href.split("/").pop()!, name: h.title, subtitle: h.subtitle ?? "" })));
        setOpen(true);
      } catch {
        /* aborted or offline: keep what we had */
      }
    }, 150);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, props.slug]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (c: { id: string; name: string } | null) => {
    setPicked(c);
    setQ("");
    setHits([]);
    setOpen(false);
    setCreating(false);
    props.onPick?.(c);
    // Once the hidden input holds the new id, let a surrounding live form (New appointment) notice the change.
    setTimeout(() => hidden.current?.dispatchEvent(new Event("change", { bubbles: true })), 0);
  };

  async function submitNew(fields: { firstName: string; lastName: string; phone: string; email: string }, confirmDuplicate = false) {
    if (!props.createClient) return;
    setBusy(true);
    setError(null);
    const r = await props.createClient({ slug: props.slug, ...fields, confirmDuplicate });
    setBusy(false);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    if ("matches" in r) {
      typed.current = fields;
      setMatches(r.matches);
      return;
    }
    setMatches(null);
    pick({ id: r.id, name: r.name });
  }

  // The picker often sits inside another form (a sale, a booking), and forms can't nest: read the fields directly instead.
  const newBox = useRef<HTMLDivElement>(null);
  async function create() {
    const val = (n: string) => newBox.current?.querySelector<HTMLInputElement>(`input[data-field="${n}"]`)?.value ?? "";
    if (!val("firstName").trim()) {
      setError("First name is required");
      return;
    }
    await submitNew({ firstName: val("firstName"), lastName: val("lastName"), phone: val("phone"), email: val("email") });
  }

  return (
    <div ref={box} className="relative">
      <input ref={hidden} type="hidden" name={name} value={picked?.id ?? ""} readOnly />
      {picked ? (
        <div className="flex h-10 items-center justify-between gap-2 rounded-lg border border-stone-300 bg-white px-3 text-sm">
          <span className="truncate font-medium">{picked.name}</span>
          <button type="button" onClick={() => pick(null)} className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-800" aria-label="Change client"><X className="h-3.5 w-3.5" /> Change</button>
        </div>
      ) : creating ? (
        <div
          ref={newBox}
          className="space-y-2 rounded-lg border border-stone-300 bg-white p-3"
          onKeyDown={(e) => {
            // Enter adds the client rather than submitting the page's own form.
            if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
              e.preventDefault();
              void create();
            }
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <Input data-field="firstName" placeholder="First name" aria-label="First name" autoFocus />
            <Input data-field="lastName" placeholder="Last name" aria-label="Last name" />
          </div>
          <Input data-field="phone" type="tel" placeholder="Mobile" aria-label="Mobile" />
          <Input data-field="email" type="email" placeholder="Email" aria-label="Email" />
          {error ? <Notice>{error}</Notice> : null}
          {matches ? (
            <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm">
              <p className="px-1 font-medium text-amber-900">Already on file? Pick them instead:</p>
              {matches.map((m) => (
                <button key={m.id} type="button" onClick={() => { setMatches(null); pick({ id: m.id, name: m.name }); }} className="block w-full rounded-md bg-white px-2 py-1.5 text-left hover:bg-stone-50">
                  <span className="font-medium">{m.name}</span> <span className="text-xs text-stone-500">{m.detail}</span>
                </button>
              ))}
              <button type="button" disabled={busy} onClick={() => typed.current && submitNew(typed.current, true)} className="px-1 text-xs text-stone-600 underline">Add as a new client anyway</button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button type="button" size="sm" disabled={busy} onClick={() => void create()}>{busy ? "Adding…" : "Add client"}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            </div>
          )}
        </div>
      ) : (
        <>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => hits.length && setOpen(true)}
            placeholder={props.placeholder ?? "Search by name, phone or email…"}
            autoComplete="off"
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
          />
          {open && (hits.length || q.trim().length >= 2) ? (
            <ul role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-stone-200 bg-white py-1 text-sm shadow-lg">
              {hits.map((h) => (
                <li key={h.id} role="option" aria-selected={false}>
                  <button type="button" onClick={() => pick(h)} className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-stone-50">
                    <span className="font-medium">{h.name}</span>
                    {h.subtitle ? <span className="text-xs text-stone-500">{h.subtitle}</span> : null}
                  </button>
                </li>
              ))}
              {!hits.length ? <li className="px-3 py-1.5 text-stone-500">No clients match “{q.trim()}”.</li> : null}
              {props.canCreate ? (
                <li className="border-t border-stone-100">
                  <button type="button" onClick={() => setCreating(true)} className="flex w-full items-center gap-1 px-3 py-1.5 text-left text-brand-700 hover:bg-stone-50"><Plus className="h-3.5 w-3.5" /> New client{q.trim() ? ` “${q.trim()}”` : ""}</button>
                </li>
              ) : null}
            </ul>
          ) : null}
          <div className={cn("mt-1 flex items-center gap-3 text-xs text-stone-500")}>
            {props.allowWalkIn !== false ? <span>Leave empty for a walk-in.</span> : null}
            {props.canCreate ? <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-1 text-brand-700 hover:underline"><Plus className="h-3 w-3" /> New client</button> : null}
          </div>
        </>
      )}
    </div>
  );
}
