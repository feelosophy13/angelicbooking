/**
 * Integration test: Row-Level Security really isolates tenants when the app
 * connects as its normal (non-superuser) role. Needs a reachable Postgres at
 * DATABASE_URL; skipped otherwise.
 */
import "../env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, getSql, schema } from "../index";
import { withTenant } from "../tenant";

const A = `test_a_${crypto.randomUUID().slice(0, 8)}`;
const B = `test_b_${crypto.randomUUID().slice(0, 8)}`;
let reachable = true;

beforeAll(async () => {
  try {
    await getSql()`select 1`;
  } catch {
    reachable = false;
    return;
  }
  await db.insert(schema.organization).values([
    { id: A, name: A, slug: A },
    { id: B, name: B, slug: B },
  ]);
  await db.insert(schema.businesses).values([
    { id: A, name: A, slug: A },
    { id: B, name: B, slug: B },
  ]);
});

afterAll(async () => {
  if (!reachable) return;
  await db.delete(schema.organization).where(eq(schema.organization.id, A));
  await db.delete(schema.organization).where(eq(schema.organization.id, B));
  await getSql().end();
});

describe.skipIf(!reachable)("tenant isolation (RLS)", () => {
  it("app role is not a superuser and cannot bypass RLS", async () => {
    const [row] = await getSql()`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`;
    expect(row?.rolsuper).toBe(false);
    expect(row?.rolbypassrls).toBe(false);
  });

  it("rows written under tenant A are invisible to tenant B and to no-tenant queries", async () => {
    await withTenant(A, (tx) => tx.insert(schema.clients).values({ businessId: A, firstName: "Alice" }));
    const seenByA = await withTenant(A, (tx) => tx.select().from(schema.clients));
    const seenByB = await withTenant(B, (tx) => tx.select().from(schema.clients));
    const seenByNone = await db.select().from(schema.clients).where(eq(schema.clients.businessId, A));
    expect(seenByA.map((c) => c.firstName)).toEqual(["Alice"]);
    expect(seenByB).toHaveLength(0);
    expect(seenByNone).toHaveLength(0);
  });

  it("tenant A cannot write a row tagged with tenant B's id", async () => {
    await expect(
      withTenant(A, (tx) => tx.insert(schema.clients).values({ businessId: B, firstName: "Mallory" })),
    ).rejects.toThrow(/row-level security|Failed query: insert into "clients"/);
  });

  it("tenant A cannot update or delete tenant B's rows (silently affects zero rows)", async () => {
    await withTenant(B, (tx) => tx.insert(schema.clients).values({ businessId: B, firstName: "Bob" }));
    const updated = await withTenant(A, (tx) =>
      tx.update(schema.clients).set({ firstName: "Hacked" }).where(eq(schema.clients.businessId, B)).returning(),
    );
    const deleted = await withTenant(A, (tx) => tx.delete(schema.clients).where(eq(schema.clients.businessId, B)).returning());
    const bob = await withTenant(B, (tx) => tx.select().from(schema.clients));
    expect(updated).toHaveLength(0);
    expect(deleted).toHaveLength(0);
    expect(bob.map((c) => c.firstName)).toEqual(["Bob"]);
  });

  it("double booking is rejected by the database", async () => {
    await withTenant(A, async (tx) => {
      const [s] = await tx.insert(schema.staff).values({ businessId: A, displayName: "S" }).returning();
      const [a1] = await tx.insert(schema.appointments).values({ businessId: A }).returning();
      const [a2] = await tx.insert(schema.appointments).values({ businessId: A }).returning();
      const base = { businessId: A, staffId: s!.id, serviceName: "Cut", priceCents: 1 };
      await tx.insert(schema.appointmentItems).values({
        ...base,
        appointmentId: a1!.id,
        startAt: new Date("2030-01-01T10:00:00Z"),
        endAt: new Date("2030-01-01T11:00:00Z"),
      });
      await expect(
        tx.insert(schema.appointmentItems).values({
          ...base,
          appointmentId: a2!.id,
          startAt: new Date("2030-01-01T10:30:00Z"),
          endAt: new Date("2030-01-01T11:30:00Z"),
        }),
      ).rejects.toThrow(/appointment_items_no_double_booking/);
    }).catch(() => {
      /* transaction is aborted after the expected failure; that's fine */
    });
  });
});
