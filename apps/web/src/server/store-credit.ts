import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { schema, withTenant, type TenantDb } from "@angelic/db";

/**
 * Store credit: money the business owes a client. A refund kept in-house instead of going back to the
 * card, a deposit returned as credit under the cancellation policy, or a goodwill adjustment. Spent at
 * checkout as a "store_credit" payment. Every change is a ledger row; the client row caches the balance.
 */

export class StoreCreditError extends Error {}

export type StoreCreditReason = "refund" | "deposit_refund" | "payment" | "payment_refund" | "adjust";

export async function storeCreditBalance(tx: TenantDb, clientId: string): Promise<number> {
  const c = await tx.query.clients.findFirst({ where: eq(schema.clients.id, clientId), columns: { storeCreditCents: true } });
  return c?.storeCreditCents ?? 0;
}

/** Add (positive) or spend (negative) credit inside a transaction. Throws if it would go below zero. */
export async function changeStoreCredit(
  tx: TenantDb,
  input: { businessId: string; clientId: string; deltaCents: number; reason: StoreCreditReason; saleId?: string | null; paymentId?: string | null; appointmentId?: string | null; note?: string | null; actorUserId: string | null },
): Promise<number> {
  if (!Number.isInteger(input.deltaCents) || input.deltaCents === 0) throw new StoreCreditError("Enter an amount.");
  const balance = await storeCreditBalance(tx, input.clientId);
  const next = balance + input.deltaCents;
  if (next < 0) throw new StoreCreditError(`Only ${(balance / 100).toFixed(2)} of store credit is available.`);
  await tx.insert(schema.storeCreditLedger).values({
    businessId: input.businessId,
    clientId: input.clientId,
    deltaCents: input.deltaCents,
    reason: input.reason,
    saleId: input.saleId ?? null,
    paymentId: input.paymentId ?? null,
    appointmentId: input.appointmentId ?? null,
    note: input.note ?? null,
    createdByUserId: input.actorUserId,
  });
  await tx.update(schema.clients).set({ storeCreditCents: next }).where(eq(schema.clients.id, input.clientId));
  return next;
}

/** Balance plus recent history, for the client page. */
export async function getClientStoreCredit(businessId: string, clientId: string) {
  return withTenant(businessId, async (tx) => ({
    balance: await storeCreditBalance(tx, clientId),
    history: await tx.select().from(schema.storeCreditLedger).where(eq(schema.storeCreditLedger.clientId, clientId)).orderBy(desc(schema.storeCreditLedger.createdAt)).limit(50),
  }));
}

/** Manager adjustment: a goodwill credit, or taking credit away (with a note). */
export async function adjustStoreCredit(input: { businessId: string; clientId: string; deltaCents: number; note: string | null; actorUserId: string }) {
  await withTenant(input.businessId, (tx) =>
    changeStoreCredit(tx, { businessId: input.businessId, clientId: input.clientId, deltaCents: input.deltaCents, reason: "adjust", note: input.note, actorUserId: input.actorUserId }),
  );
}

/** Credit already given against a payment (so a later card refund cannot double up). */
export async function creditedAgainstPayment(tx: TenantDb, paymentId: string): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`coalesce(sum(${schema.storeCreditLedger.deltaCents}) filter (where ${schema.storeCreditLedger.reason} = 'refund'), 0)` })
    .from(schema.storeCreditLedger)
    .where(eq(schema.storeCreditLedger.paymentId, paymentId));
  return Number(r?.n ?? 0);
}

/** Credit issued (refunds, deposits, adjustments up) and redeemed in a period, for Reports. */
export async function storeCreditSummary(tx: TenantDb, from: Date, to: Date): Promise<{ issuedCents: number; redeemedCents: number }> {
  const [r] = await tx
    .select({
      issued: sql<number>`coalesce(sum(${schema.storeCreditLedger.deltaCents}) filter (where ${schema.storeCreditLedger.deltaCents} > 0), 0)`,
      redeemed: sql<number>`coalesce(sum(-${schema.storeCreditLedger.deltaCents}) filter (where ${schema.storeCreditLedger.reason} = 'payment'), 0)`,
    })
    .from(schema.storeCreditLedger)
    .where(and(gte(schema.storeCreditLedger.createdAt, from), lt(schema.storeCreditLedger.createdAt, to)));
  return { issuedCents: Number(r?.issued ?? 0), redeemedCents: Number(r?.redeemed ?? 0) };
}
