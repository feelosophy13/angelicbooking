"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TZDate } from "@date-fns/tz";
import { cn } from "@/lib/utils";
import { moveAppointmentItem } from "./actions";

export type CalColumn = { key: string; label: string; color?: string; date: string; staffId: string | null; isToday?: boolean };
export type CalItem = {
  id: string;
  appointmentId: string;
  staffId: string;
  columnKey: string;
  startMin: number;
  endMin: number;
  title: string;
  subtitle: string;
  status: string;
  color: string;
  href: string;
  /** Segments of a multi-part service share a group key so they render as one card. */
  groupKey: string;
};

const DAY_START_H = 7;
const DAY_END_H = 21;
const PX_PER_MIN = 1.2;
const LOCKED = new Set(["completed", "cancelled", "no_show"]);

const STATUS: Record<string, string> = {
  booked: "bg-brand-100 text-brand-900",
  confirmed: "bg-sky-100 text-sky-900",
  checked_in: "bg-amber-100 text-amber-900",
  in_progress: "bg-orange-100 text-orange-900",
  completed: "bg-emerald-100 text-emerald-900",
  no_show: "bg-stone-100 text-stone-500 line-through",
  cancelled: "bg-stone-100 text-stone-400 line-through",
};

function fmt(min: number) {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

function instantISO(date: string, minutes: number, tz: string) {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(new TZDate(y!, mo! - 1, d!, Math.floor(minutes / 60), minutes % 60, 0, 0, tz).getTime()).toISOString();
}

/** One rendered card = all segments of a service, with gaps between them drawn hatched. */
type Card = { key: string; first: CalItem; startMin: number; endMin: number; gaps: { from: number; to: number }[] };
function groupCards(items: CalItem[]): Card[] {
  const byKey = new Map<string, CalItem[]>();
  for (const i of items) byKey.set(i.groupKey, [...(byKey.get(i.groupKey) ?? []), i]);
  return [...byKey.values()].map((segs) => {
    segs.sort((a, b) => a.startMin - b.startMin);
    const gaps: { from: number; to: number }[] = [];
    for (let k = 1; k < segs.length; k++) if (segs[k]!.startMin > segs[k - 1]!.endMin) gaps.push({ from: segs[k - 1]!.endMin, to: segs[k]!.startMin });
    return { key: segs[0]!.groupKey, first: segs[0]!, startMin: segs[0]!.startMin, endMin: segs[segs.length - 1]!.endMin, gaps };
  });
}

type Drag = { key: string; originX: number; originY: number; dx: number; dy: number; moved: boolean };

function useNowMinutes(tz: string) {
  const calc = () => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date());
    return (Number(p.find((x) => x.type === "hour")!.value) % 24) * 60 + Number(p.find((x) => x.type === "minute")!.value);
  };
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(calc());
    const t = setInterval(() => setNow(calc()), 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tz]);
  return now;
}

