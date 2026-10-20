// Online booking codes: checking a code, the token it yields, and what a proven phone changes about matching clients and consent.
import "../../../../../packages/db/src/env";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// No request here: no signed-in client, and `after` (new-client automations) does nothing.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined }), headers: async () => new Headers() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { checkBookingCode, contactVerified, maskDestination } from "@/server/booking-verification";
import { findOrCreateClient } from "@/server/public-booking";
import { encodeVerifiedContact } from "@/lib/client-session";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

const up = await reachable();
const PHONE = "+15715550111";

describe.skipIf(!up)("booking verification", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let jenId: string;
  const business = async () => (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }))!;
  beforeAll(async () => {
    kit = await setupKit([]);
    const [jen] = await withTenant(kit.A, (tx) => tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Jennifer", lastName: "Smith", phone: PHONE, email: "jen@example.test" }).returning());
    jenId = jen!.id;
  });
  afterAll(async () => {
    await kit?.teardown();
  });

  const codeRow = (destination: string, code: string, over: Partial<typeof schema.clientLoginCodes.$inferInsert> = {}) =>
    withTenant(kit.A, (tx) => tx.insert(schema.clientLoginCodes).values({ businessId: kit.A, clientId: null, purpose: "booking", channel: destination.includes("@") ? "email" : "sms", destination, codeHash: createHash("sha256").update(`${process.env.BETTER_AUTH_SECRET ?? ""}:booking:${kit.A}:${code}`).digest("hex"), expiresAt: new Date(Date.now() + 600_000), ...over }));
  const input = (over: Partial<Parameters<typeof findOrCreateClient>[1]> = {}) => ({ serviceId: "", staffId: "", startAt: new Date(), firstName: "Jen", lastName: "Smith", email: null, phone: PHONE, notes: null, ...over });

  it("turns the right code into a token for that phone, once, and counts wrong guesses", async () => {
    const b = await business();
    await codeRow(PHONE, "123456");
    await expect(checkBookingCode(b, { phone: "(571) 555-0111", email: null, channel: "sms", code: "000000" })).rejects.toThrow(/isn't right/);
    const token = await checkBookingCode(b, { phone: "(571) 555-0111", email: null, channel: "sms", code: "123 456" });
    expect((await contactVerified(b, { phone: "571-555-0111", email: null }, token))).toEqual({ ok: true, via: "sms" });
    expect((await contactVerified(b, { phone: "+15715550199", email: null }, token)).ok).toBe(false); // another number
    expect((await contactVerified(b, { phone: PHONE, email: null }, "forged.token")).ok).toBe(false);
    await expect(checkBookingCode(b, { phone: PHONE, email: null, channel: "sms", code: "123456" })).rejects.toThrow(/expired|Send a new/); // used up
  });

  it("refuses an expired code and a token for another business", async () => {
    const b = await business();
    await codeRow("late@example.test", "222222", { expiresAt: new Date(Date.now() - 1000) });
    await expect(checkBookingCode(b, { phone: null, email: "Late@Example.test", channel: "email", code: "222222" })).rejects.toThrow(/expired/);
    expect((await contactVerified(b, { phone: PHONE, email: null }, encodeVerifiedContact(kit.B, PHONE))).ok).toBe(false);
  });

  it("puts a proven phone's booking on the client who owns it, whatever the name; an unproven one with another name is a new client", async () => {
    expect(await findOrCreateClient(kit.A, input({ verifiedVia: "sms", verificationOn: true }))).toBe(jenId);
    const stranger = await findOrCreateClient(kit.A, input({ firstName: "Mallory", lastName: "Jones" }));
    expect(stranger).not.toBe(jenId);
  });

  it("records marketing-text consent only from a proven phone when codes are on", async () => {
    const bare = await findOrCreateClient(kit.A, input({ phone: "+15715550122", firstName: "Ana", smsMarketingConsent: true, verificationOn: true }));
    const proven = await findOrCreateClient(kit.A, input({ phone: "+15715550133", firstName: "Bea", smsMarketingConsent: true, verificationOn: true, verifiedVia: "sms" }));
    const off = await findOrCreateClient(kit.A, input({ phone: "+15715550144", firstName: "Cy", smsMarketingConsent: true, verificationOn: false }));
    const rows = await withTenant(kit.A, (tx) => tx.select().from(schema.clients));
    const consent = (id: string) => rows.find((r) => r.id === id)!.smsMarketingOptIn;
    expect([consent(bare), consent(proven), consent(off)]).toEqual([false, true, true]);
  });

  it("masks where the code went", () => {
    expect(maskDestination(PHONE)).toBe("(•••) •••-0111");
    expect(maskDestination("jen@example.test")).toBe("j•••@example.test");
  });
});
