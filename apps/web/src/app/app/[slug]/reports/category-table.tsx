"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type CategoryLine = {
  id: string;
  name: string;
  count: number;
  revenue: string;
  share: number;
  /** Already formatted, e.g. "+13%", "new" or "—". */
  change: string;
  tone: "up" | "down" | "flat";
  children: CategoryLine[];
};

/** Revenue by service category with collapsible parents; everything starts open. */
export function CategoryTable({ rows, total, periodLabel }: { rows: CategoryLine[]; total: { count: number; revenue: string }; periodLabel: string }) {
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => setClosed((c) => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const tone = { up: "text-emerald-700", down: "text-red-700", flat: "text-stone-400" };

  const line = (r: CategoryLine, depth: number) => {
    const expandable = depth === 0 && r.children.length > 1;
    const open = !closed.has(r.id);
    return (
      <tr key={`${depth}:${r.id}`} className={cn(depth ? "text-stone-600" : "font-medium", expandable && "cursor-pointer hover:bg-stone-50")} onClick={expandable ? () => toggle(r.id) : undefined}>
        <td className="px-4 py-2" style={{ paddingLeft: `${1 + depth * 1.25}rem` }}>
          {expandable ? (
            <button type="button" onClick={(e) => { e.stopPropagation(); toggle(r.id); }} aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${r.name}`} className="-ml-1 mr-1 inline-flex h-5 w-5 items-center justify-center rounded text-stone-500 hover:bg-stone-200 align-middle">
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          ) : depth ? (
            <span className="text-stone-400">› </span>
          ) : (
            <span className="mr-1 inline-block w-5" />
          )}
          {r.name}
          {expandable && !open ? <span className="ml-1.5 text-xs font-normal text-stone-500">{r.children.length} sub-categories</span> : null}
        </td>
        <td className="px-4 py-2 text-right tabular-nums">{r.count}</td>
        <td className="px-4 py-2 text-right tabular-nums">{r.revenue}</td>
        <td className="px-4 py-2 text-right tabular-nums">{r.share.toFixed(0)}%</td>
        <td className={cn("px-4 py-2 text-right text-xs tabular-nums", tone[r.tone])}>{r.change}</td>
        <td className="px-4 py-2"><div className="h-2 w-full rounded bg-stone-100"><div className={cn("h-2 rounded", depth ? "bg-brand-300" : "bg-brand-500")} style={{ width: `${Math.min(100, r.share)}%` }} /></div></td>
      </tr>
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-stone-500">
          <tr><th className="px-4 py-2">Category</th><th className="px-4 py-2 text-right">Services</th><th className="px-4 py-2 text-right">Revenue</th><th className="px-4 py-2 text-right">Share</th><th className="px-4 py-2 text-right">vs {periodLabel}</th><th className="w-1/4 px-4 py-2"><span className="sr-only">Share bar</span></th></tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.flatMap((t) => [line(t, 0), ...(t.children.length > 1 && !closed.has(t.id) ? t.children.map((c) => line(c, 1)) : [])])}
        </tbody>
        <tfoot className="border-t border-stone-200 text-sm font-semibold">
          <tr><td className="px-4 py-2"><span className="mr-1 inline-block w-5" />All services</td><td className="px-4 py-2 text-right tabular-nums">{total.count}</td><td className="px-4 py-2 text-right tabular-nums">{total.revenue}</td><td className="px-4 py-2 text-right">100%</td><td colSpan={2} /></tr>
        </tfoot>
      </table>
    </div>
  );
}
