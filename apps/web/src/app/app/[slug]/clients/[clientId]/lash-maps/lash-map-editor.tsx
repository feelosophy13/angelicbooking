"use client";
import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { emptyLashZone, formatLashThickness, formatLashZone, LASH_CURLS, LASH_LENGTH_MAX, LASH_LENGTH_MIN, LASH_THICKNESS_MAX, LASH_THICKNESS_MIN, LASH_COLOR_PRESETS, LASH_HYBRID_FANS, LASH_THICKNESS_PRESETS, LASH_LENGTH_STYLES, LASH_TYPE_GROUPS, lashHybridFan, lashLengthStyle, LASH_ZONE_COUNTS, newLashSpike, normalizeLashZones, sharedLashType, type LashSet, type LashZone } from "@angelic/core";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { Checkbox, Input, Textarea } from "@/components/ui";
import { LashMapDiagram, type LashSelection } from "@/components/lash-map";
import { Disclosure } from "@/components/disclosure";
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
  const [left, setLeft] = useState<LashZone[]>(() => normalizeLashZones(map.zones));
  const [right, setRight] = useState<LashZone[] | null>(() => (map.rightZones ? normalizeLashZones(map.rightZones) : null));
  const [eye, setEye] = useState<"left" | "right">("left");
  const onRight = eye === "right" && right != null;
  const zones = onRight ? right : left;
  const setZones = (fn: (cur: LashZone[]) => LashZone[]) => (onRight ? setRight((r) => fn(r ?? [])) : setLeft(fn));
  const [sel, setSel] = useState<LashSelection>({ kind: "zone", i: 0 });
  const [customThickness, setCustomThickness] = useState("");
  const [customColor, setCustomColor] = useState("");
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
    setPickedFans(false);
    setCustomThickness("");
    setCustomColor("");
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
  // Everything but length goes to every zone (shape to spikes too: a set is one lash product); length is what varies zone to zone.
  const [copied, setCopied] = useState(false);
  const copyToAll = () => {
    setZones((cur) => cur.map((x) => ({ ...x, curl: z.curl, thickness: z.thickness, flat: !!z.flat, type: z.type ?? null, color: z.color ?? null, spike: x.spike ? { ...x.spike, flat: !!z.flat } : x.spike })));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const longestNow = Math.max(0, ...zones.map((x) => x.length ?? 0)) || 12;
  const [longest, setLongest] = useState(String(longestNow));
  const fillLengths = (style: (typeof LASH_LENGTH_STYLES)[number]) => {
    const top = Math.min(LASH_LENGTH_MAX, Math.max(LASH_LENGTH_MIN, Math.round(Number(longest) * 2) / 2 || longestNow));
    const lengths = lashLengthStyle(style, zones.length, top);
    setZones((cur) => cur.map((x, i) => ({ ...x, length: lengths[i] ?? x.length })));
  };
  const setCount = (n: number) => {
    setZones((cur) => {
      if (n < cur.length) return cur.slice(0, n).map((x, i) => (i === n - 1 ? { ...x, spike: null } : x)); // the last zone has no divider after it
      const last = cur[cur.length - 1] ?? emptyLashZone();
      return [...cur, ...Array.from({ length: n - cur.length }, () => ({ ...last, spike: null }))];
    });
    setSel((s) => (s.kind === "spike" ? (s.i < n - 1 ? s : { kind: "zone", i: n - 1 }) : { kind: "zone", i: Math.min(s.i, n - 1) }));
  };
  const stepLength = (d: number) => patch({ length: Math.min(LASH_LENGTH_MAX, Math.max(LASH_LENGTH_MIN, (z.length ?? 10) + d)) });
  // A hybrid is stored with its fan ("Hybrid 3D"): the fan chips pick the fan and the checkbox turns the mix on or off.
  const hybridFan = lashHybridFan(z.type);
  const hybrid = hybridFan != null;
  // Type is picked in two steps: the kind (Classic, Fans, Hybrid), then for fans and hybrids which fan. "Fans" with no fan chosen yet
  // has nothing to store, so that one step lives in local state until a fan is picked.
  const [pickedFans, setPickedFans] = useState(false);
  const kind: "classic" | "fans" | "hybrid" | null = hybrid ? "hybrid" : z.type === "Classic" ? "classic" : z.type ? "fans" : pickedFans ? "fans" : null;
  const pickKind = (k: "classic" | "fans" | "hybrid") => {
    if (k === kind) {
      // Tapping the chosen kind again clears the type.
      setPickedFans(false);
      return patch({ type: null });
    }
    setPickedFans(k === "fans");
    if (k === "classic") return patch({ type: "Classic" });
    const fan = hybrid ? hybridFan || null : z.type && z.type !== "Classic" ? z.type : null;
    if (k === "fans") return patch({ type: fan });
    patch({ type: fan && LASH_HYBRID_FANS.includes(fan) ? `Hybrid ${fan}` : "Hybrid" });
  };
  const pickFan = (v: string) => {
    if (hybrid) return patch({ type: hybridFan === v ? "Hybrid" : `Hybrid ${v}` });
    patch({ type: v === z.type ? null : v });
  };
  const isPresetColor = !z.color || (LASH_COLOR_PRESETS as readonly string[]).includes(z.color);
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
    setPickedFans(false);
    setEye(e);
    setSel({ kind: "zone", i: 0 });
    setCustomThickness("");
    setCustomColor("");
  };

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
      </div>

      {/* On screens with room for it (tablet width and 700px tall), the diagram stays in view while the zone's settings scroll below it, so
          each change shows as it's made. Shorter screens scroll it away rather than have it cover the controls. */}
      <div className="rounded-lg border border-stone-200 bg-white p-2 [@media(min-width:768px)_and_(min-height:700px)]:sticky [@media(min-width:768px)_and_(min-height:700px)]:top-2 [@media(min-width:768px)_and_(min-height:700px)]:z-10 [@media(min-width:768px)_and_(min-height:700px)]:shadow-sm">
        {right ? <Chips options={[{ value: "left", label: "Left eye" }, { value: "right", label: "Right eye" }]} value={eye} onChange={(v) => switchEye(v as "left" | "right")} /> : null}
        <LashMapDiagram zones={zones} selected={sel} onSelect={select} mirror={mirror} className="mx-auto max-w-md" />
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

      <Disclosure variant="inset" title="Fill lengths from a style">
        <p className="mb-2 text-xs text-stone-500">Sets every {right ? `${onRight ? "right" : "left"} eye ` : ""}zone&apos;s length from the longest. Fine-tune zones afterwards.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-stone-700">
            <span className="mb-1 block text-xs text-stone-500">Longest (mm)</span>
            <Input type="number" inputMode="decimal" step={0.5} min={LASH_LENGTH_MIN} max={LASH_LENGTH_MAX} value={longest} onChange={(e) => setLongest(e.target.value)} className="w-24 tabular-nums" />
          </label>
          <Chips options={LASH_LENGTH_STYLES.map((s) => ({ value: s, label: s }))} value={null} onChange={(v) => fillLengths(v as (typeof LASH_LENGTH_STYLES)[number])} />
        </div>
      </Disclosure>

      <div className="space-y-4 rounded-lg border border-stone-200 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-stone-700">{label}{!spike && sel.i === 0 ? " · inner corner" : !spike && sel.i === zones.length - 1 ? " · outer corner" : ""}</p>
          {spike ? (
            <button type="button" onClick={removeSpike} className="text-sm text-stone-500 hover:text-red-600">Remove spike</button>
          ) : (
            <button type="button" onClick={copyToAll} className="text-sm text-brand-700 hover:underline" title="Curl, thickness, shape, type and color; lengths stay as they are">{copied ? "Copied to all zones" : "Copy to all zones"}</button>
          )}
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
          </div>
        </Field>
        <Field label="Type" hint="What goes on each natural lash. Hybrid mixes classics with one fan.">
          <div className="space-y-3">
            <Chips
              options={[{ value: "classic", label: "Classic" }, { value: "fans", label: "Fans" }, ...(spike ? [] : [{ value: "hybrid", label: "Hybrid" }])]}
              value={kind}
              onChange={(v) => pickKind(v as "classic" | "fans" | "hybrid")}
            />
            {kind === "fans" || kind === "hybrid" ? (
              <div className="space-y-2 border-l-2 border-stone-200 pl-3">
                {hybrid ? <p className="text-xs font-medium text-stone-700">Mixed with</p> : null}
                {LASH_TYPE_GROUPS.slice(1).map((g) => (
                  <div key={g.label}>
                    <p className="mb-1 text-xs text-stone-500">{g.label}</p>
                    <Chips options={g.types.filter((t) => !hybrid || t !== "Spike").map((t) => ({ value: t, label: t }))} value={hybrid ? hybridFan || null : z.type ?? null} onChange={pickFan} />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </Field>
        {/* Rarely changed, so folded away; opens by itself on a zone that uses flat lashes or a color. Borderless: it already sits inside the zone panel. Keyed so each zone decides afresh. */}
        <Disclosure key={`${eye}-${sel.kind}-${sel.i}`} variant="plain" title="Shape and color" hint={`${z.flat ? "Flat" : "Round"} · ${z.color ?? "Black"}`} defaultOpen={!!z.flat || !!z.color}>
          <div className="space-y-4">
            <Field label="Shape" hint="Flat (ellipse or split-tip) lashes are lighter than round ones of the same size.">
              <div className="flex flex-wrap items-center gap-2">
                <Chips options={[{ value: "round", label: "Round" }, { value: "flat", label: "Flat" }]} value={z.flat ? "flat" : "round"} onChange={(v) => patch({ flat: v === "flat" })} />
              </div>
            </Field>
            <Field label="Color" hint="Leave blank for black.">
              <div className="flex flex-wrap items-center gap-2">
                <Chips options={LASH_COLOR_PRESETS.map((c) => ({ value: c, label: c }))} value={isPresetColor ? z.color ?? null : null} onChange={(v) => { setCustomColor(""); patch({ color: v === z.color ? null : v }); }} />
                <Input
                  placeholder="Other"
                  maxLength={20}
                  value={!isPresetColor && z.color ? z.color : customColor}
                  onChange={(e) => { setCustomColor(e.target.value); const c = e.target.value.trim(); patch({ color: c ? c.charAt(0).toUpperCase() + c.slice(1) : null }); }}
                  className="w-28"
                  aria-label={`${label} other color`}
                />
              </div>
            </Field>
          </div>
        </Disclosure>
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
