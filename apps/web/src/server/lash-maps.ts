import { and, desc, eq } from "drizzle-orm";
import { can } from "@angelic/core";
import { schema, type TenantDb } from "@angelic/db";
import type { TenantContext } from "@/lib/tenant";

export type LashMapRow = typeof schema.lashMaps.$inferSelect;

/** A client's lash maps, newest first. */
export function lashMapsFor(tx: TenantDb, clientId: string, limit = 20): Promise<LashMapRow[]> {
  return tx.select().from(schema.lashMaps).where(eq(schema.lashMaps.clientId, clientId)).orderBy(desc(schema.lashMaps.createdAt)).limit(limit);
}

/**
 * Who may write a client's lash map: anyone who can edit clients, and the provider who does their lashes (a login with its own
 * appointments that has had or has a visit with this client) even though providers can't edit client details.
 */
export async function canWriteLashMaps(tx: TenantDb, ctx: Pick<TenantContext, "permissions" | "staffId">, clientId: string): Promise<boolean> {
  if (can(ctx.permissions, "clients.write")) return true;
  if (!ctx.staffId || !can(ctx.permissions, "appointments.write.own")) return false;
  const row = await tx
    .select({ id: schema.appointments.id })
    .from(schema.appointmentItems)
    .innerJoin(schema.appointments, eq(schema.appointments.id, schema.appointmentItems.appointmentId))
    .where(and(eq(schema.appointments.clientId, clientId), eq(schema.appointmentItems.staffId, ctx.staffId)))
    .limit(1);
  return row.length > 0;
}
