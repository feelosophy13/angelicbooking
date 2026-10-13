"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TZDate } from "@date-fns/tz";
import { cn } from "@/lib/utils";
import { moveAppointmentItem, quickStatus } from "./actions";
import { Check, LogIn } from "lucide-react";
import type { CalTip } from "@/lib/calendar-tip";
import { CalendarTip, type AnchorRect } from "./calendar-tooltip";

export type CalColumn = {
  key: string;
  label: string;
  color?: string;
  date: string;
  staffId: string | null;
  isToday?: boolean;
  /** Working time in grid minutes. Omitted = unknown (no shading); [] = off that day. */
  working?: { startMin: number; endMin: number }[];
};
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
  /** What the hover card shows. */
  tip: CalTip;
};

const DEFAULT_START_H = 7;
const DEFAULT_END_H = 21;
const PX_PER_MIN = 1.2;
const LOCKED = new Set(["completed", "cancelled", "no_show", "class"]);
const GREYED = new Set(["cancelled", "no_show", "block"]);

const STATUS: Record<string, string> = {
  booked: "bg-brand-100 text-brand-900",
  confirmed: "bg-sky-100 text-sky-900",
  checked_in: "bg-amber-100 text-amber-900",
  in_progress: "bg-orange-100 text-orange-900",
  completed: "bg-emerald-100 text-emerald-900",
  no_show: "bg-stone-100 text-stone-500 line-through",
  cancelled: "bg-stone-100 text-stone-400 line-through",
  class: "bg-violet-100 text-violet-900",
  block: "bg-stone-200 text-stone-700 bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(255,255,255,0.5)_6px_12px)]",
};

/** The parts of [gridStart, gridEnd) not covered by any working block. */
function offBlocks(working: { startMin: number; endMin: number }[], gridStart: number, gridEnd: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let cursor = gridStart;
  for (const w of [...working].sort((a, b) => a.startMin - b.startMin)) {
    if (w.startMin > cursor) out.push({ from: cursor, to: Math.min(w.startMin, gridEnd) });
    cursor = Math.max(cursor, w.endMin);
  }
  if (cursor < gridEnd) out.push({ from: cursor, to: gridEnd });
  return out.filter((b) => b.to > b.from);
}

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

/**
 * Side-by-side lanes for cards that overlap in time (double bookings, a class
 * next to a visit): cards in one overlapping cluster share the width equally.
 */
