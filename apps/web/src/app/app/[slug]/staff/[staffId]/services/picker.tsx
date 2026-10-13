"use client";
import { useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { Button, Checkbox, Input, MoneyInput, Select } from "@/components/ui";

export type PickerGroup = { id: string; name: string; services: { id: string; name: string; durationMin: number; priceCents: number }[] };
export type Terms = Record<string, { price: number | null; duration: number | null }>;

const dollars = (cents: number) => (cents / 100).toFixed(2);

/**
 * Which services a staff member performs, and what they charge for each. Grouped by category with
 * a per-group toggle, a search box and a running count. A ticked service shows this person's price
 * and minutes (blank means the service's own); "Adjust" moves many prices at once. Posts the ticked
 * ids as `serviceIds` plus `price_<id>` and `duration_<id>` for each ticked service.
 */
export function StaffServicesPicker({ groups, initial, terms, currency }: { groups: PickerGroup[]; initial: string[]; terms: Terms; currency: string }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initial));
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(() => new Set(groups.filter((g) => g.services.some((s) => initial.includes(s.id))).map((g) => g.id)));
  const [price, setPrice] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(terms).map(([id, t]) => [id, t.price != null ? dollars(t.price) : ""])));
  const [minutes, setMinutes] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(terms).map(([id, t]) => [id, t.duration != null ? String(t.duration) : ""])));
  const [mode, setMode] = useState<"dollars" | "percent" | "reset">("dollars");
  const [amount, setAmount] = useState("");
  const all = useMemo(() => groups.flatMap((g) => g.services), [groups]);
  const total = all.length;
  const needle = q.trim().toLowerCase();
  const visible = useMemo(() => (needle ? groups.map((g) => ({ ...g, services: g.services.filter((s) => s.name.toLowerCase().includes(needle)) })).filter((g) => g.services.length) : groups), [groups, needle]);
  const customCount = [...picked].filter((id) => (price[id] ?? "") !== "" || (minutes[id] ?? "") !== "").length;

  const toggle = (id: string, on: boolean) => setPicked((p) => { const n = new Set(p); on ? n.add(id) : n.delete(id); return n; });
  const toggleGroup = (g: PickerGroup, on: boolean) => setPicked((p) => { const n = new Set(p); for (const s of g.services) on ? n.add(s.id) : n.delete(s.id); return n; });
  const toggleOpen = (id: string) => setOpen((o) => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Moves the prices of every ticked service from their base: add dollars, add a percent, or go back to base.
  const apply = () => {
    const v = Number(amount);
    if (mode !== "reset" && !Number.isFinite(v)) return;
    setPrice((cur) => {
      const next = { ...cur };
      for (const s of all) {
        if (!picked.has(s.id)) continue;
        if (mode === "reset") next[s.id] = "";
        else if (mode === "dollars") next[s.id] = dollars(Math.max(0, s.priceCents + Math.round(v * 100)));
        else next[s.id] = dollars(Math.max(0, Math.round(s.priceCents * (1 + v / 100) / 100) * 100));
      }
      return next;
    });
    if (mode === "reset") setMinutes((cur) => Object.fromEntries(Object.entries(cur).map(([id, m]) => [id, picked.has(id) ? "" : m])));
  };

  return (
    <div className="space-y-3">
      {[...picked].map((id) => <input key={id} type="hidden" name="serviceIds" value={id} />)}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-stone-700">
          {picked.size === 0 ? <>Performs <b>every service</b> (none selected).</> : <><b>{picked.size}</b> of {total} selected{customCount ? <> · <b>{customCount}</b> with their own price or time</> : null}.</>}
          {picked.size > 0 ? <button type="button" onClick={() => setPicked(new Set())} className="ml-2 text-xs text-stone-500 underline hover:text-stone-800">Clear all</button> : null}
        </p>
        <div className="relative w-64 max-w-full">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a service…" className="h-9 pl-8" aria-label="Find a service" />
        </div>
      </div>
      {picked.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm">
          <span className="text-stone-700">Adjust prices of the {picked.size} ticked:</span>
          <Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="h-8 w-40 text-sm" aria-label="How to adjust">
            <option value="dollars">Add dollars</option>
            <option value="percent">Add percent</option>
            <option value="reset">Back to base price</option>
          </Select>
          {mode !== "reset" ? <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={mode === "dollars" ? "10" : "15"} className="h-8 w-20 text-sm" aria-label="Amount" /> : null}
          <Button type="button" size="sm" variant="secondary" onClick={apply}>Apply</Button>
          <span className="text-xs text-stone-500">Moves from each service&apos;s base price. Nothing is saved until you save.</span>
        </div>
      ) : null}
      <div className="divide-y divide-stone-200 rounded-xl border border-stone-200">
        {visible.length === 0 ? <p className="px-4 py-6 text-center text-sm text-stone-500">No service matches “{q.trim()}”.</p> : null}
        {visible.map((g) => {
          const n = g.services.filter((s) => picked.has(s.id)).length;
          const allOn = n === g.services.length;
          const isOpen = !!needle || open.has(g.id);
          return (
            <div key={g.id}>
              <div className="flex items-center gap-2 px-3 py-2">
                <button type="button" onClick={() => toggleOpen(g.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={isOpen}>
                  <ChevronRight className={`h-4 w-4 shrink-0 text-stone-400 transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden />
                  <span className="truncate text-sm font-medium text-stone-800">{g.name}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${n ? "bg-brand-50 text-brand-800" : "bg-stone-100 text-stone-500"}`}>{n} of {g.services.length}</span>
                </button>
                <button type="button" onClick={() => toggleGroup(g, !allOn)} className="shrink-0 text-xs text-brand-700 hover:underline">{allOn ? "Clear" : "Select all"}</button>
              </div>
              {isOpen ? (
                <ul className="divide-y divide-stone-100 bg-stone-50/60 px-3 pb-2 pl-9">
                  {g.services.map((s) => {
                    const on = picked.has(s.id);
                    const custom = on && ((price[s.id] ?? "") !== "" || (minutes[s.id] ?? "") !== "");
                    return (
                      <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1.5">
                        <div className="min-w-[12rem] flex-1">
                          <Checkbox checked={on} onChange={(e) => toggle(s.id, e.target.checked)} label={<>{s.name}{custom ? <span className="ml-2 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">own price/time</span> : null}</>} />
                        </div>
                        {on ? (
                          <div className="flex items-center gap-2 text-xs text-stone-500">
                            <span className="w-28"><MoneyInput currency={currency} name={`price_${s.id}`} value={price[s.id] ?? ""} onChange={(e) => setPrice((p) => ({ ...p, [s.id]: e.target.value }))} placeholder={dollars(s.priceCents)} className="h-8 text-sm" aria-label={`${s.name} price`} /></span>
                            <span className="flex items-center gap-1"><Input name={`duration_${s.id}`} type="number" min={5} max={600} step={5} value={minutes[s.id] ?? ""} onChange={(e) => setMinutes((m) => ({ ...m, [s.id]: e.target.value }))} placeholder={String(s.durationMin)} className="h-8 w-16 text-sm" aria-label={`${s.name} minutes`} /> min</span>
                          </div>
                        ) : (
                          <span className="text-xs text-stone-400">Base ${dollars(s.priceCents)} · {s.durationMin} min</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
