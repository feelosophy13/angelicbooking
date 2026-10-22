// Email designs against the database: an automatic email keeps its default look until the business designs it, a design is fenced to
// its own business, and a saved design is found only as a saved one.
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { designedEmail, sampleSystemEmail, savedDesign, businessBrand } from "@/server/email-designs";
import { SYSTEM_EMAIL_KEYS } from "@/lib/email-design/system";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

const ok = await reachable();

describe.skipIf(!ok)("email designs", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let business: typeof schema.businesses.$inferSelect;
  beforeAll(async () => {
    kit = await setupKit([]);
    await db.update(schema.businesses).set({ brandColor: "#0f766e" }).where(eq(schema.businesses.id, kit.A));
    business = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }))!;
  });
  afterAll(async () => kit?.teardown());

  it("sends the default look when there is no design, and the design (with the message's own content) once there is one", async () => {
    const brand = businessBrand(business);
    const sample = sampleSystemEmail(business, "confirmation", brand);
    const plain = await withTenant(kit.A, (tx) => designedEmail(tx, "confirmation", sample, brand, sample.vars));
    expect(plain).toEqual({ subject: sample.subject, html: sample.html });

    await withTenant(kit.A, (tx) => tx.insert(schema.emailTemplates).values({ businessId: kit.A, kind: "system", key: "confirmation", name: "Booking confirmation", subject: "See you {date}, {first_name}", blocks: [{ id: "h", type: "heading", text: "Yay {first_name}" }, { id: "core", type: "core" }, { type: "text", id: "t", text: "<b>hi</b>" }] }));
    const designed = await withTenant(kit.A, (tx) => designedEmail(tx, "confirmation", sample, brand, sample.vars));
    expect(designed.subject).toBe(`See you ${sample.vars.date}, Maria`);
    expect(designed.html).toContain(">Yay Maria</h1>");
    expect(designed.html).toContain("Manage appointment");
    expect(designed.html).toContain("&lt;b&gt;hi&lt;/b&gt;");
    expect(designed.html).toContain('bgcolor="#0f766e"');

    // Another business never sees it.
    const other = await withTenant(kit.B, (tx) => designedEmail(tx, "confirmation", sample, brand, sample.vars));
    expect(other.html).toBe(sample.html);
  });

  it("an empty subject keeps the usual one", async () => {
    const brand = businessBrand(business);
    const sample = sampleSystemEmail(business, "receipt", brand);
    await withTenant(kit.A, (tx) => tx.insert(schema.emailTemplates).values({ businessId: kit.A, kind: "system", key: "receipt", name: "Receipt", subject: "", blocks: [{ id: "core", type: "core" }] }));
    const r = await withTenant(kit.A, (tx) => designedEmail(tx, "receipt", sample, brand, sample.vars));
    expect(r.subject).toBe(sample.subject);
    expect(r.subject).toContain("#1042");
  });

  it("finds saved designs by id, never a system one", async () => {
    const [saved] = await withTenant(kit.A, (tx) => tx.insert(schema.emailTemplates).values({ businessId: kit.A, name: "October special", blocks: [{ id: "x", type: "core" }, { id: "t", type: "text", text: "Hi" }] }).returning());
    const sys = await withTenant(kit.A, (tx) => tx.query.emailTemplates.findFirst({ where: eq(schema.emailTemplates.key, "receipt") }));
    const d = await withTenant(kit.A, (tx) => savedDesign(tx, saved!.id));
    expect(d?.blocks.map((b) => b.type)).toEqual(["text"]);
    expect(await withTenant(kit.A, (tx) => savedDesign(tx, sys!.id))).toBeNull();
    expect(await withTenant(kit.B, (tx) => savedDesign(tx, saved!.id))).toBeNull();
  });

  it("has sample content for every automatic email", () => {
    for (const k of SYSTEM_EMAIL_KEYS) {
      const s = sampleSystemEmail(business, k, businessBrand(business));
      expect(s.content.length).toBeGreaterThan(20);
      expect(s.subject).toBeTruthy();
    }
  });
});
