import { allLashFlat, formatLashThickness, formatLashType, LASH_LENGTH_MAX, lashColorSummary, lashHybridFan, normalizeLashZones, sharedLashType, type LashZone } from "@angelic/core";
import { cn } from "@/lib/utils";

/**
 * An eye patch drawn as a crescent, as the stylist sees it working from behind the client's head: the top edge is the lash line and the
 * patch is cut into zones from the inner corner to the outer corner, each showing its lashes at their length and thickness. The inner
 * corner is on the left (the right eye, or both eyes); `mirror` puts it on the right for the left eye. Spikes sit on the dividers as one bold lash with their
 * length above the lash line. Server-safe; the editor passes `selected`/`onSelect`, which also shows a + on each empty divider.
 */
export type LashSelection = { kind: "zone" | "spike"; i: number };

const W = 400;
const H = 200;
type Curve = { a: P; c: P; b: P };
type Geo = { top: Curve; bottom: Curve; mirror: boolean };
// t = 0 is the inner corner. Mirroring swaps the ends, so everything placed by t (zones, lashes, spikes, labels) flips with it.
const GEO: Geo = { top: { a: [24, 54], c: [200, 112], b: [376, 54] }, bottom: { a: [24, 54], c: [200, 304], b: [376, 54] }, mirror: false };
const GEO_MIRROR: Geo = { top: { a: GEO.top.b, c: GEO.top.c, b: GEO.top.a }, bottom: { a: GEO.bottom.b, c: GEO.bottom.c, b: GEO.bottom.a }, mirror: true };
const DRAWN = 0.62; // the longest lash reaches this far down the patch

type P = readonly [number, number];
function bez(q: Curve, t: number): [number, number] {
  const u = 1 - t;
  return [u * u * q.a[0] + 2 * u * t * q.c[0] + t * t * q.b[0], u * u * q.a[1] + 2 * u * t * q.c[1] + t * t * q.b[1]];
}
const pt = (p: [number, number]) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
const f1 = (v: number) => v.toFixed(1);

function zonePath(g: Geo, i: number, n: number): string {
  const steps = 8;
  const top: string[] = [];
  const bottom: string[] = [];
  for (let s = 0; s <= steps; s++) {
    const t = (i + s / steps) / n;
    top.push(pt(bez(g.top, t)));
    bottom.unshift(pt(bez(g.bottom, t)));
  }
  return `M${top.join(" L")} L${bottom.join(" L")} Z`;
}

/** A lash from the lash line at position t, drawn into the patch at its length and bent by its curl. */
function lashPath(g: Geo, t: number, length: number, curl: string | null): string | null {
  const frac = Math.min(1, length / (LASH_LENGTH_MAX + 2));
  if (!frac) return null;
  const [x0, y0] = bez(g.top, t);
  const [x1, y1] = bez(g.bottom, t);
  const x2 = x0 + (x1 - x0) * frac * DRAWN;
  const y2 = y0 + (y1 - y0) * frac * DRAWN;
  // Curl bends the lash a little; tighter curls bend more.
  const bend = curlBend(curl) * Math.hypot(x2 - x0, y2 - y0) * (g.mirror ? -1 : 1);
  return `M${f1(x0)},${f1(y0)} Q${f1((x0 + x2) / 2 + bend)},${f1((y0 + y2) / 2)} ${f1(x2)},${f1(y2)}`;
}

/** Short type for the label under a zone ("3D", "Cl", "3DW", "Hy3D") when zones don't all share one. */
const TYPE_SHORT: Record<string, string> = { Classic: "Cl", Spike: "Sp" };
const typeShort = (t: string) => {
  const fan = lashHybridFan(t);
  return fan != null ? `Hy${fan.replace(/\s/g, "")}` : TYPE_SHORT[t] ?? t.replace(/\s/g, "");
};

