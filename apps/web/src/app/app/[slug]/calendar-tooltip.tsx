"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import type { CalTip } from "@/lib/calendar-tip";
import { phone } from "@/lib/format";

export type AnchorRect = { left: number; right: number; top: number; bottom: number };
const WIDTH = 288;

/**
 * The hover card for a calendar appointment: who, what, when, how much and anything the team should know.
 * Drawn on the page (not inside the scrolling grid) so it is never clipped, beside the appointment, and
 * it ignores the pointer so it can never get in the way of dragging or clicking.
 */
export function CalendarTip({ tip, anchor, fmt }: { tip: CalTip; anchor: AnchorRect; fmt: (min: number) => string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Beside the appointment: to its right if there is room, else to its left; level with its top, kept on screen.
    let left = anchor.right + 8;
    if (left + WIDTH > vw - 8) left = Math.max(8, anchor.left - WIDTH - 8);
    const top = Math.min(Math.max(8, anchor.top), Math.max(8, vh - el.offsetHeight - 8));
    setPos({ left, top });
  }, [anchor, tip]);

  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      style={{ position: "fixed", left: pos?.left ?? -9999, top: pos?.top ?? 0, width: WIDTH, opacity: pos ? 1 : 0 }}
      className="pointer-events-none z-50 rounded-xl border border-stone-200 bg-white p-3 text-xs text-stone-700 shadow-xl"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-stone-900">{tip.heading}</p>
          {tip.sub ? <p className="text-stone-500">{phone(tip.sub)}</p> : null}
        </div>
        <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-700">{tip.status}</span>
      </div>
      {tip.tags.length ? (
        <p className="mt-1.5 flex flex-wrap gap-1">{tip.tags.map((t) => <span key={t} className="rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700">{t}</span>)}</p>
      ) : null}
      <ul className="mt-2 space-y-1.5 border-t border-stone-100 pt-2">
        {tip.lines.map((l, i) => (
          <li key={i} className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block font-medium text-stone-900">{l.service}</span>
              <span className="block text-stone-500">{fmt(l.startMin)} – {fmt(l.endMin)}{l.staff ? ` · ${l.staff}` : ""}</span>
            </span>
            {l.price ? <span className="shrink-0 tabular-nums text-stone-700">{l.price}</span> : null}
          </li>
        ))}
        {tip.total ? <li className="flex justify-between border-t border-stone-100 pt-1.5 font-medium text-stone-900"><span>Total</span><span className="tabular-nums">{tip.total}</span></li> : null}
      </ul>
      {tip.facts.length ? (
        <p className="mt-2 flex flex-wrap gap-1">{tip.facts.map((f) => <span key={f} className={cn("rounded px-1.5 py-0.5 text-[11px]", f === "Forms due" ? "bg-amber-100 font-medium text-amber-900" : "bg-stone-100 text-stone-600")}>{f}</span>)}</p>
      ) : null}
      {tip.notes ? <p className="mt-2 border-l-2 border-stone-200 pl-2 italic text-stone-600">{tip.notes}</p> : null}
    </div>,
    document.body,
  );
}
