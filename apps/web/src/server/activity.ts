import { and, asc, eq, inArray, or } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { formatMoney } from "@/lib/utils";

/**
 * Who did what to an appointment and its ticket, read back from the activity log so every page
 * can answer "who booked this?", "who took the payment?", "who cancelled it?" without a second
 * record. The log already captures every action with an actor; this resolves names and turns
 * the raw action keys into sentences.
 */

export interface ActivityEvent {
  id: string;
  at: Date;
  /** "Ava Martinez", "the client", "online booking", "a staff member". */
  actor: string;
  /** Past-tense sentence without the actor, e.g. "booked the appointment". */
  what: string;
  /** Extra detail in grey, e.g. "client sick" or "$45.00 cash". */
  detail: string | null;
  /** Whether this row relates to the sale ticket rather than the appointment itself. */
  onTicket: boolean;
}

export interface ActivitySummary {
  bookedBy: { actor: string; at: Date; source: string } | null;
  /** Latest status change (cancelled, no-show, completed, checked in…). */
  lastStatus: { actor: string; at: Date; what: string; detail: string | null } | null;
  /** Whoever recorded the payment that closed the ticket. */
  paidBy: { actor: string; at: Date } | null;
}

const STATUS_WORDS: Record<string, string> = {
  booked: "marked it booked",
  confirmed: "confirmed it",
  checked_in: "checked the client in",
  in_progress: "started the service",
  completed: "marked it completed",
  no_show: "marked it a no-show",
  cancelled: "cancelled it",
};

const METHOD_WORDS: Record<string, string> = { cash: "cash", other: "another method", card: "card", card_on_file: "the card on file", terminal: "the terminal", gift_card: "a gift card", loyalty: "loyalty points", store_credit: "store credit" };

function describe(action: string, diff: Record<string, unknown>, currency: string, source: string | null): { what: string; detail: string | null } {
  const money = (c: unknown) => (typeof c === "number" ? formatMoney(c, currency) : null);
  const reason = typeof diff.reason === "string" && diff.reason ? diff.reason : null;
  if (action === "appointment.create") return { what: source === "online" ? "booked online" : "booked the appointment", detail: diff.depositCents ? `deposit ${money(diff.depositCents)}` : null };
  if (action === "appointment.block") return { what: "blocked the time", detail: reason };
  if (action === "class.enrol") return { what: source === "online" ? "enrolled online" : "enrolled the client", detail: null };
  if (action === "appointment.add_service") return { what: "added a service", detail: null };
  if (action === "appointment.remove_service") return { what: "removed a service", detail: null };
  if (action === "appointment.reschedule") return { what: "moved the appointment", detail: null };
  if (action === "appointment.notes") return { what: "edited the notes", detail: null };
  if (action.startsWith("appointment.")) {
    const status = action.slice("appointment.".length);
    return { what: STATUS_WORDS[status] ?? `set it to ${status.replace("_", " ")}`, detail: reason };
  }
  if (action === "sale.open") return { what: diff.walkIn ? "started a ticket" : "opened the ticket", detail: null };
  if (action === "sale.paid") return { what: "closed the ticket as paid", detail: money(diff.total) ? `total ${money(diff.total)}` : null };
  if (action === "sale.void") return { what: "voided the ticket", detail: null };
  if (action === "sale.client") return { what: "changed the client on the ticket", detail: null };
  if (action === "sale.add_service") return { what: "added a service to the ticket", detail: null };
  if (action === "sale.edit_line") return { what: "edited a line on the ticket", detail: null };
  if (action === "sale.promo") return { what: "applied a promo code", detail: null };
  if (action === "sale.promo_removed") return { what: "removed the promo code", detail: null };
  if (action.startsWith("payment.refund_store_credit")) return { what: "refunded as store credit", detail: money(diff.amount) };
  if (action === "payment.refund") return { what: "issued a refund", detail: [money(diff.amount), reason].filter(Boolean).join(" · ") || null };
  if (action.startsWith("payment.")) {
    const m = action.slice("payment.".length);
    return { what: `recorded a ${METHOD_WORDS[m] ?? m.replace("_", " ")} payment`, detail: money(diff.amount) };
  }
  if (action === "refund.reason_change") return { what: "changed a refund's reason", detail: null };
  if (action === "deposit.refund") return { what: "refunded the deposit to the card", detail: [money(diff.cents), reason].filter(Boolean).join(" · ") || null };
  if (action === "deposit.store_credit") return { what: "returned the deposit as store credit", detail: [money(diff.cents), reason].filter(Boolean).join(" · ") || null };
  return { what: action.replace(/[._]/g, " "), detail: null };
}

