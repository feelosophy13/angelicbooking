/**
 * Pure helpers for the Inbox: ordering and filtering conversations, the wording of a
 * text's delivery state, and the short times the list and thread show. No database.
 */

export type ConversationFilter = "all" | "unread" | "needs_reply" | "opted_out";
export const CONVERSATION_FILTERS: { key: ConversationFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "needs_reply", label: "Needs reply" },
  { key: "opted_out", label: "Opted out" },
];
export const asFilter = (v: string | null | undefined): ConversationFilter => (CONVERSATION_FILTERS.some((f) => f.key === v) ? (v as ConversationFilter) : "all");

type Sortable = { unread: number; lastAt: Date; lastDir: "in" | "out"; smsOptIn: boolean };

/** Unread conversations first (so the desk's work is at the top), then everything else; newest first within each. */
export function sortConversations<T extends Sortable>(items: T[]): T[] {
  return [...items].sort((a, b) => Number(!!b.unread) - Number(!!a.unread) || b.lastAt.getTime() - a.lastAt.getTime());
}

/** "Needs reply": the last word was the client's. */
export const needsReply = (c: { lastDir: "in" | "out" }) => c.lastDir === "in";

export function filterConversations<T extends Sortable>(items: T[], filter: ConversationFilter): T[] {
  switch (filter) {
    case "unread":
      return items.filter((c) => c.unread > 0);
    case "needs_reply":
      return items.filter(needsReply);
    case "opted_out":
      return items.filter((c) => !c.smsOptIn);
    default:
      return items;
  }
}

export type DeliveryTone = "muted" | "ok" | "bad" | "wait";

/**
 * One short line under an outgoing text. `status` is the notification's own status and
 * `deliveryStatus` the carrier's receipt; `error` is the plain-words reason when it stopped.
 */
export function deliveryLabel(m: { status: string; deliveryStatus?: string | null; error?: string | null }): { text: string; tone: DeliveryTone; retry: boolean } {
  const why = m.error ? ` · ${m.error.replace(/ \(retrying\)$/, "")}` : "";
  if (m.status === "queued" && m.error?.endsWith("(retrying)")) return { text: `Trying again${why}`, tone: "wait", retry: false };
  if (m.status === "queued") return { text: "Waiting to send", tone: "wait", retry: false };
  if (m.status === "sending") return { text: "Sending…", tone: "wait", retry: false };
  if (m.status === "failed") return { text: `Not delivered${why}`, tone: "bad", retry: true };
  if (m.status === "skipped") return { text: `Not sent${why}`, tone: "muted", retry: true };
  if (m.deliveryStatus === "delivered") return { text: "Delivered", tone: "ok", retry: false };
  return { text: "Sent", tone: "muted", retry: false };
}

/** What an automated text is, for the small label on its bubble; null for a reply typed by staff. */
export function automatedLabel(template: string): string | null {
  const names: Record<string, string> = {
    staff_reply: "",
    confirmation: "Confirmation",
    reminder: "Reminder",
    rescheduled: "Rescheduled",
    cancellation: "Cancellation",
    forms_nudge: "Forms reminder",
    review_request: "Review request",
    receipt: "Receipt",
    campaign: "Campaign",
    waitlist_offer: "Waitlist offer",
    client_code: "Sign-in code",
  };
  if (template in names) return names[template] || null;
  return template.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

const dayKey = (at: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

/** "3:06 PM" today, "Yesterday", a weekday within the week, else "Oct 3" (with the year when it is not this one). */
export function whenShort(at: Date, tz: string, now = new Date()): string {
  const today = dayKey(now, tz);
  const day = dayKey(at, tz);
  if (day === today) return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(at);
  if (day === dayKey(new Date(now.getTime() - 86_400_000), tz)) return "Yesterday";
  const age = now.getTime() - at.getTime();
  if (age > 0 && age < 6 * 86_400_000) return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(at);
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", ...(day.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }) }).format(at);
}

/** The separator above the first text of a day: "Today", "Yesterday", else "Friday, October 3". */
export function dayLabel(at: Date, tz: string, now = new Date()): string {
  const day = dayKey(at, tz);
  if (day === dayKey(now, tz)) return "Today";
  if (day === dayKey(new Date(now.getTime() - 86_400_000), tz)) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", ...(day.slice(0, 4) === dayKey(now, tz).slice(0, 4) ? {} : { year: "numeric" }) }).format(at);
}

/** Group a thread (oldest first) into days for the separators. */
export function groupByDay<T extends { at: Date }>(items: T[], tz: string, now = new Date()): { label: string; items: T[] }[] {
  const out: { key: string; label: string; items: T[] }[] = [];
  for (const m of items) {
    const key = dayKey(m.at, tz);
    const last = out[out.length - 1];
    if (last && last.key === key) last.items.push(m);
    else out.push({ key, label: dayLabel(m.at, tz, now), items: [m] });
  }
  return out.map(({ label, items }) => ({ label, items }));
}
