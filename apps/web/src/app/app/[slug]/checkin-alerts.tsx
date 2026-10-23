"use client";
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "@/components/toaster";

/**
 * Live alert for the front-door kiosk: every 20 seconds while the tab is in front, asks for check-ins and walk-ins since the last ask,
 * shows each as a toast with an Open link, and refreshes the calendar so the visit turns "checked in" without a reload. Mounted only
 * when a location has the kiosk on and this person can see every calendar.
 */
export function CheckinAlerts({ slug, since }: { slug: string; since: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const last = useRef(since);
  const seen = useRef(new Set<string>());
  const onCalendar = useRef(false);
  onCalendar.current = pathname === `/app/${slug}` || pathname.startsWith(`/app/${slug}/appointments`) || pathname.startsWith(`/app/${slug}/waitlist`);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch(`/app/${slug}/check-ins/feed?since=${last.current}`, { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { now: number; alerts: { id: string; at: string; message: string; href: string }[] };
        if (stop) return;
        const fresh = j.alerts.filter((a) => !seen.current.has(a.id));
        for (const a of fresh) seen.current.add(a.id);
        if (j.alerts.length) last.current = new Date(j.alerts[j.alerts.length - 1]!.at).getTime();
        const a = fresh[fresh.length - 1];
        if (!a) return;
        const message = fresh.length > 1 ? `${a.message} (and ${fresh.length - 1} more)` : a.message;
        toast({ kind: "info", message, ttlMs: 12_000, action: { label: "Open", onClick: () => router.push(a.href) } });
        if (onCalendar.current) router.refresh();
      } catch {
        /* offline: try again next time */
      }
    };
    const id = setInterval(tick, 20_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      stop = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [slug, router]);
  return null;
}
