/**
 * Saved replies the desk picks from in the Inbox. Each business keeps its own list
 * (Settings → Text wording); until it saves one, these defaults apply. Bodies use the
 * same {placeholder} syntax as the automated texts (renderSms).
 */
import { renderSms } from "./render";

export type QuickReply = { title: string; body: string };

export const QUICK_REPLY_PLACEHOLDERS = ["{first_name}", "{business}", "{next_appointment}", "{service}", "{staff}"] as const;
export const MAX_QUICK_REPLIES = 20;

export const DEFAULT_QUICK_REPLIES: QuickReply[] = [
  { title: "Running late", body: "No problem {first_name}, see you soon!" },
  { title: "Confirm", body: "Hi {first_name}, just checking you're still good for {service} on {next_appointment}. Reply YES to confirm." },
  { title: "Openings", body: "Hi {first_name}, we have openings this week. Reply with a day and time that suits you and we'll book you in." },
  { title: "Thanks", body: "Thank you {first_name}, it was lovely to see you! Book your next visit any time." },
];

/** The business's own list, or the defaults until it saves one. */
export function quickRepliesFor(business: { quickReplies?: QuickReply[] | null }): QuickReply[] {
  return business.quickReplies?.length ? business.quickReplies : DEFAULT_QUICK_REPLIES;
}

export type QuickReplyContext = { firstName: string; business: string; /** The client's next booked visit, if any. */ next?: { when: string; service: string; staff: string } | null };

/** Placeholder values for one client. With no upcoming visit the appointment words fall back to something that still reads. */
export function quickReplyVars(ctx: QuickReplyContext): Record<string, string> {
  return {
    first_name: ctx.firstName || "there",
    business: ctx.business,
    next_appointment: ctx.next?.when ?? "your next appointment",
    service: ctx.next?.service ?? "your appointment",
    staff: ctx.next?.staff ?? "us",
  };
}

export function renderQuickReply(body: string, ctx: QuickReplyContext): string {
  return renderSms(body, quickReplyVars(ctx));
}

/** Clean a list posted from the settings form: trimmed, capped, rows with no body dropped. */
export function normalizeQuickReplies(rows: { title: string; body: string }[]): QuickReply[] {
  return rows
    .map((r) => ({ title: r.title.trim().slice(0, 40), body: r.body.trim().slice(0, 500) }))
    .filter((r) => r.body)
    .map((r) => ({ ...r, title: r.title || r.body.slice(0, 24) }))
    .slice(0, MAX_QUICK_REPLIES);
}
