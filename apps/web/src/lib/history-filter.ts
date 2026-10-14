import { instantToISODate, zonedToInstant } from "@angelic/core";
import { shiftISODate } from "@/lib/utils";
import { reasonsFor } from "@/lib/inventory";

export type HistoryParams = { range?: string; from?: string; to?: string; reason?: string; who?: string; loc?: string; product?: string; q?: string; page?: string };

export const HISTORY_RANGES = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "all", label: "All time" },
] as const;

const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * What the History page's address means: a quick range (last 7, 30, 90 days or all time) or a from/to pair, read in the business's own
 * time zone so "today" is the owner's today. The end date is included. Anything unreadable falls back to the last 30 days.
 */
export function historyFilterFromParams(sp: HistoryParams, timeZone: string, now = new Date()) {
  const today = instantToISODate(now, timeZone);
  let from: string | null;
  let to: string | null = null;
  const custom = sp.range === "custom" || (!sp.range && (isDate(sp.from) || isDate(sp.to)));
  if (custom) {
    const none = !isDate(sp.from) && !isDate(sp.to);
    from = isDate(sp.from) ? sp.from : none ? shiftISODate(today, -29) : null;
    to = isDate(sp.to) ? sp.to : null;
    if (from && to && from > to) [from, to] = [to, from];
  } else if (sp.range === "all") from = null;
  else from = shiftISODate(today, -(["7", "30", "90"].includes(sp.range ?? "") ? Number(sp.range) - 1 : 29));
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  return {
    filter: {
      from: from ? zonedToInstant(from, "00:00", timeZone) : undefined,
      until: to ? zonedToInstant(shiftISODate(to, 1), "00:00", timeZone) : undefined,
      reasons: sp.reason ? reasonsFor(sp.reason) : undefined,
      userId: sp.who || undefined,
      locationId: sp.loc || undefined,
      productId: sp.product || undefined,
      q: sp.q?.trim() || undefined,
    },
    page,
    range: custom ? "custom" : ["7", "30", "90", "all"].includes(sp.range ?? "") ? sp.range! : "30",
    fromDate: from,
    toDate: to,
  };
}
