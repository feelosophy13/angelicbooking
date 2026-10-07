/** One place for every human-facing format so screens agree with each other. */

export function money(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

export function dateShort(at: Date | string, tz?: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: tz ?? (typeof at === "string" ? "UTC" : undefined) }).format(typeof at === "string" ? new Date(at + "T00:00:00Z") : at);
}

export function dateLong(at: Date | string, tz?: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: tz ?? (typeof at === "string" ? "UTC" : undefined) }).format(typeof at === "string" ? new Date(at + "T00:00:00Z") : at);
}

export function weekdayShort(isoDate: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(isoDate + "T00:00:00Z"));
}

export function time(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(at);
}

export function dateTime(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz }).format(at);
}

/** 75 → "1 h 15 min", 45 → "45 min", 120 → "2 h" */
export function duration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${m} min`;
}

/** Minutes → hours with two decimals for payroll tables ("7.50"). */
export function hours(min: number): string {
  return (min / 60).toFixed(2);
}

export function relative(at: Date, now = new Date()): string {
  const diff = (at.getTime() - now.getTime()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

export const STATUS_LABEL: Record<string, string> = {
  booked: "Booked",
  confirmed: "Confirmed",
  checked_in: "Checked in",
  in_progress: "In progress",
  completed: "Completed",
  no_show: "No-show",
  cancelled: "Cancelled",
  open: "Open",
  paid: "Paid",
  refunded: "Refunded",
  void: "Void",
  pending: "Pending",
  succeeded: "Succeeded",
  failed: "Failed",
  partially_refunded: "Partially refunded",
  queued: "Queued",
  sent: "Sent",
  skipped: "Skipped",
  active: "Active",
  paused: "Paused",
  draft: "Draft",
  finalized: "Finalized",
};

export const statusLabel = (s: string) => STATUS_LABEL[s] ?? s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
