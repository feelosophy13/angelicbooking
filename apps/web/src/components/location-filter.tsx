import { LocationSwitch } from "@/components/location-switch";

/**
 * Location control for list/report pages ("All · Sterling · Fairfax" buttons for up to three
 * sites, a dropdown beyond that). Pass the other query params as a string and it appends
 * `location=`. Renders nothing for a single-location business.
 */
export function LocationFilter({ locations, current, query, allLabel = "All locations" }: { locations: { id: string; name: string }[]; current: string | null; query: string; allLabel?: string }) {
  return <LocationSwitch locations={locations} current={current} query={query} allLabel={allLabel} />;
}
