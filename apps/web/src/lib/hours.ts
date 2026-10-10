import type { WeeklyHours } from "@angelic/core";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const t12 = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  const ap = h! >= 12 ? "pm" : "am";
  const hh = ((h! + 11) % 12) + 1;
  return m ? `${hh}:${String(m).padStart(2, "0")}${ap}` : `${hh}${ap}`;
};

/** "Mon–Fri 10am–6pm · Sat 10am–3pm · Sun closed" style lines, grouping identical consecutive days. */
export function describeHours(hours: WeeklyHours | null | undefined): string[] {
  if (!hours) return [];
  const days = [1, 2, 3, 4, 5, 6, 0]; // Monday first
  const label = (d: number) => { const h = hours[String(d)]; return h ? `${t12(h.open)}–${t12(h.close)}` : "Closed"; };
  const out: string[] = [];
  let i = 0;
  while (i < days.length) {
    let j = i;
    while (j + 1 < days.length && label(days[j + 1]!) === label(days[i]!)) j++;
    const name = (d: number) => WEEKDAYS[d]!.slice(0, 3);
    out.push(`${i === j ? name(days[i]!) : `${name(days[i]!)}–${name(days[j]!)}`} ${label(days[i]!)}`);
    i = j + 1;
  }
  return out;
}

/** Parse the hours editor's fields (h{wd}_closed / h{wd}_open / h{wd}_close) into WeeklyHours; null when nothing was set. */
export function parseHoursForm(get: (name: string) => string | null): WeeklyHours | null {
  const out: WeeklyHours = {};
  let any = false;
  for (let d = 0; d < 7; d++) {
    const closed = get(`h${d}_closed`) === "on";
    const open = get(`h${d}_open`) ?? "";
    const close = get(`h${d}_close`) ?? "";
    if (closed) { out[String(d)] = null; any = true; continue; }
    if (/^\d{2}:\d{2}$/.test(open) && /^\d{2}:\d{2}$/.test(close) && open < close) { out[String(d)] = { open, close }; any = true; }
    else out[String(d)] = null;
  }
  return any ? out : null;
}
