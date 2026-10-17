import { formatLashThickness, LASH_LENGTH_MAX, type LashZone } from "@angelic/core";
import { cn } from "@/lib/utils";

/**
 * An eye patch drawn as a crescent: the top edge is the lash line, the patch is cut into zones from the inner corner (left) to the outer
 * corner (right), and each zone shows its lashes at their length and thickness. Server-safe; the editor passes `selected`/`onSelect`.
 */
const W = 400;
const H = 200;
const TOP = { a: [24, 54], c: [200, 112], b: [376, 54] } as const; // lash line
const BOTTOM = { a: [24, 54], c: [200, 304], b: [376, 54] } as const; // lower edge of the patch

type P = readonly [number, number];
function bez(q: { a: P; c: P; b: P }, t: number): [number, number] {
  const u = 1 - t;
  return [u * u * q.a[0] + 2 * u * t * q.c[0] + t * t * q.b[0], u * u * q.a[1] + 2 * u * t * q.c[1] + t * t * q.b[1]];
}
const pt = (p: [number, number]) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;

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

export function LashMapDiagram({ zones, selected, onSelect, className }: { zones: LashZone[]; selected?: number | null; onSelect?: (i: number) => void; className?: string }) {
  const n = zones.length;
  const lashesPerZone = 6;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("w-full select-none", className)} role="img" aria-label={`Lash map, ${n} zones from inner to outer corner`}>
      <path d={`M${pt(bez(TOP, 0))} Q${TOP.c.join(",")} ${pt(bez(TOP, 1))} Q${BOTTOM.c.join(",")} ${pt(bez(BOTTOM, 0))} Z`} className="fill-stone-50 stroke-stone-300" strokeWidth={1.5} />
      {zones.map((z, i) => {
        const active = selected === i;
        // Labels sit under the lash tips; the two corner zones are narrow at the tip, so theirs move toward the wider side.
        const mid = (i + (i === 0 ? 0.68 : i === n - 1 ? 0.32 : 0.5)) / n;
        const [tx, ty] = bez(TOP, mid);
        const [bx, by] = bez(BOTTOM, mid);
        const k = i === 0 || i === n - 1 ? 0.5 : 0.52;
        const lx = tx + (bx - tx) * k;
        const ly = ty + (by - ty) * k;
        const blank = z.length == null && z.curl == null && z.thickness == null;
        return (
          <g key={i} onClick={onSelect ? () => onSelect(i) : undefined} className={onSelect ? "cursor-pointer" : undefined}>
            <path d={zonePath(i, n)} className={cn("stroke-stone-300 transition-colors", active ? "fill-brand-100" : "fill-transparent", onSelect && !active && "hover:fill-stone-100")} strokeWidth={1} />
            {Array.from({ length: lashesPerZone }, (_, j) => {
              const t = (i + (j + 0.5) / lashesPerZone) / n;
              const [x0, y0] = bez(TOP, t);
              const [x1, y1] = bez(BOTTOM, t);
              const frac = Math.min(1, (z.length ?? 0) / (LASH_LENGTH_MAX + 2));
              if (!frac) return null;
              const x2 = x0 + (x1 - x0) * frac * 0.62;
              const y2 = y0 + (y1 - y0) * frac * 0.62;
              // Curl bends the lash toward the outer corner a little; tighter curls bend more.
              const bend = curlBend(z.curl) * Math.hypot(x2 - x0, y2 - y0);
              const cx = (x0 + x2) / 2 + bend;
              const cy = (y0 + y2) / 2;
              return <path key={j} d={`M${x0.toFixed(1)},${y0.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`} className="fill-none stroke-stone-700" strokeWidth={0.5 + (z.thickness ?? 0.07) * 8} strokeLinecap="round" opacity={0.6} />;
            })}
            <text x={lx} y={ly} textAnchor="middle" className="pointer-events-none fill-stone-900 text-[15px] font-semibold tabular-nums" paintOrder="stroke" stroke="white" strokeWidth={4}>
              {blank ? i + 1 : z.length != null ? `${z.length}` : "–"}
            </text>
            {!blank ? (
              <text x={lx} y={ly + 14} textAnchor="middle" className="pointer-events-none fill-stone-600 text-[10.5px] tabular-nums" paintOrder="stroke" stroke="white" strokeWidth={3}>
                {[z.curl, z.thickness != null ? formatLashThickness(z.thickness) : null].filter(Boolean).join(" ")}
              </text>
            ) : null}
          </g>
        );
      })}
      <text x={20} y={30} className="fill-stone-500 text-[11px]">Inner corner</text>
      <text x={W - 20} y={30} textAnchor="end" className="fill-stone-500 text-[11px]">Outer corner</text>
    </svg>
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
