/**
 * Integration test for the client import: rows only merge into an existing client when the contact AND the name match, so family members
 * on one phone stay separate people; birthdays land in the birthday field. Needs Postgres at DATABASE_URL (the app role, RLS forced);
 * skipped otherwise.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { runImport } from "@/server/import";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

const up = await reachable();

describe.skipIf(!up)("client import", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  beforeAll(async () => {
    kit = await setupKit([]);
    await withTenant(kit.A, (tx) => tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Maria", lastName: "Lopez", phone: "+15555550901" }));
  });
  afterAll(async () => {
    await kit?.teardown();
  });

  it("keeps people sharing a phone apart, updates the matching one, and fills birthdays", async () => {
    const business = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }))!;
    const mapping = { firstName: "First", lastName: "Last", phone: "Phone", birthday: "Birthday" };
    const rows = [
      { First: "Maria", Last: "Lopez", Phone: "(555) 555-0901", Birthday: "4/5/1985" }, // same person
      { First: "Sofia", Last: "Lopez", Phone: "+1 555 555 0901", Birthday: "12/25" }, // her daughter, same phone
    ];
    const r = await runImport(business, "clients", rows, mapping, null, "test.csv");
    expect([r.created, r.updated]).toEqual([1, 1]);
    const people = await withTenant(kit.A, (tx) => tx.select().from(schema.clients).orderBy(asc(schema.clients.firstName)));
    expect(people.map((p) => [p.firstName, p.birthday])).toEqual([["Maria", "1985-04-05"], ["Sofia", "1900-12-25"]]);
  });
});