export async function appointmentActivity(business: { id: string; currency: string }, appointmentId: string): Promise<{ events: ActivityEvent[]; summary: ActivitySummary }> {
  const { rows, appt, saleIds } = await withTenant(business.id, async (tx) => {
    const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, appointmentId), columns: { source: true, createdAt: true, createdByUserId: true, cancelledAt: true, cancellationReason: true, status: true } });
    const sales = await tx.select({ id: schema.sales.id }).from(schema.sales).where(eq(schema.sales.appointmentId, appointmentId));
    const saleIds = sales.map((s) => s.id);
    const rows = await tx
      .select()
      .from(schema.auditLog)
      .where(or(and(eq(schema.auditLog.entity, "appointment"), eq(schema.auditLog.entityId, appointmentId)), ...(saleIds.length ? [and(eq(schema.auditLog.entity, "sale"), inArray(schema.auditLog.entityId, saleIds))] : [])))
      .orderBy(asc(schema.auditLog.at));
    return { rows, appt, saleIds };
  });
  // Imported or seeded appointments predate the log: reconstruct the basics from the row itself.
  const synthetic: (typeof schema.auditLog.$inferSelect)[] = [];
  if (appt && !rows.some((r) => r.action === "appointment.create" || r.action === "appointment.block" || r.action === "class.enrol")) {
    synthetic.push({ id: `synthetic:create:${appointmentId}`, businessId: business.id, actorUserId: appt.createdByUserId, action: "appointment.create", entity: "appointment", entityId: appointmentId, diff: null, at: appt.createdAt });
  }
  if (appt?.cancelledAt && !rows.some((r) => r.action === "appointment.cancelled")) {
    synthetic.push({ id: `synthetic:cancel:${appointmentId}`, businessId: business.id, actorUserId: null, action: "appointment.cancelled", entity: "appointment", entityId: appointmentId, diff: appt.cancellationReason ? JSON.stringify({ reason: appt.cancellationReason }) : null, at: appt.cancelledAt });
  }
  const all = [...rows, ...synthetic].sort((x, y) => x.at.getTime() - y.at.getTime());
  return shape(all, business.currency, appt?.source ?? null, new Set(saleIds));
}

export async function saleActivity(business: { id: string; currency: string }, saleId: string): Promise<{ events: ActivityEvent[]; summary: ActivitySummary }> {
  const { rows, source, apptId } = await withTenant(business.id, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, saleId), columns: { appointmentId: true } });
    const appt = sale?.appointmentId ? await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, sale.appointmentId), columns: { source: true } }) : null;
    const rows = await tx
      .select()
      .from(schema.auditLog)
      .where(or(and(eq(schema.auditLog.entity, "sale"), eq(schema.auditLog.entityId, saleId)), ...(sale?.appointmentId ? [and(eq(schema.auditLog.entity, "appointment"), eq(schema.auditLog.entityId, sale.appointmentId))] : [])))
      .orderBy(asc(schema.auditLog.at));
    return { rows, source: appt?.source ?? null, apptId: sale?.appointmentId ?? null };
  });
  void apptId;
  return shape(rows, business.currency, source, new Set([saleId]));
}

async function shape(rows: (typeof schema.auditLog.$inferSelect)[], currency: string, source: string | null, saleIds: Set<string>) {
  const userIds = [...new Set(rows.map((r) => r.actorUserId).filter((x): x is string => !!x && x !== "client"))];
  const users = userIds.length ? await db.select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, userIds)) : [];
  const actorName = (id: string | null, action: string) => {
    if (id === "client") return "the client";
    if (!id) return (action === "appointment.create" || action === "class.enrol") && source === "online" ? "the client" : "a staff member";
    return users.find((u) => u.id === id)?.name ?? "a former staff member";
  };
  const events: ActivityEvent[] = rows.map((r) => {
    let diff: Record<string, unknown> = {};
    try { diff = r.diff ? (JSON.parse(r.diff) as Record<string, unknown>) : {}; } catch { /* leave empty */ }
    const d = describe(r.action, diff, currency, source);
    return { id: r.id, at: r.at, actor: actorName(r.actorUserId, r.action), what: d.what, detail: d.detail, onTicket: r.entity === "sale" || r.action.startsWith("payment.") || r.action.startsWith("refund.") };
  });
  const created = events.find((e, i) => rows[i]!.action === "appointment.create" || rows[i]!.action === "appointment.block" || rows[i]!.action === "class.enrol");
  const statusRows = rows.map((r, i) => ({ r, e: events[i]! })).filter(({ r }) => /^appointment\.(booked|confirmed|checked_in|in_progress|completed|no_show|cancelled)$/.test(r.action));
  const last = statusRows[statusRows.length - 1];
  const paid = rows.map((r, i) => ({ r, e: events[i]! })).filter(({ r }) => r.action === "sale.paid" && saleIds.has(r.entityId ?? "")).pop();
  return {
    events,
    summary: {
      bookedBy: created ? { actor: created.actor, at: created.at, source: source ?? "staff" } : null,
      lastStatus: last ? { actor: last.e.actor, at: last.e.at, what: last.e.what, detail: last.e.detail } : null,
      paidBy: paid ? { actor: paid.e.actor, at: paid.e.at } : null,
    },
  };
}
