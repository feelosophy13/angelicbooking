"use client";
import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { Button, Card, Input, MoneyInput, Select } from "@/components/ui";
import { saveServiceAddons } from "../actions";

type Option = { id: string; name: string; priceCents: number; durationMin: number };
type Row = { addonServiceId: string; mode: "regular" | "fixed" | "off"; amount: string; minutes: string };

const MAX = 3;

/**
 * The add-ons suggested with this service when a client books it online ("Add to your visit?"): up to three, each at its usual price,
 * a fixed add-on price, or an amount off the stylist's own price, and optionally a shorter time.
 */
export function AddonsCard({ slug, serviceId, currency, options, initial }: { slug: string; serviceId: string; currency: string; options: Option[]; initial: Row[] }) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [pending, start] = useTransition();
  const money = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(c / 100);
  const set = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <Card className="mt-6 max-w-2xl p-5">
      <h2 className="font-medium">Add-ons</h2>
      <p className="mb-3 text-sm text-stone-600">Suggested when a client books this service online, as &ldquo;Add to your visit?&rdquo; on the last step. Up to {MAX}: more than that and clients skip them all. A cheaper add-on shows its usual price crossed out.</p>
      {/* Sent by hand rather than as a form action, which would reset the fields and leave the picks out of step with what's shown. */}
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); start(() => saveServiceAddons(fd)); }}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="serviceId" value={serviceId} />
        {rows.map((r, i) => {
          const o = options.find((x) => x.id === r.addonServiceId);
          return (
            <div key={i} className="space-y-2 rounded-lg border border-stone-200 p-3">
              <div className="flex items-center gap-2">
                <Select name={`addon_${i}`} value={r.addonServiceId} onChange={(e) => set(i, { addonServiceId: e.target.value })} aria-label="Add-on service" className="min-w-0 flex-1">
                  <option value="" disabled>Choose a service…</option>
                  {options.filter((x) => x.id === r.addonServiceId || !rows.some((y) => y.addonServiceId === x.id)).map((x) => <option key={x.id} value={x.id}>{x.name} · {money(x.priceCents)} · {x.durationMin} min</option>)}
                </Select>
                <button type="button" onClick={() => setRows((rr) => rr.filter((_, j) => j !== i))} className="rounded-md p-2 text-stone-400 hover:bg-stone-100 hover:text-red-600" aria-label="Remove add-on"><X className="h-4 w-4" aria-hidden /></button>
              </div>
              <div className="grid gap-2 sm:grid-cols-[11rem_8rem_7rem]">
                <Select name={`mode_${i}`} value={r.mode} onChange={(e) => set(i, { mode: e.target.value as Row["mode"] })} aria-label="Add-on price">
                  <option value="regular">Usual price</option>
                  <option value="fixed">Add-on price</option>
                  <option value="off">Amount off</option>
                </Select>
                {r.mode === "regular" ? <span /> : <MoneyInput currency={currency} name={`amount_${i}`} value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} aria-label={r.mode === "fixed" ? "Add-on price" : "Amount off"} />}
                <Input name={`minutes_${i}`} type="number" min={5} max={600} step={5} value={r.minutes} onChange={(e) => set(i, { minutes: e.target.value })} placeholder={o ? `${o.durationMin} min` : "Minutes"} aria-label="Add-on minutes" />
              </div>
              <p className="text-xs text-stone-500">{r.mode === "fixed" ? "The same price whoever does it." : r.mode === "off" ? "Taken off the stylist's own price for it." : "The stylist's usual price for it."} {r.minutes ? `Takes ${r.minutes} min as an add-on.` : "Blank minutes: its usual time."}</p>
            </div>
          );
        })}
        {rows.length < MAX ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => setRows((r) => [...r, { addonServiceId: "", mode: "regular", amount: "", minutes: "" }])}>Add an add-on</Button>
        ) : null}
        <div><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save add-ons"}</Button></div>
      </form>
    </Card>
  );
}
