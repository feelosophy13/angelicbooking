"use client";
import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ServiceGroup } from "@/components/service-picker";
import { cn } from "@/lib/utils";

/**
 * Pick any number of services, grouped by category. Each group collapses to one line with a
 * count and an all/none box; a search filter narrows every group. Posts one `name` value per
 * picked service id.
 */
export function ServiceCheckboxes({ name, groups, selected }: { name: string; groups: ServiceGroup[]; selected: string[] }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(selected));
  const [open, setOpen] = useState<Set<string>>(() => new Set(groups.filter((g) => g.services.some((s) => selected.includes(s.id))).map((g) => g.id)));
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => (needle ? groups.map((g) => ({ ...g, services: g.services.filter((s) => s.name.toLowerCase().includes(needle) || g.name.toLowerCase().includes(needle)) })).filter((g) => g.services.length) : groups), [groups, needle]);
  const toggle = (id: string, on: boolean) => setPicked((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });
  const toggleGroup = (g: ServiceGroup, on: boolean) => setPicked((p) => { const n = new Set(p); for (const s of g.services) if (on) n.add(s.id); else n.delete(s.id); return n; });
  const flip = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const total = groups.reduce((n, g) => n + g.services.length, 0);
  return (
    <div className="space-y-2">
      {[...picked].map((id) => <input key={id} type="hidden" name={name} value={id} />)}
      <div className="flex items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a service" className="h-8 w-56 rounded-lg border border-stone-300 bg-white px-2.5 text-xs" aria-label="Find a service" />
        <span className="text-xs text-stone-500">{picked.size} of {total} selected</span>
        {picked.size ? <button type="button" onClick={() => setPicked(new Set())} className="text-xs text-stone-500 underline">Clear</button> : null}
      </div>
      <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
        {shown.map((g) => {
          const n = g.services.filter((s) => picked.has(s.id)).length;
          const all = n === g.services.length;
          const isOpen = needle ? true : open.has(g.id);
          return (
            <li key={g.id}>
              <div className="flex items-center gap-2 px-3 py-2">
                <input type="checkbox" checked={all} ref={(el) => { if (el) el.indeterminate = n > 0 && !all; }} onChange={(e) => toggleGroup(g, e.target.checked)} aria-label={`All ${g.name}`} className="h-4 w-4 rounded border-stone-300 text-brand-600" />
                <button type="button" onClick={() => flip(g.id)} className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left text-sm" aria-expanded={isOpen}>
                  <span className="truncate font-medium text-stone-800">{g.name}</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-stone-500">{n ? `${n} of ${g.services.length}` : g.services.length}<ChevronDown className={cn("h-4 w-4 transition", isOpen && "rotate-180")} /></span>
                </button>
              </div>
              {isOpen ? (
                <div className="grid gap-1 border-t border-stone-100 bg-stone-50/60 px-3 py-2 pl-9 sm:grid-cols-2">
                  {g.services.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={picked.has(s.id)} onChange={(e) => toggle(s.id, e.target.checked)} className="h-4 w-4 rounded border-stone-300 text-brand-600" />
                      <span className="min-w-0 truncate">{s.name}</span>
                    </label>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
        {shown.length === 0 ? <li className="px-3 py-3 text-sm text-stone-500">No service matches “{q}”.</li> : null}
      </ul>
    </div>
  );
}
