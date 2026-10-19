"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type CategoryLine = {
  id: string;
  name: string;
  count: number;
  /** Paid at the visit, formatted. */
  services: string;
  /** Package and membership sessions used, at their value, formatted. */
  prepaid: string;
  total: string;
  share: number;
  /** Already formatted, e.g. "+13%", "new" or "—". */
  change: string;
  tone: "up" | "down" | "flat";
  /** Commission Payroll credits on these lines, and total less that; only for people who can see pay. */
  pay?: string;
  profit?: string;
  children: CategoryLine[];
};

export type CategoryTotals = { count: number; services: string; prepaid: string; total: string; pay?: string; profit?: string };

/** Revenue by service category with collapsible parents; everything starts open. Pay columns show when the totals carry them. */
export function CategoryTable({ rows, total, periodLabel }: { rows: CategoryLine[]; total: CategoryTotals; periodLabel: string }) {
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => setClosed((c) => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const tone = { up: "text-emerald-700", down: "text-red-700", flat: "text-stone-400" };
  const withPay = total.pay !== undefined;
  const num = "px-3 py-2 text-right tabular-nums";

  const line = (r: CategoryLine, depth: number) => {
    const expandable = depth === 0 && r.children.length > 1;
    const open = !closed.has(r.id);
    return (
      <tr key={`${depth}:${r.id}`} className={cn(depth ? "text-stone-600" : "font-medium", expandable && "cursor-pointer hover:bg-stone-50")} onClick={expandable ? () => toggle(r.id) : undefined}>
        <td className="whitespace-nowrap py-2 pl-4 pr-3" style={{ paddingLeft: `${1 + depth * 1.25}rem` }}>
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
        <td className={num}>{r.count}</td>
        <td className={num}>{r.services}</td>
        <td className={num}>{r.prepaid}</td>
        <td className={cn(num, "font-medium")}>{r.total}</td>
        <td className={num}>{r.share.toFixed(0)}%</td>
        <td className={cn(num, "text-xs", tone[r.tone])}>{r.change}</td>
        {withPay ? <><td className={num}>{r.pay}</td><td className={num}>{r.profit}</td></> : null}
        <td className="px-3 py-2"><div className="h-2 w-full min-w-16 rounded bg-stone-100"><div className={cn("h-2 rounded", depth ? "bg-brand-300" : "bg-brand-500")} style={{ width: `${Math.min(100, r.share)}%` }} /></div></td>
      </tr>
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-stone-500">
          <tr>
            <th className="py-2 pl-4 pr-3">Category</th>
            <th className="px-3 py-2 text-right">Qty</th>
            <th className="px-3 py-2 text-right">Services</th>
            <th className="px-3 py-2 text-right">From packages &amp; memberships</th>
            <th className="px-3 py-2 text-right">Total</th>
            <th className="px-3 py-2 text-right">Share</th>
            <th className="whitespace-nowrap px-3 py-2 text-right">vs {periodLabel}</th>
            {withPay ? <><th className="px-3 py-2 text-right">Provider pay</th><th className="px-3 py-2 text-right">Profit</th></> : null}
            <th className="w-1/6 px-3 py-2"><span className="sr-only">Share bar</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.flatMap((t) => [line(t, 0), ...(t.children.length > 1 && !closed.has(t.id) ? t.children.map((c) => line(c, 1)) : [])])}
        </tbody>
        <tfoot className="border-t border-stone-200 text-sm font-semibold">
          <tr>
            <td className="whitespace-nowrap py-2 pl-4 pr-3"><span className="mr-1 inline-block w-5" />All services</td>
            <td className={num}>{total.count}</td>
            <td className={num}>{total.services}</td>
            <td className={num}>{total.prepaid}</td>
            <td className={num}>{total.total}</td>
            <td className={num}>100%</td>
            <td />
            {withPay ? <><td className={num}>{total.pay}</td><td className={num}>{total.profit}</td></> : null}
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
