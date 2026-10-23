/**
 * Invoice rules shared by the server, the desk and the client's pay page: which status an invoice is in, what deposit it asks for and
 * what the client can pay now. An invoice's money is its sale (totals, paid so far); the invoice row adds the lifecycle and the dates.
 */

export const INVOICE_STATES = ["draft", "sent", "viewed", "partly_paid", "paid", "overdue", "void"] as const;
export type InvoiceState = (typeof INVOICE_STATES)[number];

export const INVOICE_STATE_LABEL: Record<InvoiceState, string> = { draft: "Draft", sent: "Sent", viewed: "Viewed", partly_paid: "Partly paid", paid: "Paid", overdue: "Overdue", void: "Void" };

type InvoiceBits = { status: "draft" | "sent" | "void"; dueOn: string | null; viewedAt: Date | null };
type SaleBits = { status: "open" | "paid" | "refunded" | "void"; totalCents: number; paidCents: number };

/**
 * Where an invoice stands. Void wins, then paid (a refund later doesn't make it owed again), then overdue (sent, unpaid and past the due
 * date, even when part was paid: that is the one the desk chases), then partly paid, viewed, sent, draft. `today` is YYYY-MM-DD in the
 * business's time zone. server/invoices.ts `stateSql` is the same rule in SQL, for the list's filter; a test keeps them equal.
 */
export function invoiceState(inv: InvoiceBits, sale: SaleBits, today: string): InvoiceState {
  if (inv.status === "void" || sale.status === "void") return "void";
  if (sale.status === "paid" || sale.status === "refunded") return "paid";
  if (inv.status === "sent" && inv.dueOn && inv.dueOn < today) return "overdue";
  if (sale.paidCents > 0) return "partly_paid";
  if (inv.status === "draft") return "draft";
  return inv.viewedAt ? "viewed" : "sent";
}

export type Deposit = { type: "percent" | "amount"; value: number } | null;

/** The deposit in cents: a percent of the total (rounded), or an amount up to the total. Null when the invoice asks for no deposit. */
export function depositCents(deposit: Deposit, totalCents: number): number | null {
  if (!deposit || deposit.value <= 0 || totalCents <= 0) return null;
  if (deposit.type === "percent") return Math.round((totalCents * Math.min(100, deposit.value)) / 100);
  return Math.min(totalCents, deposit.value);
}

export type PayOptions = {
  /** What is still owed. */
  balanceCents: number;
  /** The rest of the deposit, when one was asked for and isn't paid yet. */
  depositDueCents: number | null;
  /** The smallest payment taken now: the rest of the deposit, else $1 (or the balance when less). */
  minCents: number;
};

/** What the client may pay now. A deposit counts as met once payments reach it, however they were made. */
export function payOptions(deposit: Deposit, sale: Pick<SaleBits, "totalCents" | "paidCents">): PayOptions {
  const balanceCents = Math.max(0, sale.totalCents - sale.paidCents);
  const dep = depositCents(deposit, sale.totalCents);
  const depositDueCents = dep != null && dep > sale.paidCents && dep - sale.paidCents < balanceCents ? dep - sale.paidCents : null;
  const minCents = Math.min(balanceCents, depositDueCents ?? 100);
  return { balanceCents, depositDueCents, minCents };
}

/** Which reminder is due on `today`: three days before the due date, on it, a day after and a week after. Earlier ones are skipped once a later one applies. */
export const REMINDER_STEPS = [
  { key: "before", offsetDays: -3 },
  { key: "due", offsetDays: 0 },
  { key: "after_1", offsetDays: 1 },
  { key: "after_7", offsetDays: 7 },
] as const;
export type ReminderKey = (typeof REMINDER_STEPS)[number]["key"];

/**
 * The reminder to send today for an invoice due on `dueOn`, or null. Only the latest step that has come is sent (an invoice sent the day
 * before it is due gets "due tomorrow", never "due in 3 days" as well), and nothing already sent goes twice. A step on or before the day
 * the invoice was sent is skipped: they just got it. Returns the step and every earlier step to mark as done with it.
 */
export function reminderDue(dueOn: string, today: string, sentOn: string, alreadySent: readonly string[], addDays: (iso: string, n: number) => string): { key: ReminderKey; markAlso: ReminderKey[] } | null {
  const come = REMINDER_STEPS.filter((s) => addDays(dueOn, s.offsetDays) <= today);
  const latest = come[come.length - 1];
  if (!latest || alreadySent.includes(latest.key)) return null;
  if (addDays(dueOn, latest.offsetDays) <= sentOn) return null;
  return { key: latest.key, markAlso: come.slice(0, -1).map((s) => s.key).filter((k) => !alreadySent.includes(k)) };
}

/** An invoice link's token: 32 random bytes, base64url (43 characters). Anything else is refused before the database is asked. */
export const INVOICE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
