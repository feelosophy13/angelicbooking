/**
 * The calendar's ways of getting around without the mouse: the mini month in the "Pick a date" popover and the keyboard
 * shortcuts (the same keys Google Calendar uses, so a desk that knows one knows the other). Pure, so it is tested.
 */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** `YYYY-MM-DD` for the given UTC day. */
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

/** The first day of the month `date` (YYYY-MM-DD) falls in. */
export function monthStartOf(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** The first day of the month `n` months after `monthStart`. */
export function shiftMonth(monthStart: string, n: number): string {
  const [y, m] = monthStart.split("-").map(Number);
  return iso(y!, m! + n, 1);
}

/** "October 2026" for a month start. */
export function monthLabel(monthStart: string): string {
  const [y, m] = monthStart.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y!, m! - 1, 1)));
}

/**
 * The cells of a Monday-first mini month: whole weeks, with the days of the months before and after filled in (they are
 * `outside`) so the grid is always a block of full rows, like the month view.
 */
export function miniMonthCells(monthStart: string): { date: string; day: number; outside: boolean }[] {
  const [y, m] = monthStart.split("-").map(Number);
  const first = new Date(Date.UTC(y!, m! - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  const total = Math.ceil((lead + daysInMonth) / 7) * 7;
  return Array.from({ length: total }, (_, i) => {
    const d = new Date(Date.UTC(y!, m! - 1, 1 + i - lead));
    return { date: d.toISOString().slice(0, 10), day: d.getUTCDate(), outside: i < lead || i >= lead + daysInMonth };
  });
}

export const MINI_MONTH_WEEKDAYS = WEEKDAYS;

export type CalendarShortcut = "today" | "prev" | "next" | "day" | "week" | "month" | "create" | "search" | "help" | "pick";

/** What a key does on the calendar, in the order shown in the shortcuts help. */
export const SHORTCUTS: { keys: string[]; action: CalendarShortcut; label: string }[] = [
  { keys: ["t"], action: "today", label: "Go to today" },
  { keys: ["←", "j", "p"], action: "prev", label: "Previous day, week or month" },
  { keys: ["→", "k", "n"], action: "next", label: "Next day, week or month" },
  { keys: ["g"], action: "pick", label: "Pick a date" },
  { keys: ["d"], action: "day", label: "Day view" },
  { keys: ["w"], action: "week", label: "Week view" },
  { keys: ["m"], action: "month", label: "Month view" },
  { keys: ["c"], action: "create", label: "New appointment" },
  { keys: ["/"], action: "search", label: "Search" },
  { keys: ["?"], action: "help", label: "These shortcuts" },
];

const BY_KEY = new Map<string, CalendarShortcut>([
  ["t", "today"], ["ArrowLeft", "prev"], ["j", "prev"], ["p", "prev"], ["ArrowRight", "next"], ["k", "next"], ["n", "next"],
  ["g", "pick"], ["d", "day"], ["w", "week"], ["m", "month"], ["c", "create"], ["/", "search"], ["?", "help"],
]);

/**
 * The shortcut a key press means, or null. Nothing fires while typing in a field (a search box, a notes field, a select) or with
 * a modifier held (⌘K is the palette's, ⌘← is the browser's back), so the keys never steal input.
 */
export function shortcutFor(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; inField: boolean }): CalendarShortcut | null {
  if (e.inField || e.metaKey || e.ctrlKey || e.altKey) return null;
  return BY_KEY.get(e.key) ?? null;
}

/** Whether the focused element takes typing, so shortcuts must stay out of its way. */
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return (el as HTMLElement).isContentEditable === true;
}
