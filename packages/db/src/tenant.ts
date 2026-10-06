import { sql } from "drizzle-orm";
import { db, type Db } from "./index";

export type TenantDb = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Run `fn` inside a transaction with the Postgres session variable
 * `app.business_id` set. Every tenant table's RLS policy compares
 * `business_id` to this value, so queries inside `fn` can only see or
 * write rows belonging to `businessId`.
 *
 * `set_config(..., true)` is transaction-local, so pooled connections are safe.
 */
export async function withTenant<T>(businessId: string, fn: (tx: TenantDb) => Promise<T>): Promise<T> {
  if (!businessId) throw new Error("withTenant: businessId is required");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.business_id', ${businessId}, true)`);
    return fn(tx);
  });
}
