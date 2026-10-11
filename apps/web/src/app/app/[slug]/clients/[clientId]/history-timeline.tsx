"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { rowClass, rowControl, RowLink } from "@/components/row";
import { cn } from "@/lib/utils";

export type TimelineItem = {
  key: string;
  when: string;
  title: string;
  meta: string;
  href: string;
  status: string;
  dim: boolean;
  sale: { href: string; label: string; open: boolean; title: string } | null;
  review: { rating: number; comment: string | null } | null;
};

const KEY = "clients.history.showRatings";

/**
 * A client's past visits and purchases, newest first, with each visit's ticket and rating. The
 * "Ratings" toggle hides the stars and comments for a tighter list; the choice is remembered on
 * this device.
 */
export function HistoryTimeline({ items, ratingCount, ratingAverage }: { items: TimelineItem[]; ratingCount: number; ratingAverage: number }) {
  const [showRatings, setShowRatings] = useState(true);
  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v === "0") setShowRatings(false);
    } catch {
      /* storage blocked: default stays */
    }
  }, []);
  const toggle = () => {
    setShowRatings((s) => {
      try { localStorage.setItem(KEY, s ? "0" : "1"); } catch { /* ignore */ }
      return !s;
    });
  };
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-4 py-2">
        <h2 className="text-sm font-semibold text-stone-600">History</h2>
        {ratingCount ? (
          <div className="flex items-center gap-3 text-xs text-stone-500">
            <span><span className="text-amber-400">★</span> {ratingAverage.toFixed(1)} average over {ratingCount} {ratingCount === 1 ? "rating" : "ratings"}</span>
            <button type="button" role="switch" aria-checked={showRatings} onClick={toggle} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5", showRatings ? "border-brand-200 bg-brand-50 text-brand-700" : "border-stone-200 text-stone-600 hover:bg-stone-50")}>
              <span className={cn("h-2 w-2 rounded-full", showRatings ? "bg-brand-500" : "bg-stone-300")} aria-hidden />
              {showRatings ? "Ratings shown" : "Ratings hidden"}
            </button>
          </div>
        ) : null}
      </div>
      <ul className="divide-y divide-stone-100 text-sm">
        {items.map((t) => (
          <li key={t.key} className={`${rowClass} px-4 py-2`}>
            <div className="flex items-center justify-between gap-3">
              <span className={cn("min-w-0", t.dim && "text-stone-400")}>
                <RowLink href={t.href} className="hover:underline">{t.when} · {t.title}</RowLink>
                {t.meta ? <span className="text-stone-500"> {t.meta}</span> : null}
                {!showRatings && t.review ? <span className="ml-1.5 text-xs text-amber-400" title={t.review.comment ?? undefined}>{"★".repeat(t.review.rating)}</span> : null}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {t.sale ? <Link href={t.sale.href} className={cn(rowControl, "tabular-nums", t.sale.open ? "font-medium text-amber-700" : "text-stone-700")} title={t.sale.title}>{t.sale.label}</Link> : null}
                <StatusBadge status={t.status} />
              </span>
            </div>
            {showRatings && t.review ? (
              <p className="mt-0.5 line-clamp-2 text-xs text-stone-600" title={t.review.comment ?? undefined}><span className="text-amber-400">{"★".repeat(t.review.rating)}</span>{t.review.comment ? ` “${t.review.comment}”` : ""}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
