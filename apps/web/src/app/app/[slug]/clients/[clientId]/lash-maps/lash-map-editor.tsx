"use client";
import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { emptyLashZone, formatLashThickness, formatLashZone, LASH_CURLS, LASH_LENGTH_MAX, LASH_LENGTH_MIN, LASH_THICKNESS_MAX, LASH_THICKNESS_MIN, LASH_THICKNESS_PRESETS, LASH_TYPES, LASH_ZONE_COUNTS, newLashSpike, sharedLashType, type LashSet, type LashZone } from "@angelic/core";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { Checkbox, Input, Textarea } from "@/components/ui";
import { LashMapDiagram, type LashSelection } from "@/components/lash-map";
import { cn } from "@/lib/utils";
import { saveLashMap } from "./actions";

const STYLE_IDEAS = ["Natural", "Cat eye", "Doll eye", "Squirrel", "Open eye", "Classic natural", "Hybrid cat eye", "Volume doll eye", "Wispy"];

export function LashMapEditor({ slug, clientId, map, appointmentId, returnTo, cancelHref }: {
  slug: string;
  clientId: string;
  map: { id: string | null; title: string; notes: string | null; zones: LashZone[]; rightZones: LashZone[] | null };
  appointmentId: string | null;
  returnTo: "client" | "appointment";
  cancelHref: string;
}) {
  // `left` is both eyes until the right eye is set differently; then it is the left eye and `right` the right.
  const [left, setLeft] = useState<LashZone[]>(map.zones);
  const [right, setRight] = useState<LashZone[] | null>(map.rightZones);
  const [eye, setEye] = useState<"left" | "right">("left");
  const onRight = eye === "right" && right != null;
  const zones = onRight ? right : left;
  const setZones = (fn: (cur: LashZone[]) => LashZone[]) => (onRight ? setRight((r) => fn(r ?? [])) : setLeft(fn));
  const [sel, setSel] = useState<LashSelection>({ kind: "zone", i: 0 });
  const [customThickness, setCustomThickness] = useState("");
  // Taps on chips change no input, so tell ActionForm's unsaved-changes guard about them through the hidden zones field.
  const zonesInput = useRef<HTMLInputElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    zonesInput.current?.dispatchEvent(new Event("input", { bubbles: true }));
  }, [left, right]);

  const spike = sel.kind === "spike";
  const z: LashSet = (spike ? zones[sel.i]?.spike : zones[sel.i]) ?? emptyLashZone();
  const label = (right ? (onRight ? "Right eye, " : "Left eye, ") : "") + (spike ? `${right ? "s" : "S"}pike between zones ${sel.i + 1} and ${sel.i + 2}` : `${right ? "z" : "Z"}one ${sel.i + 1}`);

  const select = (s: LashSelection) => {
    setCustomThickness("");
    // Tapping an empty divider adds a spike there.
    if (s.kind === "spike" && !zones[s.i]?.spike) setZones((cur) => cur.map((x, i) => (i === s.i ? { ...x, spike: newLashSpike(cur, i) } : x)));
    setSel(s);
  };
  const patch = (p: Partial<LashSet>) =>
    setZones((cur) => cur.map((x, i) => (i !== sel.i ? x : spike ? { ...x, spike: { ...(x.spike ?? emptyLashZone()), ...p } } : { ...x, ...p })));
  const removeSpike = () => {
    setZones((cur) => cur.map((x, i) => (i === sel.i ? { ...x, spike: null } : x)));
    setSel({ kind: "zone", i: sel.i + 1 });
  };
  const applyToAll = (key: "curl" | "thickness" | "type") => setZones((cur) => cur.map((x) => ({ ...x, [key]: z[key] ?? null })));
  const setCount = (n: number) => {
    setZones((cur) => {
      if (n < cur.length) return cur.slice(0, n).map((x, i) => (i === n - 1 ? { ...x, spike: null } : x)); // the last zone has no divider after it
      const last = cur[cur.length - 1] ?? emptyLashZone();
      return [...cur, ...Array.from({ length: n - cur.length }, () => ({ ...last, spike: null }))];
    });
    setSel((s) => (s.kind === "spike" ? (s.i < n - 1 ? s : { kind: "zone", i: n - 1 }) : { kind: "zone", i: Math.min(s.i, n - 1) }));
  };
  const stepLength = (d: number) => patch({ length: Math.min(LASH_LENGTH_MAX, Math.max(LASH_LENGTH_MIN, (z.length ?? 10) + d)) });
  const isPreset = z.thickness != null && (LASH_THICKNESS_PRESETS as readonly number[]).includes(z.thickness);
  const spikeCount = zones.filter((x) => x.spike).length;
  const sharedType = sharedLashType(zones); // shown once under the diagram, so the chips leave it out
  // The left eye is drawn mirrored (inner corner toward the nose), so the zone buttons and arrows under it run the same way.
  const mirror = right != null && !onRight;
  const order = mirror ? zones.map((_, i) => zones.length - 1 - i) : zones.map((_, i) => i);
  const toggleRight = (on: boolean) => {
    setRight(on ? left.map((x) => ({ ...x, spike: x.spike ? { ...x.spike } : null })) : null);
    setEye(on ? "right" : "left");
    setSel({ kind: "zone", i: 0 });
  };
  const switchEye = (e: "left" | "right") => {
    setEye(e);
    setSel({ kind: "zone", i: 0 });
    setCustomThickness("");
  }; // shown once under the diagram, so the chips leave it out

  return (
    <ActionForm action={saveLashMap}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="clientId" value={clientId} />
      {map.id ? <input type="hidden" name="mapId" value={map.id} /> : null}
      {appointmentId ? <input type="hidden" name="appointmentId" value={appointmentId} /> : null}
      <input type="hidden" name="returnTo" value={returnTo} />
      <input ref={zonesInput} type="hidden" name="zones" value={JSON.stringify(left)} />
      {right ? <input type="hidden" name="rightZones" value={JSON.stringify(right)} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Style" name="title" hint="What you'd call this look.">
          <Input name="title" defaultValue={map.title} list="lash-style-ideas" placeholder="e.g. Hybrid cat eye" required maxLength={80} />
        </Field>
        <Field label="Zones" hint="Inner corner to outer corner.">
          <Chips options={LASH_ZONE_COUNTS.map((n) => ({ value: String(n), label: `${n} zones` }))} value={String(zones.length)} onChange={(v) => setCount(Number(v))} />
        </Field>
      </div>
      <datalist id="lash-style-ideas">{STYLE_IDEAS.map((s) => <option key={s} value={s} />)}</datalist>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Checkbox label="Right eye is set differently" hint={right ? "Drawn as you see them from behind the client's head." : "Starts as a copy of this map."} checked={right != null} onChange={(e) => toggleRight(e.target.checked)} />
        {right ? <Chips options={[{ value: "left", label: "Left eye" }, { value: "right", label: "Right eye" }]} value={eye} onChange={(v) => switchEye(v as "left" | "right")} /> : null}
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-2">
        {right ? <p className="px-1 text-sm font-semibold text-stone-700">{onRight ? "Right eye" : "Left eye"}</p> : null}
        <LashMapDiagram zones={zones} selected={sel} onSelect={select} mirror={mirror} />
        <ol className="mt-2 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${zones.length}, minmax(0, 1fr))` }}>
          {order.map((i) => {
            const x = zones[i]!;
            const on = sel.kind === "zone" && sel.i === i;
            return (
              <li key={i}>
                <button type="button" onClick={() => select({ kind: "zone", i })} aria-pressed={on} className={cn("w-full rounded-md border px-1 py-1.5 text-center text-xs leading-4 tabular-nums", on ? "border-brand-500 bg-brand-50 text-brand-700" : "border-stone-200 text-stone-600 hover:bg-stone-50")}>
                  <span className="block font-semibold"><span className="hidden sm:inline">Zone </span>{i + 1}</span>
                  <span className="hidden truncate sm:block">{formatLashZone(sharedType ? { ...x, type: null } : x)}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="mt-2 px-1 text-xs text-stone-500">{spikeCount ? `${spikeCount} spike${spikeCount === 1 ? "" : "s"}. Tap a spike to change it, or a + to add another.` : "Tap a + on the lash line to add a spike between two zones."}</p>
      </div>

      <div className="space-y-4 rounded-lg border border-stone-200 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-stone-700">{label}{!spike && sel.i === 0 ? " · inner corner" : !spike && sel.i === zones.length - 1 ? " · outer corner" : ""}</p>
          {spike ? <button type="button" onClick={removeSpike} className="text-sm text-stone-500 hover:text-red-600">Remove spike</button> : null}
        </div>
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
              aria-label={`${label} length in millimetres`}
            />
            <button type="button" onClick={() => stepLength(0.5)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-stone-300 hover:bg-stone-50" aria-label="Half a millimetre longer"><Plus className="h-4 w-4" /></button>
          </div>
        </Field>
        <Field label="Curl">
          <div className="flex flex-wrap items-center gap-2">
            <Chips options={LASH_CURLS.map((c) => ({ value: c, label: c }))} value={z.curl} onChange={(v) => patch({ curl: v === z.curl ? null : v })} />
            {spike ? null : <ApplyAll onClick={() => applyToAll("curl")} disabled={z.curl == null} />}
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
              aria-label={`${label} custom thickness in millimetres`}
            />
            {spike ? null : <ApplyAll onClick={() => applyToAll("thickness")} disabled={z.thickness == null} />}
          </div>
        </Field>
        <Field label="Type" hint="Classic, hybrid, or the fan size for volume.">
          <div className="flex flex-wrap items-center gap-2">
            <Chips options={LASH_TYPES.map((t) => ({ value: t, label: t }))} value={z.type ?? null} onChange={(v) => patch({ type: v === z.type ? null : v })} />
            {spike ? null : <ApplyAll onClick={() => applyToAll("type")} disabled={!z.type} />}
          </div>
        </Field>
        {spike ? null : (
          <div className={cn("flex justify-between gap-2", mirror && "flex-row-reverse")}>
            <button type="button" onClick={() => select({ kind: "zone", i: Math.max(0, sel.i - 1) })} disabled={sel.i === 0} className="text-sm text-stone-600 hover:text-stone-900 disabled:opacity-40">{mirror ? `Zone ${Math.max(1, sel.i)} →` : `← Zone ${Math.max(1, sel.i)}`}</button>
            <button type="button" onClick={() => select({ kind: "zone", i: Math.min(zones.length - 1, sel.i + 1) })} disabled={sel.i === zones.length - 1} className="text-sm text-stone-600 hover:text-stone-900 disabled:opacity-40">{mirror ? `← Zone ${Math.min(zones.length, sel.i + 2)}` : `Zone ${Math.min(zones.length, sel.i + 2)} →`}</button>
          </div>
        )}
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
