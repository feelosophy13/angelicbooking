"use client";
import { useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { Checkbox, Input } from "@/components/ui";

export type PickerGroup = { id: string; name: string; services: { id: string; name: string; durationMin: number }[] };

/**
 * Which services a staff member performs, for menus of any size: grouped by
 * category with a per-group toggle, a search box, and a running count. Groups
 * start collapsed unless something in them is selected (or a search is on).
 * Posts the chosen ids as `serviceIds` with the surrounding form.
 */
export function StaffServicesPicker({ groups, initial }: { groups: PickerGroup[]; initial: string[] }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initial));
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(() => new Set(groups.filter((g) => g.services.some((s) => initial.includes(s.id))).map((g) => g.id)));
  const total = groups.reduce((n, g) => n + g.services.length, 0);
  const needle = q.trim().toLowerCase();
  const visible = useMemo(() => (needle ? groups.map((g) => ({ ...g, services: g.services.filter((s) => s.name.toLowerCase().includes(needle)) })).filter((g) => g.services.length) : groups), [groups, needle]);

  const toggle = (id: string, on: boolean) => setPicked((p) => { const n = new Set(p); on ? n.add(id) : n.delete(id); return n; });
  const toggleGroup = (g: PickerGroup, on: boolean) => setPicked((p) => { const n = new Set(p); for (const s of g.services) on ? n.add(s.id) : n.delete(s.id); return n; });
  const toggleOpen = (id: string) => setOpen((o) => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="space-y-3">
      {[...picked].map((id) => <input key={id} type="hidden" name="serviceIds" value={id} />)}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-stone-700">
          {picked.size === 0 ? <>Performs <b>every service</b> (none selected).</> : <><b>{picked.size}</b> of {total} selected.</>}
          {picked.size > 0 ? <button type="button" onClick={() => setPicked(new Set())} className="ml-2 text-xs text-stone-500 underline hover:text-stone-800">Clear all</button> : null}
        </p>
        <div className="relative w-64 max-w-full">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a service…" className="h-9 pl-8" aria-label="Find a service" />
        </div>
      </div>
      <div className="divide-y divide-stone-200 rounded-xl border border-stone-200">
        {visible.length === 0 ? <p className="px-4 py-6 text-center text-sm text-stone-500">No service matches “{q.trim()}”.</p> : null}
        {visible.map((g) => {
          const n = g.services.filter((s) => picked.has(s.id)).length;
          const all = n === g.services.length;
          const isOpen = !!needle || open.has(g.id);
          return (
            <div key={g.id}>
              <div className="flex items-center gap-2 px-3 py-2">
                <button type="button" onClick={() => toggleOpen(g.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={isOpen}>
                  <ChevronRight className={`h-4 w-4 shrink-0 text-stone-400 transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden />
                  <span className="truncate text-sm font-medium text-stone-800">{g.name}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${n ? "bg-brand-50 text-brand-800" : "bg-stone-100 text-stone-500"}`}>{n} of {g.services.length}</span>
                </button>
                <button type="button" onClick={() => toggleGroup(g, !all)} className="shrink-0 text-xs text-brand-700 hover:underline">{all ? "Clear" : "Select all"}</button>
              </div>
              {isOpen ? (
                <ul className="grid gap-x-6 gap-y-1 bg-stone-50/60 px-3 pb-3 pl-9 sm:grid-cols-2 lg:grid-cols-3">
                  {g.services.map((s) => (
                    <li key={s.id}>
                      <Checkbox checked={picked.has(s.id)} onChange={(e) => toggle(s.id, e.target.checked)} label={<>{s.name} <span className="text-stone-400">· {s.durationMin} min</span></>} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