export function CalendarGrid(props: {
  slug: string;
  timeZone: string;
  view: "day" | "week";
  columns: CalColumn[];
  items: CalItem[];
  slotIntervalMin: number;
  canEdit: boolean;
  todayISO: string;
}) {
  const { columns, items, slotIntervalMin } = props;
  const router = useRouter();
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const colWidth = useRef(0);
  const nowMin = useNowMinutes(props.timeZone);
  const scrollRef = useRef<HTMLDivElement>(null);

  const totalMin = (DAY_END_H - DAY_START_H) * 60;
  const hours = Array.from({ length: DAY_END_H - DAY_START_H + 1 }, (_, i) => DAY_START_H + i);
  const top = (min: number) => (min - DAY_START_H * 60) * PX_PER_MIN;
  const snap = (dyPx: number) => Math.round(dyPx / PX_PER_MIN / slotIntervalMin) * slotIntervalMin;
  const cardsByCol = useMemo(() => {
    const m = new Map<string, Card[]>();
    for (const c of columns) m.set(c.key, groupCards(items.filter((i) => i.columnKey === c.key)));
    return m;
  }, [columns, items]);

  // Scroll so the working day (or now) is in view on first paint.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = nowMin != null && nowMin > DAY_START_H * 60 ? top(nowMin) - 120 : top(8 * 60);
    el.scrollTop = Math.max(0, target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowMin == null]);

  function finishDrag() {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    const card = [...cardsByCol.values()].flat().find((c) => c.key === d.key);
    if (!card) return;
    if (!d.moved) {
      router.push(card.first.href);
      return;
    }
    const deltaMin = snap(d.dy);
    const colShift = colWidth.current ? Math.round(d.dx / colWidth.current) : 0;
    const fromIdx = columns.findIndex((c) => c.key === card.first.columnKey);
    const toIdx = Math.min(columns.length - 1, Math.max(0, fromIdx + colShift));
    const target = columns[toIdx]!;
    const newStart = card.startMin + deltaMin;
    if (newStart < 0 || newStart + (card.endMin - card.startMin) > 24 * 60) return;
    if (deltaMin === 0 && toIdx === fromIdx) return;
    setError(null);
    startTransition(async () => {
      const res = await moveAppointmentItem({ slug: props.slug, itemId: card.first.id, newStartISO: instantISO(target.date, newStart, props.timeZone), newStaffId: props.view === "day" ? target.staffId : null });
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const next = { ...d, dx: e.clientX - d.originX, dy: e.clientY - d.originY, moved: d.moved || Math.hypot(e.clientX - d.originX, e.clientY - d.originY) > 4 };
      dragRef.current = next;
      setDrag(next);
    };
    const onUp = () => finishDrag();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.key]);

  function onPointerDown(e: React.PointerEvent, card: Card) {
    if (e.button !== 0) return;
    e.preventDefault();
    colWidth.current = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect().width;
    const d: Drag = { key: card.key, originX: e.clientX, originY: e.clientY, dx: 0, dy: 0, moved: false };
    dragRef.current = d;
    setDrag(d);
  }

  const quarterLines = Array.from({ length: totalMin / 15 + 1 }, (_, i) => DAY_START_H * 60 + i * 15);

  return (
    <div className="space-y-2">
      {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

      {/* Phone: agenda list */}
      <div className="space-y-4 md:hidden">
        {columns.map((c) => {
          const cards = (cardsByCol.get(c.key) ?? []).sort((a, b) => a.startMin - b.startMin);
          return (
            <section key={c.key}>
              <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-stone-700">
                {c.color ? <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} /> : null}
                {c.label}
              </h3>
              {cards.length === 0 ? <p className="rounded-lg border border-dashed border-stone-200 px-3 py-2 text-xs text-stone-400">Nothing booked</p> : (
                <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white">
                  {cards.map((card) => (
                    <li key={card.key}>
                      <button onClick={() => router.push(card.first.href)} className="flex w-full items-center gap-3 px-3 py-2 text-left">
                        <span className="w-16 shrink-0 text-xs text-stone-500">{fmt(card.startMin)}</span>
                        <span className="h-8 w-1 rounded-full" style={{ background: card.first.color }} />
                        <span className="min-w-0 flex-1">
                          <span className={cn("block truncate text-sm font-medium", LOCKED.has(card.first.status) && card.first.status !== "completed" && "text-stone-400 line-through")}>{card.first.title}</span>
                          <span className="block truncate text-xs text-stone-500">{card.first.subtitle} · {fmt(card.startMin)}–{fmt(card.endMin)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {/* Desktop: time grid */}
      <div ref={scrollRef} className={cn("hidden max-h-[calc(100vh-13rem)] overflow-auto rounded-xl border border-stone-200 bg-white md:block", pending && "opacity-60")}>
        <div className="grid min-w-[640px] select-none" style={{ gridTemplateColumns: `56px repeat(${columns.length}, minmax(${props.view === "week" ? 120 : 160}px, 1fr))` }}>
          <div className="sticky top-0 z-20 border-b border-stone-200 bg-white" />
          {columns.map((c) => (
            <div key={c.key} className={cn("sticky top-0 z-20 flex items-center gap-2 border-b border-l border-stone-200 bg-white px-3 py-2 text-sm font-medium", c.isToday && "text-brand-700")}>
              {c.color ? <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} /> : null}
              {c.label}
              {c.isToday ? <span className="ml-1 rounded bg-brand-100 px-1 text-[10px] font-semibold uppercase text-brand-700">Today</span> : null}
            </div>
          ))}

          <div className="relative" style={{ height: totalMin * PX_PER_MIN }}>
            {hours.map((h) => (
              <div key={h} className="absolute right-2 -translate-y-1/2 text-[11px] text-stone-400" style={{ top: top(h * 60) }}>{fmt(h * 60).replace(":00", "")}</div>
            ))}
          </div>

          {columns.map((c) => {
            const showNow = nowMin != null && c.date === props.todayISO && nowMin >= DAY_START_H * 60 && nowMin <= DAY_END_H * 60;
            return (
              <div key={c.key} className={cn("relative border-l border-stone-200", c.isToday && "bg-brand-50/30")} style={{ height: totalMin * PX_PER_MIN }}>
                {quarterLines.map((m) => (
                  <div key={m} className={cn("absolute inset-x-0 border-t", m % 60 === 0 ? "border-stone-200" : m % 30 === 0 ? "border-stone-100" : "border-stone-50")} style={{ top: top(m) }} />
                ))}
                {showNow ? (
                  <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: top(nowMin!) }}>
                    <span className="-ml-1 h-2 w-2 rounded-full bg-red-500" />
                    <span className="h-px flex-1 bg-red-500" />
                  </div>
                ) : null}
                {(cardsByCol.get(c.key) ?? []).map((card) => {
                  const dragging = drag?.key === card.key && drag.moved;
                  const dyMin = dragging ? snap(drag.dy) : 0;
                  const draggable = props.canEdit && !LOCKED.has(card.first.status);
                  const height = Math.max(22, (card.endMin - card.startMin) * PX_PER_MIN - 2);
                  return (
                    <div
                      key={card.key}
                      role="button"
                      tabIndex={0}
                      onPointerDown={draggable ? (e) => onPointerDown(e, card) : undefined}
                      onClick={!draggable ? () => router.push(card.first.href) : undefined}
                      onKeyDown={(e) => e.key === "Enter" && router.push(card.first.href)}
                      title={`${card.first.title} · ${card.first.subtitle} · ${fmt(card.startMin)}–${fmt(card.endMin)}`}
                      className={cn("group absolute inset-x-1 overflow-hidden rounded-md border-l-4 text-xs shadow-sm", STATUS[card.first.status], draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer", dragging && "z-30 ring-2 ring-brand-500 shadow-lg")}
                      style={{ top: top(card.startMin), height, borderLeftColor: card.first.color, transform: dragging ? `translate(${drag.dx}px, ${dyMin * PX_PER_MIN}px)` : undefined }}
                    >
                      {card.gaps.map((g, i) => (
                        <div key={i} className="pointer-events-none absolute inset-x-0 bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(255,255,255,0.55)_6px_12px)]" style={{ top: (g.from - card.startMin) * PX_PER_MIN, height: (g.to - g.from) * PX_PER_MIN }}>
                          <span className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-wide opacity-60">processing</span>
                        </div>
                      ))}
                      <div className="px-2 py-1 leading-tight">
                        <div className="truncate font-semibold">{card.first.title}</div>
                        <div className="truncate">{card.first.subtitle}</div>
                        {height > 44 ? <div className="truncate opacity-70">{fmt(card.startMin + dyMin)} – {fmt(card.endMin + dyMin)}</div> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {props.canEdit ? <p className="hidden text-xs text-stone-500 md:block">Drag an appointment to move it. Click to open it.</p> : null}
    </div>
  );
}
