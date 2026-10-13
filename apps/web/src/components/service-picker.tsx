"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { useFieldId } from "@/components/form";
import { cn } from "@/lib/utils";

export type ServiceOption = { id: string; name: string; meta: string; /** Shown after the name, e.g. "no one here". */ note?: string | null };
/** `whole` is an optional first row standing for the whole group ("All of Lash Extensions"), for filters that accept a category. */
export type ServiceGroup = { id: string; name: string; services: ServiceOption[]; whole?: ServiceOption };

/**
 * One service out of a menu of any size: a field that opens a searchable, category-grouped list.
 * Posts the chosen id as a hidden input under `name`; with `submitOnPick` the surrounding form is
 * submitted as soon as something is picked (for pages that reload their options from the choice).
 */
export function ServicePicker({ name, groups, value, placeholder = "Choose a service", noneLabel, submitOnPick, onPick, compact }: {
  name: string;
  groups: ServiceGroup[];
  value: string | null;
  placeholder?: string;
  /** Offer a "none" row at the top (for optional add-ons). */
  noneLabel?: string;
  submitOnPick?: boolean;
  /** Called with the chosen id ("" for the none row), for controlled uses such as a live preview. */
  onPick?: (id: string) => void;
  /** A short trigger for a toolbar, with a wider list that opens beneath it. */
  compact?: boolean;
}) {
  const fieldId = useFieldId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const all = useMemo(() => groups.flatMap((g) => (g.whole ? [g.whole, ...g.services] : g.services)), [groups]);
  // Show the choice straight away, even when the page does not reload (the hidden input carries it to the form).
  const [picked, setPicked] = useState(value);
  useEffect(() => setPicked(value), [value]);
  const current = all.find((s) => s.id === picked) ?? null;
  const needle = q.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!needle) return groups;
    const out: ServiceGroup[] = [];
    for (const g of groups) {
      const groupHit = g.name.toLowerCase().includes(needle);
      const services = groupHit ? g.services : g.services.filter((x) => x.name.toLowerCase().includes(needle));
      const whole = g.whole && (groupHit || g.whole.name.toLowerCase().includes(needle)) ? g.whole : undefined;
      if (services.length || whole) out.push({ ...g, services, whole });
    }
    return out;
  }, [groups, needle]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    search.current?.focus();
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const pick = (id: string) => {
    if (input.current) input.current.value = id;
    setPicked(id || null);
    setOpen(false);
    setQ("");
    input.current?.dispatchEvent(new Event("change", { bubbles: true })); // lets a surrounding form notice the pick
    onPick?.(id);
    if (submitOnPick) input.current?.form?.requestSubmit();
  };

  return (
    <div ref={box} className={cn("relative", compact && "w-auto min-w-[13rem] max-w-[20rem]")}>
      <input ref={input} type="hidden" name={name} value={picked ?? ""} readOnly />
      <button
        type="button"
        id={fieldId}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn("flex w-full items-center justify-between gap-2 h-10 rounded-lg border border-stone-300 bg-white px-3 text-left text-sm text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand-500", compact && "!h-9")}
      >
        <span className={cn("min-w-0 truncate", !current && !noneLabel && "text-stone-400")}>
          {current ? <>{current.name}{current.meta ? <span className="text-stone-500"> · {current.meta}</span> : null}</> : noneLabel ?? placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
      </button>
      {open ? (
        <div className={cn("absolute left-0 z-30 mt-1 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-lg", compact ? "w-[min(22rem,90vw)]" : "right-0")}>
          <div className="relative border-b border-stone-100 p-2">
            <Search className="pointer-events-none absolute left-4.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
            <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a service…" aria-label="Find a service" className="h-9 w-full rounded-lg border border-stone-300 bg-white pl-8 pr-3 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-2 focus:outline-offset-0 focus:outline-brand-500" />
          </div>
          <ul role="listbox" className="max-h-80 overflow-y-auto pb-1 text-sm">
            {noneLabel && !needle ? (
              <li role="option" aria-selected={!picked}>
                <button type="button" onClick={() => pick("")} className={cn("w-full px-3 py-1.5 text-left text-stone-600 hover:bg-stone-50", !picked && "bg-brand-50 text-brand-700")}>{noneLabel}</button>
              </li>
            ) : null}
            {visible.length === 0 ? <li className="px-3 py-4 text-center text-stone-500">No service matches “{q.trim()}”.</li> : null}
            {visible.map((g) => (
              <li key={g.id}>
                <p className="sticky top-0 z-10 bg-stone-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-stone-500">{g.name}</p>
                <ul>
                  {g.whole ? (
                    <li role="option" aria-selected={g.whole.id === picked}>
                      <button type="button" onClick={() => pick(g.whole!.id)} className={cn("flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left font-medium hover:bg-stone-50", g.whole.id === picked && "bg-brand-50 text-brand-700")}>
                        <span className="min-w-0 truncate">{g.whole.name}</span>
                      </button>
                    </li>
                  ) : null}
                  {g.services.map((s) => (
                    <li key={s.id} role="option" aria-selected={s.id === picked}>
                      <button type="button" onClick={() => pick(s.id)} className={cn("flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-stone-50", s.id === picked && "bg-brand-50 text-brand-700", s.note && "text-stone-400")}>
                        <span className="min-w-0 truncate">{s.name}{s.note ? <span className="ml-1.5 text-xs text-stone-400">· {s.note}</span> : null}</span>
                        {s.meta ? <span className="shrink-0 text-xs text-stone-500">{s.meta}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
