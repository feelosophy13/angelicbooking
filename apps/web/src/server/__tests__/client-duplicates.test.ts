/**
 * Integration test for likely-duplicate clients: the same phone in another format, the same email in another case, or the same full
 * name is flagged; someone sharing nothing is not; the client itself is left out; another business's clients never show (RLS).
 * Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema, withTenant } from "@angelic/db";
import { likelyDuplicates, maskEmail, maskPhone } from "@/server/client-duplicates";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

const up = await reachable();

describe.skipIf(!up)("likely duplicate clients", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let ana: string;
  let bea: string;
  beforeAll(async () => {
    kit = await setupKit([]);
    await withTenant(kit.A, async (tx) => {
      ana = (await tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Ana", lastName: "Reyes", phone: "+15550001111", email: "Ana.Reyes@Example.com" }).returning())[0]!.id;
      bea = (await tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Bea", lastName: "Long", phone: "+15550002222", email: null }).returning())[0]!.id;
    });
    // Same phone in the other business: never visible from A.
    await withTenant(kit.B, (tx) => tx.insert(schema.clients).values({ businessId: kit.B, firstName: "Other", lastName: "Shop", phone: "+15550001111" }));
  });
  afterAll(async () => {
    await kit?.teardown();
  });

  const find = (probe: Parameters<typeof likelyDuplicates>[1]) => withTenant(kit.A, (tx) => likelyDuplicates(tx, probe));

  it("flags the same phone written differently", async () => {
    const hits = await find({ firstName: "Annie", lastName: "", phone: "(555) 000-1111", email: null });
    expect(hits.map((h) => h.id)).toEqual([ana]);
    expect(hits[0]!.reasons).toEqual(["phone"]);
  });

  it("flags the same email in a different case", async () => {
    const hits = await find({ firstName: "A", lastName: "R", phone: null, email: "ana.reyes@example.COM" });
    expect(hits.map((h) => h.id)).toEqual([ana]);
    expect(hits[0]!.reasons).toEqual(["email"]);
  });

  it("flags the same first and last name in any case", async () => {
    const hits = await find({ firstName: "bea", lastName: "LONG", phone: "+15559999999", email: "new@example.com" });
    expect(hits.map((h) => h.id)).toEqual([bea]);
    expect(hits[0]!.reasons).toEqual(["name"]);
  });

  it("does not flag someone sharing nothing, or a shared first name alone", async () => {
    expect(await find({ firstName: "Cara", lastName: "Diaz", phone: "+15553334444", email: "cara@example.com" })).toEqual([]);
    expect(await find({ firstName: "Ana", lastName: "", phone: null, email: null })).toEqual([]);
  });

  it("leaves out the client itself", async () => {
    expect(await find({ id: ana, firstName: "Ana", lastName: "Reyes", phone: "+15550001111", email: "ana.reyes@example.com" })).toEqual([]);
    const hits = await find({ id: bea, firstName: "Ana", lastName: "Reyes", phone: null, email: null });
    expect(hits.map((h) => h.id)).toEqual([ana]);
  });

  it("masks phone and email lightly", () => {
    expect(maskPhone("+15550001111")).toBe("•••-•••-1111");
    expect(maskEmail("ana@example.com")).toBe("a•••@example.com");
    expect(maskPhone(null)).toBeNull();
  });
});
