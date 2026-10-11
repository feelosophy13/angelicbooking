import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { schema, withTenant, type TenantDb } from "@angelic/db";

/**
 * Refund reasons: a short managed list per business so refunds can be grouped by cause. Every
 * business starts with the defaults; owners rename, reorder, add and retire them under
 * Settings → Refund reasons. A refund points at a reason and may carry a free-text note.
 */

export class RefundReasonError extends Error {}

export const DEFAULT_REFUND_REASONS = ["Service issue", "Client changed mind", "Duplicate charge", "Late cancellation", "Goodwill", "Other"];

/** Seed the defaults for a business that has none yet (idempotent). */
export async function ensureRefundReasons(tx: TenantDb, businessId: string) {
  const [row] = await tx.select({ n: sql<number>`count(*)` }).from(schema.refundReasons);
  if (Number(row?.n ?? 0) > 0) return;
  await tx.insert(schema.refundReasons).values(DEFAULT_REFUND_REASONS.map((name, i) => ({ businessId, name, sortOrder: i })));
}

export async function listRefundReasons(businessId: string, opts: { includeRetired?: boolean } = {}) {
  return withTenant(businessId, async (tx) => {
    await ensureRefundReasons(tx, businessId);
    const rows = await tx.select().from(schema.refundReasons).orderBy(asc(schema.refundReasons.sortOrder), asc(schema.refundReasons.name));
    return opts.includeRetired ? rows : rows.filter((r) => r.active);
  });
}

export async function createRefundReason(businessId: string, name: string) {
  const clean = name.trim();
  if (!clean) throw new RefundReasonError("Enter a reason.");
  await withTenant(businessId, async (tx) => {
    await ensureRefundReasons(tx, businessId);
    const [max] = await tx.select({ m: sql<number>`coalesce(max(${schema.refundReasons.sortOrder}), -1)` }).from(schema.refundReasons);
    await tx.insert(schema.refundReasons).values({ businessId, name: clean, sortOrder: Number(max?.m ?? -1) + 1 });
  });
}

export async function renameRefundReason(businessId: string, id: string, name: string) {
  const clean = name.trim();
  if (!clean) throw new RefundReasonError("Enter a reason.");
  await withTenant(businessId, (tx) => tx.update(schema.refundReasons).set({ name: clean }).where(eq(schema.refundReasons.id, id)));
}

export async function setRefundReasonActive(businessId: string, id: string, active: boolean) {
  await withTenant(businessId, async (tx) => {
    if (!active) {
      const [n] = await tx.select({ n: sql<number>`count(*)` }).from(schema.refundReasons).where(eq(schema.refundReasons.active, true));
      if (Number(n?.n ?? 0) <= 1) throw new RefundReasonError("Keep at least one reason.");
    }
    await tx.update(schema.refundReasons).set({ active }).where(eq(schema.refundReasons.id, id));
  });
}

/** Swap sort positions with the neighbour above or below. */
export async function moveRefundReason(businessId: string, id: string, dir: "up" | "down") {
  await withTenant(businessId, async (tx) => {
    const rows = await tx.select().from(schema.refundReasons).orderBy(asc(schema.refundReasons.sortOrder), asc(schema.refundReasons.name));
    const i = rows.findIndex((r) => r.id === id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= rows.length) return;
    // Normalise to 0..n first so swaps are well defined even after deletes.
    for (let k = 0; k < rows.length; k++) if (rows[k]!.sortOrder !== k) await tx.update(schema.refundReasons).set({ sortOrder: k }).where(eq(schema.refundReasons.id, rows[k]!.id));
    await tx.update(schema.refundReasons).set({ sortOrder: j }).where(eq(schema.refundReasons.id, rows[i]!.id));
    await tx.update(schema.refundReasons).set({ sortOrder: i }).where(eq(schema.refundReasons.id, rows[j]!.id));
  });
}

/**
 * Change the reason and note on a refund that already happened (the amount and where the money went
 * stay fixed). Works for card/cash refunds (refunds table) and store-credit refunds (ledger rows).
 */
