/** How a location control presents itself, by how many sites there are. Pure so the thresholds are tested. */

export type LocationControl = "none" | "buttons" | "menu" | "menu-search";

/** Buttons up to three sites; a dropdown from four; a search box in the dropdown from eight. */
export function locationControlFor(count: number): LocationControl {
  if (count < 2) return "none";
  if (count <= 3) return "buttons";
  if (count < 8) return "menu";
  return "menu-search";
}

/**
 * Labels for the sites: "Glow Collective - Reston" reads "Reston", unless that would make two
 * sites look the same, in which case the full names are kept.
 */
export function siteLabels(locations: { id: string; name: string }[]): Map<string, string> {
  const short = (n: string) => n.replace(/^.*? - /, "");
  const shortened = locations.map((l) => short(l.name));
  const unique = new Set(shortened).size === shortened.length;
  return new Map(locations.map((l, i) => [l.id, unique ? shortened[i]! : l.name]));
}
