"use client";
import { useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { Check, ExternalLink, LogIn, Phone, Play, ShieldCheck, Trash2, UserRound, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { toast } from "@/components/toaster";
import type { CalItem } from "./calendar-grid";
import { quickStatus, removeBlock } from "./actions";
import { startCheckout } from "./appointments/[id]/actions";
import { Receipt } from "lucide-react";

/**
 * Google Calendar's "click an event, read it beside the grid": a panel down the right edge (a sheet from the bottom on a phone) with
 * the visit's client, services, price, notes and status actions, so the desk can confirm, check in, start or complete without
 * leaving the calendar. "Open" goes to the full appointment page for everything else (services, moves, cancel, checkout, photos).
 * The content is the same server-built summary the hover card uses, so nothing is fetched on click.
 */
export function AppointmentPanel({ item, slug, fmt, canEdit, canRemoveBlock, canCheckout, onClose }: { item: CalItem; slug: string; fmt: (min: number) => string; canEdit: boolean; canRemoveBlock: boolean; /** May ring the visit up (checkout.take and the right to update it). */ canCheckout?: boolean; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const tip = item.tip;
  const isBlock = tip.kind === "block";
  const isClass = tip.kind === "class";
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const status = (s: "confirmed" | "checked_in" | "in_progress" | "completed", done: string) =>
    start(async () => {
      const r = await quickStatus({ slug, appointmentId: item.appointmentId, status: s });
      toast(r.ok ? { message: done } : { kind: "error", message: r.error });
      router.refresh();
    });
  const remove = () =>
    start(async () => {
      const r = await removeBlock({ slug, appointmentId: item.appointmentId });
      toast(r.ok ? { message: "Block removed" } : { kind: "error", message: r.error });
      if (r.ok) onClose();
      router.refresh();
    });
  const live = !["completed", "cancelled", "no_show"].includes(item.status);
  const actions = canEdit && !isBlock && !isClass && live
    ? [
        ...(item.status === "booked" ? [{ key: "confirmed" as const, label: "Confirm", icon: ShieldCheck, done: `${tip.heading} confirmed` }] : []),
        ...(item.status === "booked" || item.status === "confirmed" ? [{ key: "checked_in" as const, label: "Check in", icon: LogIn, done: `${tip.heading} checked in` }] : []),
        ...(item.status === "checked_in" ? [{ key: "in_progress" as const, label: "Start", icon: Play, done: `${tip.heading} started` }] : []),
        ...(item.status !== "completed" ? [{ key: "completed" as const, label: "Complete", icon: Check, done: `${tip.heading} completed` }] : []),
      ]
    : [];
  const first = tip.lines[0];
  const span = first ? `${fmt(Math.min(...tip.lines.map((l) => l.startMin)))} – ${fmt(Math.max(...tip.lines.map((l) => l.endMin)))}` : "";
  const body = (
    <div className={cn("flex h-full flex-col", pending && "opacity-60")} aria-busy={pending}>
      <div className="flex items-start justify-between gap-3 border-b border-stone-200 px-5 py-4">
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-stone-900">{tip.heading}</p>
          <p className="mt-0.5 text-sm text-stone-600">{item.dateLabel ?? ""}{span ? ` · ${span}` : ""}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isBlock || isClass ? <span className="inline-flex items-center rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700 ring-1 ring-inset ring-stone-200">{tip.status}</span> : <StatusBadge status={item.status} />}
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-800"><X className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
        {tip.sub || item.clientHref ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-stone-700">
            {tip.sub && !isClass ? <a href={`tel:${tip.sub.replace(/[^+\d]/g, "")}`} className="inline-flex items-center gap-1.5 hover:underline"><Phone className="h-3.5 w-3.5 text-stone-400" />{tip.sub}</a> : null}
            {isClass && tip.sub ? <span>{tip.sub}</span> : null}
            {item.clientHref ? <Link href={item.clientHref} className="inline-flex items-center gap-1.5 text-brand-700 hover:underline"><UserRound className="h-3.5 w-3.5" />View client</Link> : null}
          </div>
        ) : null}
        {tip.tags.length ? <p className="flex flex-wrap gap-1">{tip.tags.map((t) => <span key={t} className="rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700">{t}</span>)}</p> : null}
        <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
          {tip.lines.map((l, i) => (
            <li key={i} className="flex items-start justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                <span className="block font-medium text-stone-900">{l.service}</span>
                <span className="block text-xs text-stone-500">{fmt(l.startMin)} – {fmt(l.endMin)}{l.staff ? ` · ${l.staff}` : ""}</span>
              </span>
              {l.price ? <span className="shrink-0 tabular-nums text-stone-700">{l.price}</span> : null}
            </li>
          ))}
          {tip.total ? <li className="flex justify-between px-3 py-2 font-medium text-stone-900"><span>Total</span><span className="tabular-nums">{tip.total}</span></li> : null}
        </ul>
        {tip.facts.length ? <p className="flex flex-wrap gap-1">{tip.facts.map((f) => <span key={f} className={cn("rounded px-1.5 py-0.5 text-xs", f === "Forms due" ? "bg-amber-100 font-medium text-amber-900" : "bg-stone-100 text-stone-600")}>{f}</span>)}</p> : null}
        {tip.notes ? <p className="border-l-2 border-stone-200 pl-3 italic text-stone-600">{tip.notes}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-stone-200 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Link href={item.href} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700">
          <ExternalLink className="h-4 w-4" /> Open
        </Link>
        {actions.map((a) => (
          <button key={a.key} type="button" disabled={pending} onClick={() => status(a.key, a.done)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-50">
            <a.icon className="h-4 w-4 text-stone-500" /> {a.label}
          </button>
        ))}
        {canCheckout && !isBlock && !isClass && item.status !== "cancelled" && item.status !== "no_show" ? (
          // The same action as the appointment page's Check out: opens (or returns to) the visit's ticket. Forms still due come back as a message.
          <form action={startCheckout}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="appointmentId" value={item.appointmentId} />
            <button type="submit" disabled={pending} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-50">
              <Receipt className="h-4 w-4 text-stone-500" /> Check out
            </button>
          </form>
        ) : null}
        {isBlock && canRemoveBlock && live ? (
          <button type="button" disabled={pending} onClick={remove} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">
            <Trash2 className="h-4 w-4" /> Remove block
          </button>
        ) : null}
      </div>
    </div>
  );
  return createPortal(
    <>
      {/* Phone: a sheet from the bottom with a backdrop. Desktop: a panel down the right edge, no backdrop, so another card can be clicked straight away. */}
      <div className="fixed inset-0 z-[60] bg-stone-900/40 md:hidden" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-label={tip.heading}
        data-appointment-panel
        className="fixed inset-x-0 bottom-0 z-[60] max-h-[85vh] rounded-t-2xl border border-stone-200 bg-white shadow-2xl md:inset-x-auto md:inset-y-0 md:right-0 md:max-h-none md:w-[380px] md:rounded-none md:border-y-0 md:border-r-0 md:border-l"
      >
        {body}
      </div>
    </>,
    document.body,
  );
}
