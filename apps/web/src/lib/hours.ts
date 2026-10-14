import type { WeeklyHours } from "@angelic/core";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** "09:00" → "9am", "17:30" → "5:30pm". */
export const time12 = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  const ap = h! >= 12 ? "pm" : "am";
  const hh = ((h! + 11) % 12) + 1;
  return m ? `${hh}:${String(m).padStart(2, "0")}${ap}` : `${hh}${ap}`;
};

/** One line per day, Monday first: "Mon 10am–6pm", …, "Sun Closed". */
export function describeHours(hours: WeeklyHours | null | undefined): string[] {
  if (!hours) return [];
  const days = [1, 2, 3, 4, 5, 6, 0]; // Monday first
  return days.map((d) => {
    const h = hours[String(d)];
    return `${WEEKDAYS[d]!.slice(0, 3)} ${h ? `${time12(h.open)}–${time12(h.close)}` : "Closed"}`;
  });
}

/** "Open today 9am–7pm" or "Closed today"; null when the location has no hours set. */
export function hoursToday(hours: WeeklyHours | null | undefined, tz: string, now = new Date()): string | null {
  if (!hours) return null;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: tz }).format(now));
  const h = hours[String(wd)];
  return h ? `Open today ${time12(h.open)}–${time12(h.close)}` : "Closed today";
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
