import { formatLashThickness, formatLashType, LASH_LENGTH_MAX, sharedLashType, type LashZone } from "@angelic/core";
import { cn } from "@/lib/utils";

/**
 * An eye patch drawn as a crescent: the top edge is the lash line, the patch is cut into zones from the inner corner (left) to the outer
 * corner (right), and each zone shows its lashes at their length and thickness. Spikes sit on the dividers as one bold lash with their
 * length above the lash line. Server-safe; the editor passes `selected`/`onSelect`, which also shows a + on each empty divider.
 */
export type LashSelection = { kind: "zone" | "spike"; i: number };

const W = 400;
const H = 200;
const TOP = { a: [24, 54], c: [200, 112], b: [376, 54] } as const; // lash line
const BOTTOM = { a: [24, 54], c: [200, 304], b: [376, 54] } as const; // lower edge of the patch
const DRAWN = 0.62; // the longest lash reaches this far down the patch

type P = readonly [number, number];
function bez(q: { a: P; c: P; b: P }, t: number): [number, number] {
  const u = 1 - t;
  return [u * u * q.a[0] + 2 * u * t * q.c[0] + t * t * q.b[0], u * u * q.a[1] + 2 * u * t * q.c[1] + t * t * q.b[1]];
}
const pt = (p: [number, number]) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
const f1 = (v: number) => v.toFixed(1);

function zonePath(i: number, n: number): string {
  const steps = 8;
  const top: string[] = [];
  const bottom: string[] = [];
  for (let s = 0; s <= steps; s++) {
    const t = (i + s / steps) / n;
    top.push(pt(bez(TOP, t)));
    bottom.unshift(pt(bez(BOTTOM, t)));
  }
  return `M${top.join(" L")} L${bottom.join(" L")} Z`;
}

/** A lash from the lash line at position t, drawn into the patch at its length and bent by its curl. */
function lashPath(t: number, length: number, curl: string | null): string | null {
  const frac = Math.min(1, length / (LASH_LENGTH_MAX + 2));
  if (!frac) return null;
  const [x0, y0] = bez(TOP, t);
  const [x1, y1] = bez(BOTTOM, t);
  const x2 = x0 + (x1 - x0) * frac * DRAWN;
  const y2 = y0 + (y1 - y0) * frac * DRAWN;
  // Curl bends the lash a little; tighter curls bend more.
  const bend = curlBend(curl) * Math.hypot(x2 - x0, y2 - y0);
  return `M${f1(x0)},${f1(y0)} Q${f1((x0 + x2) / 2 + bend)},${f1((y0 + y2) / 2)} ${f1(x2)},${f1(y2)}`;
}

/** Short type for the label under a zone ("3D", "Cl", "Hy") when zones don't all share one. */
const typeShort = (t: string) => (t === "Classic" ? "Cl" : t === "Hybrid" ? "Hy" : t);

export function LashMapDiagram({ zones, selected, onSelect, className }: { zones: LashZone[]; selected?: LashSelection | null; onSelect?: (s: LashSelection) => void; className?: string }) {
  const n = zones.length;
  const lashesPerZone = 6;
  const shared = sharedLashType(zones);
  const isSel = (kind: LashSelection["kind"], i: number) => selected?.kind === kind && selected.i === i;
  return (
    <figure className={cn("w-full", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" role="img" aria-label={`Lash map, ${n} zones from inner to outer corner`}>
        <path d={`M${pt(bez(TOP, 0))} Q${TOP.c.join(",")} ${pt(bez(TOP, 1))} Q${BOTTOM.c.join(",")} ${pt(bez(BOTTOM, 0))} Z`} className="fill-stone-50 stroke-stone-300" strokeWidth={1.5} />
        {zones.map((z, i) => {
          const active = isSel("zone", i);
          // Labels sit under the lash tips; the two corner zones are narrow at the tip, so theirs move toward the wider side.
          const mid = (i + (i === 0 ? 0.68 : i === n - 1 ? 0.32 : 0.5)) / n;
          const [tx, ty] = bez(TOP, mid);
          const [bx, by] = bez(BOTTOM, mid);
          const k = i === 0 || i === n - 1 ? 0.5 : 0.52;
          const lx = tx + (bx - tx) * k;
          const ly = ty + (by - ty) * k;
          const blank = z.length == null && z.curl == null && z.thickness == null && !z.type;
          const second = [z.curl, z.thickness != null ? formatLashThickness(z.thickness) : null, !shared && z.type ? typeShort(z.type) : null].filter(Boolean).join(" ");
          return (
            <g key={i} onClick={onSelect ? () => onSelect({ kind: "zone", i }) : undefined} className={onSelect ? "cursor-pointer" : undefined}>
              <path d={zonePath(i, n)} className={cn("stroke-stone-300 transition-colors", active ? "fill-brand-100" : "fill-transparent", onSelect && !active && "hover:fill-stone-100")} strokeWidth={1} />
              {Array.from({ length: lashesPerZone }, (_, j) => {
                const d = lashPath((i + (j + 0.5) / lashesPerZone) / n, z.length ?? 0, z.curl);
                return d ? <path key={j} d={d} className="fill-none stroke-stone-700" strokeWidth={0.5 + (z.thickness ?? 0.07) * 8} strokeLinecap="round" opacity={0.6} /> : null;
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
          const [x0, y0] = bez(TOP, t);
          const s = z.spike;
          if (!s && !onSelect) return null;
          const active = isSel("spike", i);
          const d = s ? lashPath(t, s.length ?? 0, s.curl) : null;
          return (
            <g key={`d${i}`} onClick={onSelect ? (e) => { e.stopPropagation(); onSelect({ kind: "spike", i }); } : undefined} className={onSelect ? "cursor-pointer" : undefined}>
              {onSelect ? <circle cx={x0} cy={y0 - 14} r={14} className="fill-transparent" /> : null}
              {d ? <path d={d} className={cn("fill-none", active ? "stroke-brand-600" : "stroke-stone-900")} strokeWidth={1.6 + (s?.thickness ?? 0.07) * 10} strokeLinecap="round" /> : null}
              {s ? (
                <>
                  <rect x={x0 - 13} y={y0 - 24} width={26} height={16} rx={8} className={cn(active ? "fill-brand-600" : "fill-stone-800")} />
                  <text x={x0} y={y0 - 12.5} textAnchor="middle" className="pointer-events-none fill-white text-[11px] font-semibold tabular-nums">{s.length ?? "–"}</text>
                </>
              ) : (
                <>
                  <circle cx={x0} cy={y0 - 14} r={7} className={cn("fill-white", active ? "stroke-brand-600" : "stroke-stone-300")} strokeWidth={1} />
                  <path d={`M${f1(x0 - 3.5)},${f1(y0 - 14)} H${f1(x0 + 3.5)} M${f1(x0)},${f1(y0 - 17.5)} V${f1(y0 - 10.5)}`} className="stroke-stone-400" strokeWidth={1.2} />
                </>
              )}
            </g>
          );
        })}
        <text x={20} y={22} className="fill-stone-500 text-[11px]">Inner corner</text>
        <text x={W - 20} y={22} textAnchor="end" className="fill-stone-500 text-[11px]">Outer corner</text>
      </svg>
      {shared ? <figcaption className="text-center text-xs text-stone-500">{formatLashType(shared)} throughout</figcaption> : null}
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
