import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const g = globalThis as unknown as { __adminSql?: ReturnType<typeof postgres> };

/**
 * Read-only, RLS-bypassing connection (role `angelic_admin`, see packages/db/sql/admin-role.sql).
 * Never point this at DATABASE_URL: that role is the tenant-scoped one used by apps/web.
 */
export function adminDb() {
  const url = process.env.ADMIN_DATABASE_URL;
  if (!url) throw new Error("ADMIN_DATABASE_URL is not set");
  g.__adminSql ??= postgres(url, { max: 5, prepare: false });
  return drizzle(g.__adminSql);
}
