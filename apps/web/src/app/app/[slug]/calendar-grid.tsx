"use client";
import { useEffect, useRef, useState, useTransition } from "react";
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
};

const DAY_START_H = 7;
const DAY_END_H = 21;
const PX_PER_MIN = 1.2;
const LOCKED = new Set(["completed", "cancelled", "no_show"]);

const STATUS: Record<string, string> = {
  booked: "bg-brand-100 text-brand-800",
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
  const ampm = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${ampm}`;
}

function instantISO(date: string, minutes: number, tz: string) {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(new TZDate(y!, mo! - 1, d!, Math.floor(minutes / 60), minutes % 60, 0, 0, tz).getTime()).toISOString();
}

type Drag = { id: string; originX: number; originY: number; dx: number; dy: number; colIndex: number; moved: boolean };

export function CalendarGrid(props: {
  slug: string;
  timeZone: string;
  view: "day" | "week";
  columns: CalColumn[];
  items: CalItem[];
  slotIntervalMin: number;
  canEdit: boolean;
}) {
  const { columns, items, slotIntervalMin } = props;
  const router = useRouter();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const gridRef = useRef<HTMLDivElement>(null);
  const colWidth = useRef(0);

  const totalMin = (DAY_END_H - DAY_START_H) * 60;
  const hours = Array.from({ length: DAY_END_H - DAY_START_H + 1 }, (_, i) => DAY_START_H + i);
  const top = (min: number) => (min - DAY_START_H * 60) * PX_PER_MIN;
  const snap = (dyPx: number) => Math.round(dyPx / PX_PER_MIN / slotIntervalMin) * slotIntervalMin;

  const dragRef = useRef<Drag | null>(null);

  function finishDrag() {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    const item = items.find((i) => i.id === d.id);
    if (!item) return;
    if (!d.moved) {
      router.push(item.href);
      return;
    }
    const deltaMin = snap(d.dy);
    const colShift = colWidth.current ? Math.round(d.dx / colWidth.current) : 0;
    const fromIdx = columns.findIndex((c) => c.key === item.columnKey);
    const toIdx = Math.min(columns.length - 1, Math.max(0, fromIdx + colShift));
    const target = columns[toIdx]!;
    const newStart = item.startMin + deltaMin;
    if (newStart < 0 || newStart + (item.endMin - item.startMin) > 24 * 60) return;
    if (deltaMin === 0 && toIdx === fromIdx) return;
    const newStaffId = props.view === "day" ? target.staffId : null;
    setError(null);
    startTransition(async () => {
      const res = await moveAppointmentItem({
        slug: props.slug,
        itemId: item.id,
        newStartISO: instantISO(target.date, newStart, props.timeZone),
        newStaffId,
      });
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const next = {
        ...d,
        dx: e.clientX - d.originX,
        dy: e.clientY - d.originY,
        moved: d.moved || Math.hypot(e.clientX - d.originX, e.clientY - d.originY) > 4,
      };
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
  }, [drag?.id]);

  function onPointerDown(e: React.PointerEvent, item: CalItem, colIndex: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    const col = (e.currentTarget as HTMLElement).parentElement!;
    colWidth.current = col.getBoundingClientRect().width;
    const d: Drag = { id: item.id, originX: e.clientX, originY: e.clientY, dx: 0, dy: 0, colIndex, moved: false };
    dragRef.current = d;
    setDrag(d);
  }

  return (
    <div className="space-y-2">
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      <div className={cn("overflow-x-auto rounded-xl border border-stone-200 bg-white", pending && "opacity-60")}>
        <div
          ref={gridRef}
          className="grid min-w-[640px] select-none"
          style={{ gridTemplateColumns: `56px repeat(${columns.length}, minmax(${props.view === "week" ? 120 : 160}px, 1fr))` }}
        >
          <div className="sticky top-0 z-10 border-b border-stone-200 bg-white" />
          {columns.map((c) => (
            <div
              key={c.key}
              className={cn("sticky top-0 z-10 flex items-center gap-2 border-b border-l border-stone-200 bg-white px-3 py-2 text-sm font-medium", c.isToday && "text-brand-700")}
            >
              {c.color ? <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} /> : null}
              {c.label}
            </div>
          ))}

          <div className="relative" style={{ height: totalMin * PX_PER_MIN }}>
            {hours.map((h) => (
              <div key={h} className="absolute right-2 -translate-y-1/2 text-xs text-stone-400" style={{ top: (h - DAY_START_H) * 60 * PX_PER_MIN }}>
                {fmt(h * 60).replace(":00", "")}
              </div>
            ))}
          </div>

          {columns.map((c, colIndex) => (
            <div key={c.key} className={cn("relative border-l border-stone-200", c.isToday && "bg-brand-50/40")} style={{ height: totalMin * PX_PER_MIN }}>
              {hours.map((h) => (
                <div key={h} className="absolute inset-x-0 border-t border-stone-100" style={{ top: (h - DAY_START_H) * 60 * PX_PER_MIN }} />
              ))}
              {items
                .filter((i) => i.columnKey === c.key)
                .map((i) => {
                  const dragging = drag?.id === i.id && drag.moved;
                  const dyMin = dragging ? snap(drag.dy) : 0;
                  const draggable = props.canEdit && !LOCKED.has(i.status);
                  return (
                    <div
                      key={i.id}
                      role="button"
                      tabIndex={0}
                      onPointerDown={draggable ? (e) => onPointerDown(e, i, colIndex) : undefined}
                      onClick={!draggable ? () => router.push(i.href) : undefined}
                      onKeyDown={(e) => e.key === "Enter" && router.push(i.href)}
                      className={cn(
                        "absolute inset-x-1 overflow-hidden rounded-md border-l-4 px-2 py-1 text-xs shadow-sm",
                        STATUS[i.status],
                        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                        dragging && "z-30 ring-2 ring-brand-500 shadow-lg",
                      )}
                      style={{
                        top: top(i.startMin),
                        height: Math.max(18, (i.endMin - i.startMin) * PX_PER_MIN - 2),
                        borderLeftColor: i.color,
                        transform: dragging ? `translate(${drag.dx}px, ${dyMin * PX_PER_MIN}px)` : undefined,
                      }}
                      title={`${i.title} · ${i.subtitle}`}
                    >
                      <div className="truncate font-semibold">{i.title}</div>
                      <div className="truncate">{i.subtitle}</div>
                      <div className="truncate opacity-70">
                        {fmt(i.startMin + dyMin)} – {fmt(i.endMin + dyMin)}
                      </div>
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
      {props.canEdit ? <p className="text-xs text-stone-500">Drag an appointment to move it. Click to open it.</p> : null}
    </div>
  );
}
