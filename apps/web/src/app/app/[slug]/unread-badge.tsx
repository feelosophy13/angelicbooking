"use client";
import { useEffect, useState } from "react";

/**
 * The sidebar's unread-texts count. Rendered with the count the server knew, then kept
 * current by asking the inbox feed every half minute while the tab is in front, so a new
 * text shows up without anyone reloading. Draws nothing when there is nothing unread.
 */
export function UnreadBadge({ slug, initial, className }: { slug: string; initial: number; className?: string }) {
  const [n, setN] = useState(initial);
  useEffect(() => setN(initial), [initial]);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch(`/app/${slug}/inbox/feed?count=1`, { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { unread?: number };
        if (!stop && typeof j.unread === "number") setN(j.unread);
      } catch {
        /* offline: keep the last count */
      }
    };
    const id = setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      stop = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [slug]);
  if (!n) return null;
  return <span className={className ?? "ml-auto rounded-full bg-brand-600 px-1.5 text-[11px] font-medium text-white"} title={`${n} unread text${n === 1 ? "" : "s"}`}>{n}</span>;
}