/** Lash colour on the drawing. Other typed names go to the browser as CSS colour names ("teal"); one it doesn't know, like black (null), draws in the usual dark grey. */
const COLOR_STROKE: Record<string, string> = { Brown: "#8b5a2b", "Dark brown": "#4a2c17", Blue: "#2563eb", Purple: "#7c3aed", Red: "#dc2626", Pink: "#ec4899", Green: "#16a34a", White: "#d6d3d1" };
const strokeFor = (color: string | null | undefined) => (color ? (COLOR_STROKE[color] ?? color.toLowerCase().replace(/\s+/g, "")) : undefined);

export function LashMapDiagram({ zones: saved, selected, onSelect, mirror = false, className }: { zones: LashZone[]; selected?: LashSelection | null; onSelect?: (s: LashSelection) => void; mirror?: boolean; className?: string }) {
  const g = mirror ? GEO_MIRROR : GEO;
  const zones = normalizeLashZones(saved);
  const flatAll = allLashFlat(zones);
  const n = zones.length;
  const lashesPerZone = 6;
  const shared = sharedLashType(zones);
  const colors = lashColorSummary(zones);
  const isSel = (kind: LashSelection["kind"], i: number) => selected?.kind === kind && selected.i === i;
  return (
    <figure className={cn("w-full", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" role="img" aria-label={`Lash map, ${n} zones from inner to outer corner`}>
        <path d={`M${pt(bez(g.top, 0))} Q${g.top.c.join(",")} ${pt(bez(g.top, 1))} Q${g.bottom.c.join(",")} ${pt(bez(g.bottom, 0))} Z`} className="fill-stone-50 stroke-stone-300" strokeWidth={1.5} />
        {zones.map((z, i) => {
          const active = isSel("zone", i);
          // Labels sit under the lash tips; the two corner zones are narrow at the tip, so theirs move toward the wider side.
          const mid = (i + (i === 0 ? 0.68 : i === n - 1 ? 0.32 : 0.5)) / n;
          const [tx, ty] = bez(g.top, mid);
          const [bx, by] = bez(g.bottom, mid);
          const k = i === 0 || i === n - 1 ? 0.5 : 0.52;
          const lx = tx + (bx - tx) * k;
          const ly = ty + (by - ty) * k;
          const blank = z.length == null && z.curl == null && z.thickness == null && !z.type;
          // A flat zone's thickness reads ".15f" unless every zone is flat (then the caption says so once).
          const second = [z.curl, z.thickness != null ? `${formatLashThickness(z.thickness)}${z.flat && !flatAll ? "f" : ""}` : null, !shared && z.type ? typeShort(z.type) : null].filter(Boolean).join(" ");
          return (
            <g key={i} onClick={onSelect ? () => onSelect({ kind: "zone", i }) : undefined} className={onSelect ? "cursor-pointer" : undefined}>
              <path d={zonePath(g, i, n)} className={cn("stroke-stone-300 transition-colors", active ? "fill-brand-100" : "fill-transparent", onSelect && !active && "hover:fill-stone-100")} strokeWidth={1} />
              {Array.from({ length: lashesPerZone }, (_, j) => {
                const d = lashPath(g, (i + (j + 0.5) / lashesPerZone) / n, z.length ?? 0, z.curl);
                return d ? <path key={j} d={d} className="fill-none stroke-stone-700" style={{ stroke: strokeFor(z.color) }} strokeWidth={0.5 + (z.thickness ?? 0.07) * 8} strokeLinecap="round" opacity={z.color ? 0.85 : 0.6} /> : null;
              })}
              <text x={lx} y={ly} textAnchor="middle" className="pointer-events-none fill-stone-900 text-[15px] font-semibold tabular-nums" paintOrder="stroke" stroke="white" strokeWidth={4}>
                {blank ? i + 1 : z.length != null ? `${z.length}` : "–"}
              </text>
              {second ? (
                <text x={lx} y={ly + 14} textAnchor="middle" className="pointer-events-none fill-stone-600 text-[10.5px] tabular-nums" paintOrder="stroke" stroke="white" strokeWidth={3}>
                  {second}
                </text>
              ) : null}
            </g>
          );
        })}
        {/* Dividers: a spike is one bold lash on the line with its length above the lash line; in the editor an empty divider shows a +. */}
        {zones.slice(0, -1).map((z, i) => {
          const t = (i + 1) / n;
          const [x0, y0] = bez(g.top, t);
          const s = z.spike;
          if (!s && !onSelect) return null;
          const active = isSel("spike", i);
          const d = s ? lashPath(g, t, s.length ?? 0, s.curl) : null;
          return (
            <g key={`d${i}`} onClick={onSelect ? (e) => { e.stopPropagation(); onSelect({ kind: "spike", i }); } : undefined} className={onSelect ? "cursor-pointer" : undefined}>
              {onSelect ? <circle cx={x0} cy={y0 - 15} r={19} className="fill-transparent" /> : null}
              {d ? <path d={d} className={cn("fill-none", active ? "stroke-brand-600" : "stroke-stone-900")} style={active ? undefined : { stroke: strokeFor(s?.color) }} strokeWidth={1.6 + (s?.thickness ?? 0.07) * 10} strokeLinecap="round" /> : null}
              {s ? (
                <>
                  <rect x={x0 - 13} y={y0 - 24} width={26} height={16} rx={8} className={cn(active ? "fill-brand-600" : "fill-stone-800")} />
                  <text x={x0} y={y0 - 12.5} textAnchor="middle" className="pointer-events-none fill-white text-[11px] font-semibold tabular-nums">{s.length ?? "–"}</text>
                </>
              ) : (
                <>
                  <circle cx={x0} cy={y0 - 15} r={9} className={cn("fill-white", active ? "stroke-brand-600" : "stroke-stone-400")} strokeWidth={1.2} />
                  <path d={`M${f1(x0 - 4.5)},${f1(y0 - 15)} H${f1(x0 + 4.5)} M${f1(x0)},${f1(y0 - 19.5)} V${f1(y0 - 10.5)}`} className="stroke-stone-500" strokeWidth={1.4} />
                </>
              )}
            </g>
          );
        })}
        <text x={20} y={22} className="fill-stone-500 text-[11px]">{mirror ? "Outer corner" : "Inner corner"}</text>
        <text x={W - 20} y={22} textAnchor="end" className="fill-stone-500 text-[11px]">{mirror ? "Inner corner" : "Outer corner"}</text>
      </svg>
      {shared || colors || flatAll ? (
        <figcaption className="text-center text-xs text-stone-500">
          {[shared ? `${formatLashType(shared)} throughout` : null, flatAll ? (shared ? "all flat" : "Flat lashes throughout") : null, colors].filter(Boolean).join(" · ")}
        </figcaption>
      ) : null}
    </figure>
  );
}

function curlBend(curl: string | null): number {
  switch (curl) {
    case "J": case "B": return 0.04;
    case "C": return 0.1;
    case "CC": case "L": return 0.14;
    case "D": case "L+": case "M": return 0.18;
    case "DD": case "U": return 0.22;
    default: return 0.1;
  }
}

/**
 * A saved map for reading: one diagram for both eyes, or left above right when they differ (side by side they get too small to read),
 * the left eye mirrored so each inner corner sits toward the nose.
 */
export function LashMapEyes({ zones, rightZones, className }: { zones: LashZone[]; rightZones: LashZone[] | null; className?: string }) {
  if (!rightZones) return <LashMapDiagram zones={zones} className={className} />;
  return (
    <div className={cn("space-y-3", className)}>
      {([["Left eye", zones], ["Right eye", rightZones]] as const).map(([label, z]) => (
        <div key={label}>
          <p className="text-center text-xs font-medium text-stone-600">{label}</p>
          <LashMapDiagram zones={z} mirror={label === "Left eye"} />
        </div>
      ))}
    </div>
  );
}
