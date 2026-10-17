"use client";
import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { emptyLashZone, formatLashThickness, formatLashZone, LASH_CURLS, LASH_LENGTH_MAX, LASH_LENGTH_MIN, LASH_THICKNESS_MAX, LASH_THICKNESS_MIN, LASH_THICKNESS_PRESETS, LASH_ZONE_COUNTS, type LashZone } from "@angelic/core";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { Input, Textarea } from "@/components/ui";
import { LashMapDiagram } from "@/components/lash-map";
import { cn } from "@/lib/utils";
import { saveLashMap } from "./actions";

const STYLE_IDEAS = ["Natural", "Cat eye", "Doll eye", "Squirrel", "Open eye", "Classic natural", "Hybrid cat eye", "Volume doll eye", "Wispy"];

export function LashMapEditor({ slug, clientId, map, appointmentId, returnTo, cancelHref }: {
  slug: string;
  clientId: string;
  map: { id: string | null; title: string; notes: string | null; zones: LashZone[] };
  appointmentId: string | null;
  returnTo: "client" | "appointment";
  cancelHref: string;
}) {
  const [zones, setZones] = useState<LashZone[]>(map.zones);
  const [sel, setSel] = useState(0);
  const z = zones[sel] ?? emptyLashZone();
  const [customThickness, setCustomThickness] = useState("");
  // Taps on chips change no input, so tell ActionForm's unsaved-changes guard about them through the hidden zones field.
  const zonesInput = useRef<HTMLInputElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    zonesInput.current?.dispatchEvent(new Event("input", { bubbles: true }));
  }, [zones]);

  const patch = (p: Partial<LashZone>) => setZones((cur) => cur.map((x, i) => (i === sel ? { ...x, ...p } : x)));
  const applyToAll = (key: "curl" | "thickness") => setZones((cur) => cur.map((x) => ({ ...x, [key]: z[key] })));
  const setCount = (n: number) => {
    setZones((cur) => (n < cur.length ? cur.slice(0, n) : [...cur, ...Array.from({ length: n - cur.length }, () => ({ ...(cur[cur.length - 1] ?? emptyLashZone()) }))]));
    setSel((s) => Math.min(s, n - 1));
  };
  const stepLength = (d: number) => {
    const next = Math.min(LASH_LENGTH_MAX, Math.max(LASH_LENGTH_MIN, (z.length ?? 10) + d));
    patch({ length: next });
  };
  const isPreset = z.thickness != null && (LASH_THICKNESS_PRESETS as readonly number[]).includes(z.thickness);

  return (
    <ActionForm action={saveLashMap}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="clientId" value={clientId} />
      {map.id ? <input type="hidden" name="mapId" value={map.id} /> : null}
      {appointmentId ? <input type="hidden" name="appointmentId" value={appointmentId} /> : null}
      <input type="hidden" name="returnTo" value={returnTo} />
      <input ref={zonesInput} type="hidden" name="zones" value={JSON.stringify(zones)} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Style" name="title" hint="What you'd call this look.">
          <Input name="title" defaultValue={map.title} list="lash-style-ideas" placeholder="e.g. Hybrid cat eye" required maxLength={80} />
        </Field>
        <Field label="Zones" hint="Inner corner to outer corner.">
          <Chips options={LASH_ZONE_COUNTS.map((n) => ({ value: String(n), label: `${n} zones` }))} value={String(zones.length)} onChange={(v) => setCount(Number(v))} />
        </Field>
      </div>
      <datalist id="lash-style-ideas">{STYLE_IDEAS.map((s) => <option key={s} value={s} />)}</datalist>

      <div className="rounded-lg border border-stone-200 bg-white p-2">
        <LashMapDiagram zones={zones} selected={sel} onSelect={setSel} />
        <ol className="mt-2 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${zones.length}, minmax(0, 1fr))` }}>
          {zones.map((x, i) => (
            <li key={i}>
              <button type="button" onClick={() => setSel(i)} aria-pressed={sel === i} className={cn("w-full rounded-md border px-1 py-1.5 text-center text-xs leading-4 tabular-nums", sel === i ? "border-brand-500 bg-brand-50 text-brand-700" : "border-stone-200 text-stone-600 hover:bg-stone-50")}>
                <span className="block font-semibold"><span className="hidden sm:inline">Zone </span>{i + 1}</span>
                <span className="hidden truncate sm:block">{formatLashZone(x)}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className="space-y-4 rounded-lg border border-stone-200 p-4">
        <p className="text-sm font-semibold text-stone-700">Zone {sel + 1}{sel === 0 ? " · inner corner" : sel === zones.length - 1 ? " · outer corner" : ""}</p>
        <Field label="Length (mm)">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => stepLength(-0.5)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-stone-300 hover:bg-stone-50" aria-label="Half a millimetre shorter"><Minus className="h-4 w-4" /></button>
            <Input
              type="number"
              inputMode="decimal"
              step={0.5}
              min={LASH_LENGTH_MIN}
              max={LASH_LENGTH_MAX}
              value={z.length ?? ""}
              onChange={(e) => patch({ length: e.target.value === "" ? null : Number(e.target.value) })}
              className="w-24 text-center tabular-nums"
              aria-label={`Zone ${sel + 1} length in millimetres`}
            />
            <button type="button" onClick={() => stepLength(0.5)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-stone-300 hover:bg-stone-50" aria-label="Half a millimetre longer"><Plus className="h-4 w-4" /></button>
          </div>
        </Field>
        <Field label="Curl">
          <div className="flex flex-wrap items-center gap-2">
            <Chips options={LASH_CURLS.map((c) => ({ value: c, label: c }))} value={z.curl} onChange={(v) => patch({ curl: v === z.curl ? null : v })} />
            <ApplyAll onClick={() => applyToAll("curl")} disabled={z.curl == null} />
          </div>
        </Field>
        <Field label="Thickness (mm)" hint={`Pick a common size or type one between ${LASH_THICKNESS_MIN} and ${LASH_THICKNESS_MAX}.`}>
          <div className="flex flex-wrap items-center gap-2">
            <Chips options={LASH_THICKNESS_PRESETS.map((t) => ({ value: String(t), label: formatLashThickness(t) }))} value={isPreset ? String(z.thickness) : null} onChange={(v) => { setCustomThickness(""); patch({ thickness: Number(v) === z.thickness ? null : Number(v) }); }} />
            <Input
              type="number"
              inputMode="decimal"
              step={0.01}
              min={LASH_THICKNESS_MIN}
              max={LASH_THICKNESS_MAX}
              placeholder="Other"
              value={!isPreset && z.thickness != null ? String(z.thickness) : customThickness}
              onChange={(e) => { setCustomThickness(e.target.value); const v = Number(e.target.value); patch({ thickness: e.target.value === "" || !Number.isFinite(v) ? null : v }); }}
              className="w-24 tabular-nums"
              aria-label={`Zone ${sel + 1} custom thickness in millimetres`}
            />
            <ApplyAll onClick={() => applyToAll("thickness")} disabled={z.thickness == null} />
          </div>
        </Field>
        <div className="flex justify-between gap-2">
          <button type="button" onClick={() => setSel((s) => Math.max(0, s - 1))} disabled={sel === 0} className="text-sm text-stone-600 hover:text-stone-900 disabled:opacity-40">← Zone {Math.max(1, sel)}</button>
          <button type="button" onClick={() => setSel((s) => Math.min(zones.length - 1, s + 1))} disabled={sel === zones.length - 1} className="text-sm text-stone-600 hover:text-stone-900 disabled:opacity-40">Zone {Math.min(zones.length, sel + 2)} →</button>
        </div>
      </div>

      <Field label="Notes" name="notes" hint="Anything the map doesn't show: right eye differences, adhesive, sensitivities, fill schedule.">
        <Textarea name="notes" rows={3} defaultValue={map.notes ?? ""} maxLength={2000} />
      </Field>

      <div className="flex items-center justify-end gap-3">
        <a href={cancelHref} className="text-sm text-stone-600 hover:text-stone-900">Cancel</a>
        <SubmitButton pendingText="Saving…">Save lash map</SubmitButton>
      </div>
    </ActionForm>
  );
}

function Chips({ options, value, onChange }: { options: { value: string; label: string }[]; value: string | null; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)} className={cn("h-9 min-w-10 rounded-lg border px-2.5 text-sm tabular-nums", value === o.value ? "border-brand-600 bg-brand-600 text-white" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ApplyAll({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className="text-xs text-brand-700 hover:underline disabled:text-stone-400 disabled:no-underline">Use for all zones</button>;
}
