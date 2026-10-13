"use client";
import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LocationSwitch } from "@/components/location-switch";

/**
 * One-click location filter for the calendar. The choice is remembered per
 * business in localStorage so opening the calendar from the sidebar comes back
 * to the same location until "All" is picked.
 */
export function LocationPills({ businessId, locations, current, query }: { businessId: string; locations: { id: string; name: string }[]; current: string | null; query: string }) {
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
  return <LocationSwitch locations={locations} current={current} query={query} allLabel="All" />;
}
