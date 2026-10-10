import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * "All · Sterling · Fairfax" pills for list/report pages. Server component: pass the
 * other query params as a string and it appends `location=`. Renders nothing for a
 * single-location business.
 */
export function LocationFilter({ locations, current, query, allLabel = "All locations" }: { locations: { id: string; name: string }[]; current: string | null; query: string; allLabel?: string }) {
  if (locations.length < 2) return null;
  const href = (id: string | null) => `?${query}${query ? "&" : ""}location=${id ?? ""}`;
  const short = (name: string) => name.replace(/^.*? - /, "");
  return (
    <div className="flex rounded-lg border border-stone-300 bg-white p-0.5 text-sm" role="group" aria-label="Location">
      <Link href={href(null)} className={cn("rounded-md px-3 py-1", current === null ? "bg-stone-900 text-white" : "text-stone-700 hover:bg-stone-50")}>{allLabel}</Link>
      {locations.map((l) => (
        <Link key={l.id} href={href(l.id)} className={cn("rounded-md px-3 py-1", current === l.id ? "bg-stone-900 text-white" : "text-stone-700 hover:bg-stone-50")} title={l.name}>{short(l.name)}</Link>
      ))}
    </div>
  );
}
