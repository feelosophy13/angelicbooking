import type { ServiceGroup } from "@/components/service-picker";

/**
 * What a service filter holds: one service, or a whole category (and everything under it). It travels as one
 * query value: a service id, or `c:<category id>` (the value of an "All of <category>" row in ServicePicker).
 */
export type ServiceScope = { serviceId: string | null; categoryId: string | null };
export const NO_SCOPE: ServiceScope = { serviceId: null, categoryId: null };

/** Read the query value, keeping it only when the picker actually offers it. */
export function parseScope(value: string | null | undefined, groups: ServiceGroup[]): ServiceScope {
  if (!value) return NO_SCOPE;
  const offered = groups.some((g) => g.whole?.id === value || g.services.some((s) => s.id === value));
  if (!offered) return NO_SCOPE;
  return value.startsWith("c:") ? { serviceId: null, categoryId: value.slice(2) } : { serviceId: value, categoryId: null };
}

/** The query value for a scope, or null when there is none. */
export const scopeValue = (s: ServiceScope): string | null => (s.categoryId ? `c:${s.categoryId}` : s.serviceId);

/** What the filter is called on screen, for "Showing …" lines. */
export function scopeLabel(s: ServiceScope, groups: ServiceGroup[]): string | null {
  const v = scopeValue(s);
  if (!v) return null;
  for (const g of groups) {
    if (g.whole?.id === v) return g.whole.name.replace(/^All of /, "");
    const hit = g.services.find((x) => x.id === v);
    if (hit) return hit.name;
  }
  return null;
}
