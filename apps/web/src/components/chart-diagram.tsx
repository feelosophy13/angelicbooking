"use client";
import { useRef } from "react";
import { X } from "lucide-react";
import { CHART_MAX_MARKS, type ChartDiagram, type ChartMark } from "@angelic/core";
import { Input } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * The face and body pictures a chart marks areas on. Marks are stored as percentages of the picture, so they land in the same place at
 * any size, on screen and on the print copy. Tap the picture to add a numbered mark; each mark gets a short note in the list below it.
 */
const BOX: Record<ChartDiagram, { w: number; h: number }> = { face: { w: 200, h: 250 }, body: { w: 260, h: 290 } };

/** One standing figure (viewBox 120 × 280), drawn from its left half mirrored, at horizontal offset `dx`. */
function figure(dx: number) {
  const half: [number, number][] = [
    [54, 38], [54, 48], [40, 52], [30, 58], [26, 72], [24, 96], [20, 124], [16, 150], [14, 160], [18, 166], [22, 160], [26, 138], [30, 112], [34, 84],
    [36, 100], [36, 124], [34, 150], [34, 180], [36, 214], [38, 246], [38, 262], [32, 272], [50, 272], [50, 262], [52, 232], [54, 200], [58, 170],
  ];
  const pts = [...half, [60, 166] as [number, number], ...[...half].reverse().map(([x, y]) => [120 - x, y] as [number, number])];
  return `M${pts.map(([x, y]) => `${x + dx},${y}`).join(" L")} Z`;
}

function Art({ kind }: { kind: ChartDiagram }) {
  const line = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "body") {
    return (
      <g className="text-stone-400">
        {[10, 130].map((dx) => (
          <g key={dx}>
            <ellipse cx={60 + dx} cy={22} rx={13} ry={16} {...line} />
            <path d={figure(dx)} {...line} />
          </g>
        ))}
        <text x={70} y={287} textAnchor="middle" className="fill-stone-500 text-[9px]">Front</text>
        <text x={190} y={287} textAnchor="middle" className="fill-stone-500 text-[9px]">Back</text>
        {/* The back view: a spine line, so the two figures are told apart at a glance. */}
        <path d="M190,50 L190,160" {...line} strokeDasharray="3 4" />
      </g>
    );
  }
  return (
    <g className="text-stone-400">
      <path d="M100,25 C150,25 172,70 170,120 C168,175 140,225 100,228 C60,225 32,175 30,120 C28,70 50,25 100,25 Z" {...line} />
      <path d="M31,108 C20,108 18,140 32,150 M169,108 C180,108 182,140 168,150" {...line} />
      <path d="M55,92 Q72,82 90,90 M110,90 Q128,82 145,92" {...line} />
      <path d="M58,110 Q73,100 88,110 Q73,118 58,110 Z M112,110 Q127,100 142,110 Q127,118 112,110 Z" {...line} />
      <path d="M100,112 L94,150 Q100,156 106,150" {...line} />
      <path d="M78,178 Q100,170 122,178 Q100,194 78,178 Z M78,178 Q100,182 122,178" {...line} />
    </g>
  );
}

function Marks({ kind, marks }: { kind: ChartDiagram; marks: ChartMark[] }) {
  const { w, h } = BOX[kind];
  return (
    <>
      {marks.map((m, i) => (
        <g key={i} transform={`translate(${(m.x / 100) * w},${(m.y / 100) * h})`}>
          <circle r={7} className="fill-brand-600" />
          <text y={3} textAnchor="middle" className="fill-white text-[9px] font-semibold">{i + 1}</text>
        </g>
      ))}
    </>
  );
}

/** The picture with its marks and their notes, read-only (chart page, print copy, last-visit reference). */
export function ChartDiagramView({ kind, marks, className }: { kind: ChartDiagram; marks: ChartMark[]; className?: string }) {
  const { w, h } = BOX[kind];
  return (
    <div className={cn("grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr]", className)}>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-56" role="img" aria-label={`${kind === "face" ? "Face" : "Body"} diagram with ${marks.length} mark${marks.length === 1 ? "" : "s"}`}>
        <Art kind={kind} />
        <Marks kind={kind} marks={marks} />
      </svg>
      {marks.length ? (
        <ol className="space-y-1 text-sm">
          {marks.map((m, i) => <li key={i}><span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-[11px] font-semibold text-white">{i + 1}</span>{m.note || <span className="text-stone-400">No note</span>}</li>)}
        </ol>
      ) : <p className="text-sm text-stone-500">No areas marked.</p>}
    </div>
  );
}

/** Tap to mark, type a note for each, × to remove. Posts the marks as JSON under `name`. */
export function ChartDiagramField({ kind, name, marks, onChange }: { kind: ChartDiagram; name?: string; marks: ChartMark[]; onChange: (marks: ChartMark[]) => void }) {
  const { w, h } = BOX[kind];
  const svg = useRef<SVGSVGElement>(null);
  const add = (e: React.PointerEvent<SVGSVGElement>) => {
    if (marks.length >= CHART_MAX_MARKS || !svg.current) return;
    const r = svg.current.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * 1000) / 10;
    const y = Math.round(((e.clientY - r.top) / r.height) * 1000) / 10;
    onChange([...marks, { x, y }]);
  };
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_1fr]">
      {name ? <input type="hidden" name={name} value={JSON.stringify(marks)} /> : null}
      <div>
        <svg ref={svg} viewBox={`0 0 ${w} ${h}`} onPointerUp={add} className="w-full max-w-64 cursor-crosshair touch-manipulation rounded-lg border border-stone-200 bg-stone-50" role="img" aria-label={`${kind === "face" ? "Face" : "Body"} diagram: tap to mark an area`}>
          <Art kind={kind} />
          <Marks kind={kind} marks={marks} />
        </svg>
        <p className="mt-1 text-xs text-stone-500">Tap the picture to mark an area.</p>
      </div>
      {marks.length ? (
        <ol className="space-y-2">
          {marks.map((m, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">{i + 1}</span>
              <Input value={m.note ?? ""} onChange={(e) => onChange(marks.map((x, k) => (k === i ? { ...x, note: e.target.value.slice(0, 200) } : x)))} placeholder="What's here (e.g. congestion, knot, numbing)" aria-label={`Note for mark ${i + 1}`} />
              <button type="button" onClick={() => onChange(marks.filter((_, k) => k !== i))} aria-label={`Remove mark ${i + 1}`} className="hit shrink-0 rounded-lg p-2 text-stone-400 hover:bg-stone-100 hover:text-red-600"><X className="h-4 w-4" /></button>
            </li>
          ))}
        </ol>
      ) : <p className="self-center text-sm text-stone-500">No areas marked yet.</p>}
    </div>
  );
}
