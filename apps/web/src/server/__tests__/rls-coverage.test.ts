/**
 * Every table that holds a business's rows must have row-level security switched on and forced, so a query that forgets withTenant sees
 * nothing rather than every salon's data. A new table without it fails here. Needs Postgres at DATABASE_URL; skipped otherwise.
 */
import "../../../../../packages/db/src/env";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@angelic/db";
import { reachable } from "@/lib/__tests__/api-test-kit";

const up = await reachable();

/** Tables the web app's role can't read at all (revoked in their migrations), so RLS adds nothing. */
const NOT_APP_TABLES = new Set(["admin_audit_log"]);

describe.skipIf(!up)("row-level security coverage", () => {
  it("is on and forced for every table with a business_id", async () => {
    const rows = (await db.execute(sql`
      select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced
      from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attname = 'business_id' and not a.attisdropped
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
    `)) as unknown as { name: string; rls: boolean; forced: boolean }[];
    expect(rows.length).toBeGreaterThan(40);
    const missing = rows.filter((r) => !NOT_APP_TABLES.has(r.name) && !(r.rls && r.forced)).map((r) => r.name);
    expect(missing).toEqual([]);
  });
});
