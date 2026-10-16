import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { schema, withTenant, type TenantDb } from "@angelic/db";

/**
 * Cancellation reasons: a short managed list per business so cancellations can be grouped by cause.
 * Every business starts with the defaults; owners rename, reorder, add and retire them under
 * Settings → Cancellation reasons. An appointment points at a reason and may carry a free-text note.
 */

export class CancellationReasonError extends Error {}

export const DEFAULT_CANCELLATION_REASONS: { name: string; clientVisible: boolean }[] = [
  { name: "Client is sick", clientVisible: true },
  { name: "Schedule conflict", clientVisible: true },
  { name: "Changed their mind", clientVisible: true },
  { name: "Found another salon", clientVisible: true },
  { name: "Salon cancelled (our side)", clientVisible: false },
  { name: "Other", clientVisible: true },
];

/** Seed the defaults for a business that has none yet (idempotent). */
export async function ensureCancellationReasons(tx: TenantDb, businessId: string) {
  const [row] = await tx.select({ n: sql<number>`count(*)` }).from(schema.cancellationReasons);
  if (Number(row?.n ?? 0) > 0) return;
  await tx.insert(schema.cancellationReasons).values(DEFAULT_CANCELLATION_REASONS.map((r, i) => ({ businessId, name: r.name, clientVisible: r.clientVisible, sortOrder: i })));
}

export async function listCancellationReasons(businessId: string, opts: { includeRetired?: boolean } = {}) {
  return withTenant(businessId, async (tx) => {
    await ensureCancellationReasons(tx, businessId);
    const rows = await tx.select().from(schema.cancellationReasons).orderBy(asc(schema.cancellationReasons.sortOrder), asc(schema.cancellationReasons.name));
    return opts.includeRetired ? rows : rows.filter((r) => r.active);
  });
}

export async function createCancellationReason(businessId: string, name: string) {
  const clean = name.trim();
  if (!clean) throw new CancellationReasonError("Enter a reason.");
  await withTenant(businessId, async (tx) => {
    await ensureCancellationReasons(tx, businessId);
    const [max] = await tx.select({ m: sql<number>`coalesce(max(${schema.cancellationReasons.sortOrder}), -1)` }).from(schema.cancellationReasons);
    await tx.insert(schema.cancellationReasons).values({ businessId, name: clean, sortOrder: Number(max?.m ?? -1) + 1 });
  });
}

export async function renameCancellationReason(businessId: string, id: string, name: string) {
  const clean = name.trim();
  if (!clean) throw new CancellationReasonError("Enter a reason.");
  await withTenant(businessId, (tx) => tx.update(schema.cancellationReasons).set({ name: clean }).where(eq(schema.cancellationReasons.id, id)));
}

export async function setCancellationReasonActive(businessId: string, id: string, active: boolean) {
  await withTenant(businessId, async (tx) => {
    if (!active) {
      const [n] = await tx.select({ n: sql<number>`count(*)` }).from(schema.cancellationReasons).where(eq(schema.cancellationReasons.active, true));
      if (Number(n?.n ?? 0) <= 1) throw new CancellationReasonError("Keep at least one reason.");
    }
    await tx.update(schema.cancellationReasons).set({ active }).where(eq(schema.cancellationReasons.id, id));
  });
}

/** Swap sort positions with the neighbour above or below. */
export async function moveCancellationReason(businessId: string, id: string, dir: "up" | "down") {
  await withTenant(businessId, async (tx) => {
    const rows = await tx.select().from(schema.cancellationReasons).orderBy(asc(schema.cancellationReasons.sortOrder), asc(schema.cancellationReasons.name));
    const i = rows.findIndex((r) => r.id === id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= rows.length) return;
    // Normalise to 0..n first so swaps are well defined even after deletes.
    for (let k = 0; k < rows.length; k++) if (rows[k]!.sortOrder !== k) await tx.update(schema.cancellationReasons).set({ sortOrder: k }).where(eq(schema.cancellationReasons.id, rows[k]!.id));
    await tx.update(schema.cancellationReasons).set({ sortOrder: j }).where(eq(schema.cancellationReasons.id, rows[i]!.id));
    await tx.update(schema.cancellationReasons).set({ sortOrder: i }).where(eq(schema.cancellationReasons.id, rows[j]!.id));
  });
}

export async function setCancellationReasonClientVisible(businessId: string, id: string, visible: boolean) {
  await withTenant(businessId, (tx) => tx.update(schema.cancellationReasons).set({ clientVisible: visible }).where(eq(schema.cancellationReasons.id, id)));
}

export type CancellationRow = { reasonId: string | null; name: string; count: number; lateCount: number; byClient: number; lostCents: number; depositKeptCents: number; feeCents: number };

/** Appointments cancelled in a period grouped by reason, with the revenue lost and what was recovered (deposits kept, late fees collected). */
export async function cancellationsByReason(tx: TenantDb, from: Date, to: Date): Promise<CancellationRow[]> {
  const [appts, reasons] = await Promise.all([
    tx
      .select({ id: schema.appointments.id, reasonId: schema.appointments.cancellationReasonId, by: schema.appointments.cancelledBy, late: schema.appointments.cancelledLate, depositCents: schema.appointments.depositCents, depositStatus: schema.appointments.depositStatus })
      .from(schema.appointments)
      .where(and(eq(schema.appointments.status, "cancelled"), eq(schema.appointments.kind, "visit"), gte(schema.appointments.cancelledAt, from), lt(schema.appointments.cancelledAt, to))),
    tx.select({ id: schema.cancellationReasons.id, name: schema.cancellationReasons.name }).from(schema.cancellationReasons),
  ]);
  if (!appts.length) return [];
  const ids = appts.map((a) => a.id);
  const [items, fees] = await Promise.all([
    tx.select({ appointmentId: schema.appointmentItems.appointmentId, cents: sql<number>`coalesce(sum(${schema.appointmentItems.priceCents}), 0)` }).from(schema.appointmentItems).where(inArray(schema.appointmentItems.appointmentId, ids)).groupBy(schema.appointmentItems.appointmentId),
    tx
      .select({ appointmentId: schema.sales.appointmentId, cents: sql<number>`coalesce(sum(${schema.saleLines.amountCents}), 0)` })
      .from(schema.saleLines)
      .innerJoin(schema.sales, eq(schema.sales.id, schema.saleLines.saleId))
      .where(and(inArray(schema.sales.appointmentId, ids), eq(schema.saleLines.kind, "fee"), eq(schema.sales.status, "paid")))
      .groupBy(schema.sales.appointmentId),
  ]);
  const lost = new Map(items.map((i) => [i.appointmentId, Number(i.cents)]));
  const fee = new Map(fees.map((f) => [f.appointmentId ?? "", Number(f.cents)]));
  const out = new Map<string, CancellationRow>();
  for (const a of appts) {
    const k = a.reasonId ?? "none";
    const name = a.reasonId ? (reasons.find((r) => r.id === a.reasonId)?.name ?? "Retired reason") : "No reason given";
    const cur = out.get(k) ?? { reasonId: a.reasonId, name, count: 0, lateCount: 0, byClient: 0, lostCents: 0, depositKeptCents: 0, feeCents: 0 };
    cur.count += 1;
    if (a.late) cur.lateCount += 1;
    if (a.by === "client") cur.byClient += 1;
    cur.lostCents += lost.get(a.id) ?? 0;
    if (a.depositStatus === "paid") cur.depositKeptCents += a.depositCents;
    cur.feeCents += fee.get(a.id) ?? 0;
    out.set(k, cur);
  }
  return [...out.values()].sort((a, b) => b.count - a.count);
}
