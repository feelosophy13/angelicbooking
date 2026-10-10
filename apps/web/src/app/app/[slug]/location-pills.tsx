"use client";
import Link from "next/link";
import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * One-click location filter for the calendar. The choice is remembered per
 * business in localStorage so opening the calendar from the sidebar comes back
 * to the same location until "All" is picked.
 */
export function LocationPills({ businessId, locations, current, query }: { businessId: string; locations: { id: string; name: string }[]; current: string | null; query: string }) {
  // Server components can't hand us a function, so the other query params come as a string.
  const hrefFor = (locationId: string | null) => `?${query}${query ? "&" : ""}location=${locationId ?? ""}`;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const key = `cal_location_${businessId}`;
  useEffect(() => {
    try {
      if (params.has("location")) localStorage.setItem(key, params.get("location") ?? "");
      else {
        const saved = localStorage.getItem(key);
        if (saved && locations.some((l) => l.id === saved)) router.replace(`${pathname}?${new URLSearchParams({ ...Object.fromEntries(params.entries()), location: saved }).toString()}`);
      }
    } catch {
      /* storage unavailable */
    }
  }, [params, pathname, key, locations, router]);
  const short = (name: string) => name.replace(/^.*? - /, "");
  return (
    <div className="flex rounded-lg border border-stone-300 bg-white p-0.5 text-sm" role="group" aria-label="Location">
      <Link href={hrefFor(null)} className={cn("rounded-md px-3 py-1", current === null ? "bg-stone-900 text-white" : "text-stone-700 hover:bg-stone-50")}>All</Link>
      {locations.map((l) => (
        <Link key={l.id} href={hrefFor(l.id)} className={cn("rounded-md px-3 py-1", current === l.id ? "bg-stone-900 text-white" : "text-stone-700 hover:bg-stone-50")} title={l.name}>{short(l.name)}</Link>
      ))}
    </div>
  );
}
