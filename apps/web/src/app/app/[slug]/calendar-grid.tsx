"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TZDate } from "@date-fns/tz";
import { cn, formatDateLong } from "@/lib/utils";
import { moveAppointmentItem, quickStatus, resizeAppointmentItem } from "./actions";
import { Check, Link2, LogIn } from "lucide-react";
import type { CalTip } from "@/lib/calendar-tip";
import { CalendarTip, type AnchorRect } from "./calendar-tooltip";
import { QuickCreate, type QuickCreateAt, type QuickCreateData } from "./quick-create";
import { AppointmentPanel } from "./appointment-panel";
import { DENSITY_PX, useCalendarDisplay } from "./calendar-display";
import { toast } from "@/components/toaster";

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
  /** Moving it asks whether to tell the client (there is one, and they can be reached). */
  notify?: boolean;
  clientFirst?: string | null;
  /** The client's page, for those who may see clients. */
  clientHref?: string | null;
  /** For "colour by service category": the service's category and its palette colour. */
  categoryColor?: string;
  categoryName?: string;
  /** "Tuesday, October 20, 2026", for the detail panel. */
  dateLabel?: string;
};

const DEFAULT_START_H = 7;
const DEFAULT_END_H = 21;
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

type Drag = { key: string; originX: number; originY: number; dx: number; dy: number; moved: boolean; /** Lifted by a long press on a touch screen. */ touch?: boolean };
/** How long a finger rests on a card before it lifts (a shorter touch scrolls or taps). */
const LONG_PRESS_MS = 350;
/** Dragging a card's top or bottom edge: how far that edge has moved, in grid minutes. */
type Resize = { key: string; originY: number; edge: "start" | "end"; delta: number };
/**
 * A change that waits for "tell the client?" before it is saved; the card stays drawn where it was dropped. `kind` "move" is a drop
 * (new column and start), "start" is the top edge dragged (new start, same end).
 */
