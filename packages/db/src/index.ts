import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * as schema from "./schema";
export * from "./schema";
export { withTenant, withJobs, type TenantDb } from "./tenant";

const globalForDb = globalThis as unknown as { __angelicSql?: ReturnType<typeof postgres> };

export function getSql() {
  const url = process.env.DATABASE_URL ?? "postgres://localhost:5432/angelic_booking";
  if (!globalForDb.__angelicSql) {
    globalForDb.__angelicSql = postgres(url, { max: 10, prepare: false });
  }
  return globalForDb.__angelicSql;
}

/**
 * Unscoped client. Use ONLY for auth tables, `businesses` lookups and admin
 * tasks. Tenant tables will return zero rows without a tenant context
 * (RLS is forced), so domain queries must go through `withTenant`.
 */
export const db = drizzle(getSql(), { schema, casing: "snake_case" });
export type Db = typeof db;