export async function updateRefundReason(input: { businessId: string; kind: "refund" | "credit"; id: string; reasonId: string | null; note: string | null; actorUserId: string }) {
  await withTenant(input.businessId, async (tx) => {
    if (input.reasonId) {
      const ok = await tx.query.refundReasons.findFirst({ where: eq(schema.refundReasons.id, input.reasonId), columns: { id: true } });
      if (!ok) throw new RefundReasonError("Pick a reason from the list.");
    }
    if (input.kind === "refund") {
      const r = await tx.query.refunds.findFirst({ where: eq(schema.refunds.id, input.id) });
      if (!r) throw new RefundReasonError("Refund not found.");
      await tx.update(schema.refunds).set({ reasonId: input.reasonId, reason: input.note }).where(eq(schema.refunds.id, r.id));
      const p = await tx.query.payments.findFirst({ where: eq(schema.payments.id, r.paymentId), columns: { saleId: true } });
      await tx.insert(schema.auditLog).values({ businessId: input.businessId, actorUserId: input.actorUserId, action: "refund.reason_change", entity: "sale", entityId: p?.saleId ?? r.id, diff: JSON.stringify({ refundId: r.id, before: { reasonId: r.reasonId, note: r.reason }, after: { reasonId: input.reasonId, note: input.note } }) });
    } else {
      const c = await tx.query.storeCreditLedger.findFirst({ where: eq(schema.storeCreditLedger.id, input.id) });
      if (!c || c.reason !== "refund") throw new RefundReasonError("Refund not found.");
      await tx.update(schema.storeCreditLedger).set({ refundReasonId: input.reasonId, note: input.note }).where(eq(schema.storeCreditLedger.id, c.id));
      await tx.insert(schema.auditLog).values({ businessId: input.businessId, actorUserId: input.actorUserId, action: "refund.reason_change", entity: "sale", entityId: c.saleId ?? c.id, diff: JSON.stringify({ creditId: c.id, before: { reasonId: c.refundReasonId, note: c.note }, after: { reasonId: input.reasonId, note: input.note } }) });
    }
  });
}

/** Refunds (money back and store credit) by reason in a period, for Reports. */
export async function refundsByReason(tx: TenantDb, from: Date, to: Date): Promise<{ reasonId: string | null; name: string; count: number; moneyCents: number; creditCents: number }[]> {
  const [money, credit, reasons] = await Promise.all([
    tx
      .select({ reasonId: schema.refunds.reasonId, count: sql<number>`count(*)`, amount: sql<number>`coalesce(sum(${schema.refunds.amountCents}), 0)` })
      .from(schema.refunds)
      .where(and(gte(schema.refunds.createdAt, from), lt(schema.refunds.createdAt, to)))
      .groupBy(schema.refunds.reasonId),
    tx
      .select({ reasonId: schema.storeCreditLedger.refundReasonId, count: sql<number>`count(*)`, amount: sql<number>`coalesce(sum(${schema.storeCreditLedger.deltaCents}), 0)` })
      .from(schema.storeCreditLedger)
      .where(and(eq(schema.storeCreditLedger.reason, "refund"), gte(schema.storeCreditLedger.createdAt, from), lt(schema.storeCreditLedger.createdAt, to)))
      .groupBy(schema.storeCreditLedger.refundReasonId),
    tx.select({ id: schema.refundReasons.id, name: schema.refundReasons.name }).from(schema.refundReasons).orderBy(desc(schema.refundReasons.active), asc(schema.refundReasons.sortOrder)),
  ]);
  const out = new Map<string, { reasonId: string | null; name: string; count: number; moneyCents: number; creditCents: number }>();
  const nameOf = (id: string | null) => (id ? reasons.find((r) => r.id === id)?.name ?? "Retired reason" : "No reason given");
  for (const r of money) {
    const k = r.reasonId ?? "none";
    const cur = out.get(k) ?? { reasonId: r.reasonId, name: nameOf(r.reasonId), count: 0, moneyCents: 0, creditCents: 0 };
    cur.count += Number(r.count); cur.moneyCents += Number(r.amount); out.set(k, cur);
  }
  for (const r of credit) {
    const k = r.reasonId ?? "none";
    const cur = out.get(k) ?? { reasonId: r.reasonId, name: nameOf(r.reasonId), count: 0, moneyCents: 0, creditCents: 0 };
    cur.count += Number(r.count); cur.creditCents += Number(r.amount); out.set(k, cur);
  }
  return [...out.values()].sort((a, b) => b.moneyCents + b.creditCents - (a.moneyCents + a.creditCents));
}