function layoutLanes(cards: Card[]): Map<string, { lane: number; lanes: number }> {
  const out = new Map<string, { lane: number; lanes: number }>();
  const sorted = [...cards].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  let cluster: Card[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const c of cluster) out.set(c.key, { lane: out.get(c.key)!.lane, lanes: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };
  for (const c of sorted) {
    if (cluster.length && c.startMin >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= c.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(c.endMin);
    } else laneEnds[lane] = c.endMin;
    out.set(c.key, { lane, lanes: 1 });
    cluster.push(c);
    clusterEnd = Math.max(clusterEnd, c.endMin);
  }
  if (cluster.length) flush();
  return out;
}

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
  /** Week overview of everyone: appointments are plain coloured blocks with no text; hover or click shows the rest. */
  overview?: boolean;
  columns: CalColumn[];
  items: CalItem[];
  slotIntervalMin: number;
  canEdit: boolean;
  todayISO: string;
  /** Grid range in hours; the page widens it to fit early/late hours and bookings. */
  startHour?: number;
  endHour?: number;
}) {
  const { columns, items, slotIntervalMin } = props;
  const DAY_START_H = props.startHour ?? DEFAULT_START_H;
  const DAY_END_H = props.endHour ?? DEFAULT_END_H;
  const router = useRouter();
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The hover card: shown after a short pause over an appointment (mouse or keyboard focus), never while dragging or on touch.
  const [hover, setHover] = useState<{ tip: CalTip; anchor: AnchorRect } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTip = () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); hoverTimer.current = null; setHover(null); };
  const showTip = (el: HTMLElement, tip: CalTip, delay: number) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => { const r = el.getBoundingClientRect(); setHover({ tip, anchor: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }); }, delay);
  };
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
  const lanesByCol = useMemo(() => {
    const m = new Map<string, Map<string, { lane: number; lanes: number }>>();
    for (const [k, cards] of cardsByCol) m.set(k, layoutLanes(cards));
    return m;
  }, [cardsByCol]);

  // Scrolling moves the appointment out from under the card, so drop it.
  useEffect(() => {
    window.addEventListener("scroll", hideTip, true);
    return () => { window.removeEventListener("scroll", hideTip, true); if (hoverTimer.current) clearTimeout(hoverTimer.current); };
  }, []);

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

  const lastPointer = useRef<string>("mouse");

  function onPointerDown(e: React.PointerEvent, card: Card) {
    if (e.button !== 0) return;
    lastPointer.current = e.pointerType;
    // Touch scrolls the day; a tap opens the visit (onClick). Drag-to-move is a mouse/pen gesture.
    if (e.pointerType === "touch") return;
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
                          <span className={cn("block truncate text-sm font-medium", LOCKED.has(card.first.status) && card.first.status !== "completed" && card.first.status !== "class" && "text-stone-400 line-through")}>{card.first.title}</span>
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
              <div
                key={c.key}
                className={cn("relative border-l border-stone-200", c.isToday && "bg-brand-50/30", props.canEdit && "cursor-cell")}
                style={{ height: totalMin * PX_PER_MIN }}
                onClick={
                  props.canEdit
                    ? (e) => {
                        if ((e.target as HTMLElement).closest("[data-card]")) return;
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const min = DAY_START_H * 60 + Math.floor((e.clientY - rect.top) / PX_PER_MIN / slotIntervalMin) * slotIntervalMin;
                        const hh = String(Math.floor(min / 60)).padStart(2, "0");
                        const mm = String(min % 60).padStart(2, "0");
                        const q = new URLSearchParams({ date: c.date, time: `${hh}:${mm}` });
                        if (c.staffId) q.set("staffId", c.staffId);
                        router.push(`/app/${props.slug}/appointments/new?${q.toString()}`);
                      }
                    : undefined
                }
              >
                {/* Time outside the provider's hours (or the whole day off) is hatched so gaps read at a glance. */}
                {c.working
                  ? offBlocks(c.working, DAY_START_H * 60, DAY_END_H * 60).map((b, i) => (
                      <div key={`off${i}`} className="hatched pointer-events-none absolute inset-x-0" style={{ top: top(b.from), height: (b.to - b.from) * PX_PER_MIN }} aria-hidden />
                    ))
                  : null}
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
                  const lane = lanesByCol.get(c.key)?.get(card.key) ?? { lane: 0, lanes: 1 };
                  const dragging = drag?.key === card.key && drag.moved;
                  const dyMin = dragging ? snap(drag.dy) : 0;
                  const draggable = props.canEdit && !LOCKED.has(card.first.status);
                  // The quick buttons (check in, complete) need about 6rem; in a narrow card (the week view packs every stylist into one day column) they
                  // would spill out and be clipped, so the card hides them until it has room (container query on the card).
                  const height = Math.max(22, (card.endMin - card.startMin) * PX_PER_MIN - 2);
                  return (
                    <div
                      key={card.key}
                      role="button"
                      tabIndex={0}
                      onPointerDown={(e) => { hideTip(); if (draggable) onPointerDown(e, card); }}
                      onMouseEnter={(e) => { if (lastPointer.current !== "touch" && !dragRef.current) showTip(e.currentTarget, card.first.tip, 350); }}
                      onMouseLeave={hideTip}
                      onFocus={(e) => showTip(e.currentTarget, card.first.tip, 0)}
                      onBlur={hideTip}
                      onClick={() => {
                        if (!draggable || lastPointer.current === "touch") router.push(card.first.href);
                      }}
                      onKeyDown={(e) => e.key === "Enter" && router.push(card.first.href)}
                      data-card
                      aria-label={`${card.first.title}, ${card.first.subtitle}, ${fmt(card.startMin)} to ${fmt(card.endMin)}`}
                      className={cn("group @container absolute overflow-hidden rounded-md border-l-4 text-xs shadow-sm", STATUS[card.first.status], draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer", dragging && "z-30 ring-2 ring-brand-500 shadow-lg")}
                      style={{
                        top: top(card.startMin),
                        height,
                        left: `calc(${(lane.lane * 100) / lane.lanes}% + 4px)`,
                        width: `calc(${100 / lane.lanes}% - ${lane.lanes > 1 ? 6 : 8}px)`,
                        borderLeftColor: card.first.color,
                        // Overview: the stylist's colour is the only thing on the block, so tint it (cancelled and no-shows stay grey).
                        ...(props.overview && !GREYED.has(card.first.status) ? { backgroundColor: `color-mix(in srgb, ${card.first.color} 32%, white)` } : {}),
                        transform: dragging ? `translate(${drag.dx}px, ${dyMin * PX_PER_MIN}px)` : undefined,
                      }}
                    >
                      {card.gaps.map((g, i) => (
                        <div key={i} className="pointer-events-none absolute inset-x-0 bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(255,255,255,0.55)_6px_12px)]" style={{ top: (g.from - card.startMin) * PX_PER_MIN, height: (g.to - g.from) * PX_PER_MIN }}>
                          {props.overview ? null : <span className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-wide opacity-60">processing</span>}
                        </div>
                      ))}
                      {props.canEdit && !props.overview && height > 30 && (card.first.status === "booked" || card.first.status === "confirmed" || card.first.status === "checked_in") ? (
                        <div className="absolute right-1 top-1 hidden gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 @min-[6rem]:flex [@media(pointer:coarse)]:opacity-100">
                          {card.first.status !== "checked_in" ? (
                            <button
                              type="button"
                              title="Check in" aria-label="Check in"
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                startTransition(async () => {
                                  await quickStatus({ slug: props.slug, appointmentId: card.first.appointmentId, status: "checked_in" });
                                  router.refresh();
                                });
                              }}
                              className="rounded bg-white/90 p-1 text-stone-700 shadow hover:bg-white"
                            >
                              <LogIn className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            title="Mark completed" aria-label="Mark completed"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              startTransition(async () => {
                                await quickStatus({ slug: props.slug, appointmentId: card.first.appointmentId, status: "completed" });
                                router.refresh();
                              });
                            }}
                            className="rounded bg-white/90 p-1 text-emerald-700 shadow hover:bg-white"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : null}
                      {props.overview ? null : (
                        <div className="px-2 py-1 leading-tight">
                          <div className="truncate font-semibold">{card.first.title}</div>
                          <div className="truncate">{card.first.subtitle}</div>
                          {height > 44 ? <div className="truncate opacity-70">{fmt(card.startMin + dyMin)} – {fmt(card.endMin + dyMin)}</div> : null}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {props.canEdit ? <p className="hidden text-xs text-stone-500 md:block">Drag an appointment to move it. Click to open it.</p> : null}
      {hover && !drag?.moved ? <CalendarTip tip={hover.tip} anchor={hover.anchor} fmt={fmt} /> : null}
    </div>
  );
}