type Confirm = { kind: "move" | "start"; card: Card; target: CalColumn; newStart: number; newStaffId: string | null; dx: number; dyMin: number };
/** Drawing on empty grid: the column, where the pointer went down (grid minutes) and the range it has swept so far. */
type Sel = { colKey: string; anchorMin: number; startMin: number; endMin: number; moved: boolean; originY: number; el: HTMLElement };

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
  /** Quick check-in and complete buttons on a card. */
  canEdit: boolean;
  /** Dragging an appointment to a new time or column. */
  canMove: boolean;
  /** Dragging a block of time (lunch, a meeting). */
  canMoveBlock: boolean;
  /** Clicking an empty slot starts a new appointment. */
  canBook: boolean;
  /** Drawing on an empty slot can block that time. */
  canBlock?: boolean;
  /** The quick-create popover's data; null when this person can neither book nor block. */
  quick?: QuickCreateData | null;
  todayISO: string;
  /** Grid range in hours; the page widens it to fit early/late hours and bookings. */
  startHour?: number;
  endHour?: number;
}) {
  const { columns, items, slotIntervalMin } = props;
  const DAY_START_H = props.startHour ?? DEFAULT_START_H;
  const DAY_END_H = props.endHour ?? DEFAULT_END_H;
  const router = useRouter();
  // Colour by provider or by service category, and how tall an hour is: the person's choice, kept in this browser (Display menu).
  const display = useCalendarDisplay();
  const PX_PER_MIN = DENSITY_PX[display.density];
  const byCategory = display.color === "category";
  const colorOf = (i: CalItem) => (byCategory ? (i.categoryColor ?? i.color) : i.color);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [resize, setResize] = useState<Resize | null>(null);
  const resizeRef = useRef<Resize | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  // The detail panel: the card that was clicked. It follows a refresh (status changes show) and closes when the card leaves the grid.
  const [panelKey, setPanelKey] = useState<string | null>(null);
  const panelItem = panelKey ? items.find((i) => i.groupKey === panelKey) ?? null : null;
  useEffect(() => { if (panelKey && !panelItem) setPanelKey(null); }, [panelKey, panelItem]);
  const openPanel = (card: Card) => { hideTip(); setPanelKey(card.key); };
  // The hover card: shown after a short pause over an appointment (mouse or keyboard focus), never while dragging or on touch.
  const [hover, setHover] = useState<{ tip: CalTip; anchor: AnchorRect; appointmentId: string } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTip = () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); hoverTimer.current = null; setHover(null); };
  const showTip = (el: HTMLElement, card: Card, delay: number) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => { const r = el.getBoundingClientRect(); setHover({ tip: card.first.tip, appointmentId: card.first.appointmentId, anchor: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }); }, delay);
  };
  // A visit with services by different providers is one appointment drawn as several cards (one per column). Those cards carry a link
  // mark, and hovering or opening one of them lights up its siblings, so the desk sees the whole visit across the columns.
  const multiProvider = useMemo(() => {
    const staffByAppt = new Map<string, Set<string>>();
    for (const i of items) staffByAppt.set(i.appointmentId, (staffByAppt.get(i.appointmentId) ?? new Set()).add(i.staffId));
    return new Set([...staffByAppt].filter(([, set]) => set.size > 1).map(([id]) => id));
  }, [items]);
  const [pending, startTransition] = useTransition();
  const colWidth = useRef(0);
  // Quick create: a click on empty grid, or a range drawn on it, opens a popover beside it (the drawn range stays as a ghost).
  const canCreate = !!props.quick && (props.canBook || !!props.canBlock);
  const [sel, setSel] = useState<Sel | null>(null);
  const selRef = useRef<Sel | null>(null);
  const [quickAt, setQuickAt] = useState<QuickCreateAt | null>(null);
  const closeQuick = useCallback(() => { setQuickAt(null); setSel(null); selRef.current = null; }, []);
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
      // A long press that never moved: the finger lifts, the tap's click opens the panel (mouse: open it here).
      if (!d.touch) openPanel(card);
      return;
    }
    // The click that follows a touch drag must not open the panel.
    suppressClick.current = true;
    setTimeout(() => { suppressClick.current = false; }, 400);
    const deltaMin = snap(d.dy);
    const colShift = colWidth.current ? Math.round(d.dx / colWidth.current) : 0;
    const fromIdx = columns.findIndex((c) => c.key === card.first.columnKey);
    const toIdx = Math.min(columns.length - 1, Math.max(0, fromIdx + colShift));
    const target = columns[toIdx]!;
    const newStart = card.startMin + deltaMin;
    if (newStart < 0 || newStart + (card.endMin - card.startMin) > 24 * 60) return;
    if (deltaMin === 0 && toIdx === fromIdx) return;
    const newStaffId = props.view === "day" ? target.staffId : null;
    // A client who can be reached is asked about: the move waits for "tell them" or "quietly" (the card stays where it was dropped).
    if (card.first.notify) setConfirm({ kind: "move", card, target, newStart, newStaffId, dx: d.dx, dyMin: deltaMin });
    else performMove(card, target, newStart, newStaffId, false);
  }

  const who = (card: Card) => card.first.clientFirst ?? card.first.title;
  /** Save a move; on success a toast offers Undo (which moves it back, told or quiet the same way). */
  function performMove(card: Card, target: CalColumn, newStart: number, newStaffId: string | null, notify: boolean) {
    setConfirm(null);
    const from = columns.find((c) => c.key === card.first.columnKey);
    const whereTo = `${fmt(newStart)}${target.date !== card.first.columnKey && props.view === "week" ? ` on ${target.label}` : ""}${newStaffId && newStaffId !== card.first.staffId ? ` with ${target.label}` : ""}`;
    startTransition(async () => {
      const res = await moveAppointmentItem({ slug: props.slug, itemId: card.first.id, newStartISO: instantISO(target.date, newStart, props.timeZone), newStaffId, notify });
      if (!res.ok) { toast({ kind: "error", message: res.error }); router.refresh(); return; }
      toast({
        message: `Moved ${who(card)} to ${whereTo}${notify ? ` and told ${who(card)}` : ""}`,
        action: from
          ? {
              label: "Undo",
              onClick: () =>
                startTransition(async () => {
                  const back = await moveAppointmentItem({ slug: props.slug, itemId: card.first.id, newStartISO: instantISO(from.date, card.startMin, props.timeZone), newStaffId: props.view === "day" ? card.first.staffId : null, notify });
                  toast(back.ok ? { message: `Moved ${who(card)} back to ${fmt(card.startMin)}` } : { kind: "error", message: back.error });
                  router.refresh();
                }),
            }
          : undefined,
      });
      router.refresh();
    });
  }

  /** Save a new edge after a handle was dragged; Undo puts the old edge back (a start change told or quiet the same way). */
  function performResize(card: Card, change: { newStart?: number; newEnd?: number }, notify: boolean) {
    setConfirm(null);
    const col = columns.find((c) => c.key === card.first.columnKey);
    if (!col) return;
    const iso = (min: number) => instantISO(col.date, min, props.timeZone);
    const forward = { newStartISO: change.newStart !== undefined ? iso(change.newStart) : null, newEndISO: change.newEnd !== undefined ? iso(change.newEnd) : null };
    const back = { newStartISO: change.newStart !== undefined ? iso(card.startMin) : null, newEndISO: change.newEnd !== undefined ? iso(card.endMin) : null };
    const said = change.newStart !== undefined ? `${who(card)} now starts at ${fmt(change.newStart)}${notify ? ` and ${who(card)} was told` : ""}` : `${who(card)} now ends at ${fmt(change.newEnd!)}`;
    const undone = change.newStart !== undefined ? `${who(card)} starts at ${fmt(card.startMin)} again` : `${who(card)} ends at ${fmt(card.endMin)} again`;
    startTransition(async () => {
      const res = await resizeAppointmentItem({ slug: props.slug, itemId: card.first.id, ...forward, notify });
      if (!res.ok) { toast({ kind: "error", message: res.error }); router.refresh(); return; }
      toast({
        message: said,
        action: {
          label: "Undo",
          onClick: () =>
            startTransition(async () => {
              const r = await resizeAppointmentItem({ slug: props.slug, itemId: card.first.id, ...back, notify });
              toast(r.ok ? { message: undone } : { kind: "error", message: r.error });
              router.refresh();
            }),
        },
      });
      router.refresh();
    });
  }

  useEffect(() => {
    if (!resize) return;
    const onMove = (e: PointerEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const next = { ...r, delta: snap(e.clientY - r.originY) };
      resizeRef.current = next;
      setResize(next);
    };
    const onUp = () => {
      const r = resizeRef.current;
      resizeRef.current = null;
      setResize(null);
      if (!r) return;
      const card = [...cardsByCol.values()].flat().find((c) => c.key === r.key);
      if (!card) return;
      if (r.edge === "end") {
        const newEnd = Math.max(card.startMin + slotIntervalMin, Math.min(24 * 60, card.endMin + r.delta));
        if (newEnd !== card.endMin) performResize(card, { newEnd }, false);
        return;
      }
      const newStart = Math.min(card.endMin - slotIntervalMin, Math.max(0, card.startMin + r.delta));
      if (newStart === card.startMin) return;
      // A new start is a time change the client was told about, so it asks like a move does.
      const col = columns.find((c) => c.key === card.first.columnKey);
      if (card.first.notify && col) setConfirm({ kind: "start", card, target: col, newStart, newStaffId: null, dx: 0, dyMin: 0 });
      else performResize(card, { newStart }, false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resize?.key]);

  useEffect(() => {
    if (!confirm) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setConfirm(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirm]);

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
    // Once a card is lifted by a long press, the finger moves the card, not the page (the listener must not be passive for that).
    const onTouchMove = (e: TouchEvent) => { if (dragRef.current?.touch) e.preventDefault(); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("touchmove", onTouchMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.key]);

  const lastPointer = useRef<string>("mouse");
  const suppressClick = useRef(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPress = () => { if (pressTimer.current) clearTimeout(pressTimer.current); pressTimer.current = null; };
  useEffect(() => cancelPress, []);

  function onPointerDown(e: React.PointerEvent, card: Card) {
    if (e.button !== 0) return;
    lastPointer.current = e.pointerType;
    const colEl = (e.currentTarget as HTMLElement).parentElement!;
    const origin = { x: e.clientX, y: e.clientY };
    if (e.pointerType === "touch") {
      // A finger scrolls the day and a tap opens the visit; press and hold lifts the card so it can be moved (the browser's scroll
      // or a slide cancels the press). A short buzz says it lifted, where the device supports it.
      cancelPress();
      const stop = () => { cancelPress(); window.removeEventListener("pointermove", onSlide); window.removeEventListener("pointerup", stop); window.removeEventListener("pointercancel", stop); };
      const onSlide = (ev: PointerEvent) => { if (Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) > 8) stop(); };
      window.addEventListener("pointermove", onSlide);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
      pressTimer.current = setTimeout(() => {
        stop();
        colWidth.current = colEl.getBoundingClientRect().width;
        const d: Drag = { key: card.key, originX: origin.x, originY: origin.y, dx: 0, dy: 0, moved: false, touch: true };
        dragRef.current = d;
        setDrag(d);
        try { navigator.vibrate?.(15); } catch { /* not supported */ }
      }, LONG_PRESS_MS);
      return;
    }
    e.preventDefault();
    colWidth.current = colEl.getBoundingClientRect().width;
    const d: Drag = { key: card.key, originX: e.clientX, originY: e.clientY, dx: 0, dy: 0, moved: false };
    dragRef.current = d;
    setDrag(d);
  }

  const quarterLines = Array.from({ length: totalMin / 15 + 1 }, (_, i) => DAY_START_H * 60 + i * 15);
  // The visit whose sibling cards light up: the one under the mouse, else the one open in the panel.
  const linkedId = hover?.appointmentId ?? panelItem?.appointmentId ?? null;

  /** The grid minute under a pointer, snapped down to the booking grid and kept inside the day. */
  const minuteAt = (el: HTMLElement, clientY: number) => {
    const rect = el.getBoundingClientRect();
    const raw = DAY_START_H * 60 + Math.floor((clientY - rect.top) / PX_PER_MIN / slotIntervalMin) * slotIntervalMin;
    return Math.min(DAY_END_H * 60 - slotIntervalMin, Math.max(DAY_START_H * 60, raw));
  };
  const openQuick = (s: Sel, range: boolean) => {
    const col = columns.find((c) => c.key === s.colKey);
    if (!col) return;
    const rect = s.el.getBoundingClientRect();
    setQuickAt({
      date: col.date,
      dateLabel: formatDateLong(col.date),
      startMin: s.startMin,
      endMin: range ? s.endMin : null,
      staffId: col.staffId,
      anchor: { left: rect.left, right: rect.right, top: rect.top + top(s.startMin), bottom: rect.top + top(range ? s.endMin : s.startMin + slotIntervalMin) },
    });
  };
  function onEmptyPointerDown(e: React.PointerEvent, c: CalColumn) {
    if (!canCreate || e.button !== 0 || (e.target as HTMLElement).closest("[data-card]")) return;
    lastPointer.current = e.pointerType;
    // Touch scrolls the day; a tap opens the popover (onClick). Drawing a range is a mouse/pen gesture.
    if (e.pointerType === "touch") return;
    hideTip();
    const el = e.currentTarget as HTMLElement;
    const m = minuteAt(el, e.clientY);
    const s: Sel = { colKey: c.key, anchorMin: m, startMin: m, endMin: m + slotIntervalMin, moved: false, originY: e.clientY, el };
    selRef.current = s;
    setSel(s);
    setQuickAt(null);
  }
  useEffect(() => {
    if (!sel) return;
    const onMove = (e: PointerEvent) => {
      const s = selRef.current;
      if (!s) return;
      const m = minuteAt(s.el, e.clientY);
      const moved = s.moved || Math.abs(e.clientY - s.originY) > 4;
      const next: Sel = { ...s, moved, startMin: Math.min(s.anchorMin, m), endMin: Math.max(s.anchorMin, m) + slotIntervalMin };
      selRef.current = next;
      setSel(next);
    };
    const onUp = () => {
      const s = selRef.current;
      window.removeEventListener("pointermove", onMove);
      if (!s) return;
      openQuick(s, s.moved);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.colKey, sel?.anchorMin]);

  return (
    <div className="space-y-2">
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
                      <button onClick={() => openPanel(card)} className="flex w-full items-center gap-3 px-3 py-2 text-left">
                        <span className="w-16 shrink-0 text-xs text-stone-500">{fmt(card.startMin)}</span>
                        <span className="h-8 w-1 rounded-full" style={{ background: colorOf(card.first) }} />
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

      {/* Colouring by category: what each colour means, built from what is on screen. */}
      {byCategory ? (
        <p className="hidden flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-600 md:flex" aria-label="Colours">
          {[...new Map(items.filter((i) => i.categoryName && i.status !== "block").map((i) => [i.categoryName!, i.categoryColor!])).entries()].map(([name, color]) => (
            <span key={name} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />{name}</span>
          ))}
        </p>
      ) : null}
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
                className={cn("relative border-l border-stone-200", c.isToday && "bg-brand-50/30", canCreate && "cursor-cell")}
                style={{ height: totalMin * PX_PER_MIN }}
                onPointerDown={(e) => onEmptyPointerDown(e, c)}
                onClick={
                  canCreate
                    ? (e) => {
                        // A tap (touch) opens the popover here; a mouse click already did on pointer up.
                        if (lastPointer.current !== "touch" || (e.target as HTMLElement).closest("[data-card]")) return;
                        const el = e.currentTarget as HTMLElement;
                        const m = minuteAt(el, e.clientY);
                        const s: Sel = { colKey: c.key, anchorMin: m, startMin: m, endMin: m + slotIntervalMin, moved: false, originY: e.clientY, el };
                        selRef.current = s;
                        setSel(s);
                        openQuick(s, false);
                      }
                    : undefined
                }
              >
                {sel?.colKey === c.key && (sel.moved || quickAt) ? (
                  <div className="pointer-events-none absolute inset-x-1 z-20 rounded-md border-2 border-dashed border-brand-400 bg-brand-100/60 px-2 py-1 text-xs font-medium text-brand-900" style={{ top: top(sel.startMin), height: Math.max(22, (sel.endMin - sel.startMin) * PX_PER_MIN - 2) }} aria-hidden>
                    {fmt(sel.startMin)}{sel.moved ? ` – ${fmt(sel.endMin)}` : ""}
                  </div>
                ) : null}
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
                  // While a drop waits for "tell the client?", the card stays drawn where it was dropped.
                  const held = confirm?.card.key === card.key ? confirm : null;
                  const dragging = (drag?.key === card.key && drag.moved) || !!held;
                  const dx = held ? held.dx : drag?.key === card.key ? drag.dx : 0;
                  const dyMin = held ? held.dyMin : dragging && drag ? snap(drag.dy) : 0;
                  const draggable = (card.first.status === "block" ? props.canMoveBlock : props.canMove) && !LOCKED.has(card.first.status);
                  const resizing = resize?.key === card.key ? resize : null;
                  const endMin = resizing?.edge === "end" ? Math.max(card.startMin + slotIntervalMin, Math.min(24 * 60, card.endMin + resizing.delta)) : card.endMin;
                  // The top edge being dragged, or a new start waiting for "tell the client?", draws the card from its new start.
                  const startMin = resizing?.edge === "start" ? Math.min(card.endMin - slotIntervalMin, Math.max(0, card.startMin + resizing.delta)) : held?.kind === "start" ? held.newStart : card.startMin;
                  // The quick buttons (check in, complete) need about 6rem; in a narrow card (the week view packs every stylist into one day column) they
                  // would spill out and be clipped, so the card hides them until it has room (container query on the card).
                  const height = Math.max(22, (endMin - startMin) * PX_PER_MIN - 2);
                  return (
                    <div
                      key={card.key}
                      role="button"
                      tabIndex={0}
                      onPointerDown={(e) => { hideTip(); if (draggable) onPointerDown(e, card); }}
                      onMouseEnter={(e) => { if (lastPointer.current !== "touch" && !dragRef.current) showTip(e.currentTarget, card, 350); }}
                      onMouseLeave={hideTip}
                      onFocus={(e) => showTip(e.currentTarget, card, 0)}
                      onBlur={hideTip}
                      onClick={() => {
                        if (suppressClick.current) return;
                        if (!draggable || lastPointer.current === "touch") openPanel(card);
                      }}
                      onKeyDown={(e) => e.key === "Enter" && openPanel(card)}
                      data-card
                      aria-label={`${card.first.title}, ${card.first.subtitle}, ${fmt(card.startMin)} to ${fmt(card.endMin)}`}
                      className={cn("group @container absolute overflow-hidden rounded-md border-l-4 text-xs shadow-sm [-webkit-touch-callout:none]", STATUS[card.first.status], draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer", (dragging || resizing) && "z-30 ring-2 ring-brand-500 shadow-lg", drag?.key === card.key && drag.touch && "z-30 scale-[1.03] ring-2 ring-brand-500 shadow-lg", linkedId === card.first.appointmentId && multiProvider.has(card.first.appointmentId) && !dragging && "ring-2 ring-stone-500")}
                      style={{
                        top: top(startMin),
                        height,
                        left: `calc(${(lane.lane * 100) / lane.lanes}% + 4px)`,
                        width: `calc(${100 / lane.lanes}% - ${lane.lanes > 1 ? 6 : 8}px)`,
                        borderLeftColor: colorOf(card.first),
                        // Overview: the colour is the only thing on the block, so tint it (cancelled and no-shows stay grey). Colouring by
                        // category tints every view the same way, so the kind of work reads at a glance.
                        ...((props.overview || byCategory) && !GREYED.has(card.first.status) ? { backgroundColor: `color-mix(in srgb, ${colorOf(card.first)} ${props.overview ? 32 : 22}%, white)` } : {}),
                        transform: dragging ? `translate(${dx}px, ${dyMin * PX_PER_MIN}px)` : undefined,
                      }}
                    >
                      {/* The edges resize (a visit running long, a client who came early, a longer lunch): drag one and it snaps to the booking grid. */}
                      {draggable && !props.overview && height > 30
                        ? (["start", "end"] as const).map((edge) => (
                            <div
                              key={edge}
                              role="presentation"
                              aria-hidden
                              title={edge === "end" ? "Drag to change when it ends" : "Drag to change when it starts"}
                              onPointerDown={(e) => {
                                if (e.button !== 0 || e.pointerType === "touch") return;
                                e.stopPropagation();
                                e.preventDefault();
                                hideTip();
                                const r: Resize = { key: card.key, originY: e.clientY, edge, delta: 0 };
                                resizeRef.current = r;
                                setResize(r);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className={cn("absolute inset-x-0 z-10 flex h-2.5 cursor-ns-resize justify-center opacity-0 group-hover:opacity-100", edge === "end" ? "bottom-0 items-end" : "top-0 items-start")}
                            >
                              <span className={cn("h-1 w-8 rounded-full bg-stone-500/50", edge === "end" ? "mb-0.5" : "mt-0.5")} />
                            </div>
                          ))
                        : null}
                      {multiProvider.has(card.first.appointmentId) && !props.overview ? (
                        <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-white/80 p-0.5 text-stone-600" title="Part of a visit with another provider" aria-label="Part of a visit with another provider">
                          <Link2 className="h-3 w-3" />
                        </span>
                      ) : null}
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
                          {height > 44 ? <div className="truncate opacity-70">{fmt(startMin + dyMin)} – {fmt(endMin + dyMin)}</div> : null}
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
      {props.canMove || props.canMoveBlock || canCreate ? (
        <p className="hidden text-xs text-stone-500 md:block">
          {[canCreate ? (props.canBlock ? "Click or draw on an empty slot to book or block it." : "Click an empty slot to book it.") : null, props.canMove || props.canMoveBlock ? "Drag an appointment to move it (press and hold on a touch screen). Click to open it." : null].filter(Boolean).join(" ")}
        </p>
      ) : null}
      {hover && !drag?.moved && !sel && !resize && !confirm ? <CalendarTip tip={hover.tip} anchor={hover.anchor} fmt={fmt} /> : null}
      {panelItem ? (
        <AppointmentPanel
          item={panelItem}
          slug={props.slug}
          fmt={fmt}
          canEdit={props.canEdit}
          canRemoveBlock={props.canMoveBlock}
          onClose={() => setPanelKey(null)}
        />
      ) : null}
      {confirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4" onClick={() => setConfirm(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="move-confirm-title" className="w-[min(92vw,26rem)] rounded-xl border border-stone-200 bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 id="move-confirm-title" className="text-base font-semibold text-stone-900">
              {confirm.kind === "start"
                ? `Start ${who(confirm.card)} at ${fmt(confirm.newStart)} instead of ${fmt(confirm.card.startMin)}?`
                : `Move ${who(confirm.card)} to ${fmt(confirm.newStart)}${confirm.newStaffId && confirm.newStaffId !== confirm.card.first.staffId ? ` with ${confirm.target.label}` : props.view === "week" && confirm.target.key !== confirm.card.first.columnKey ? ` on ${confirm.target.label}` : ""}?`}
            </h3>
            <p className="mt-1 text-sm text-stone-600">{who(confirm.card)} can be reached, so they can hear about the new time. Either way the reminders move with it.</p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setConfirm(null)} className="h-9 rounded-lg px-3 text-sm text-stone-700 hover:bg-stone-100">Cancel</button>
              <button type="button" onClick={() => (confirm.kind === "start" ? performResize(confirm.card, { newStart: confirm.newStart }, false) : performMove(confirm.card, confirm.target, confirm.newStart, confirm.newStaffId, false))} className="h-9 rounded-lg border border-stone-300 bg-white px-3 text-sm font-medium text-stone-800 hover:bg-stone-50">{confirm.kind === "start" ? "Change quietly" : "Move quietly"}</button>
              <button type="button" autoFocus onClick={() => (confirm.kind === "start" ? performResize(confirm.card, { newStart: confirm.newStart }, true) : performMove(confirm.card, confirm.target, confirm.newStart, confirm.newStaffId, true))} className="h-9 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700">{confirm.kind === "start" ? "Change and tell" : "Move and tell"} {who(confirm.card)}</button>
            </div>
          </div>
        </div>
      ) : null}
      {quickAt && props.quick ? (
        <QuickCreate
          data={props.quick}
          at={quickAt}
          fmt={fmt}
          onClose={closeQuick}
          onBooked={(r) => {
            closeQuick();
            toast({ message: r.message, action: r.kind === "appointment" ? { label: "Open", onClick: () => router.push(`/app/${props.slug}/appointments/${r.appointmentId}`) } : undefined });
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
