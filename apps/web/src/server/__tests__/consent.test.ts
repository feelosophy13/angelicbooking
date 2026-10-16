/**
 * Integration test for texting and email consent: STOP covers every record with the number and cancels queued texts, START restores
 * appointment texts only, campaigns need marketing consent and send once per number, the delivery step re-checks consent, and the
 * unsubscribe link turns off marketing email only. Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise.
 * Nothing here calls Twilio or Resend.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { isSmsSuppressed, suppressSms, unsuppressSms } from "@/server/consent";
import { applyUnsubscribe, sendCampaign } from "@/server/marketing";
import { deliverMany } from "@/lib/notify";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

// sendCampaign hands delivery to next/server's after(), which only exists inside a request.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

const up = await reachable();

describe.skipIf(!up)("consent", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let userId: string;
  beforeAll(async () => {
    kit = await setupKit([]);
    userId = `u_${kit.A}`;
    await db.insert(schema.user).values({ id: userId, name: "Tester", email: `${userId}@example.test`, emailVerified: true });
  });
  afterAll(async () => {
    await kit?.teardown();
    if (userId) await db.delete(schema.user).where(eq(schema.user.id, userId));
  });

  const business = async () => (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }))!;
  const client = (values: Partial<typeof schema.clients.$inferInsert>) =>
    withTenant(kit.A, async (tx) => (await tx.insert(schema.clients).values({ businessId: kit.A, firstName: "C", ...values }).returning())[0]!);
  const get = (id: string) => withTenant(kit.A, (tx) => tx.query.clients.findFirst({ where: eq(schema.clients.id, id) }));

  it("STOP turns texts off for every record with the number and cancels texts queued to it; START brings appointment texts back only", async () => {
    const mom = await client({ firstName: "Mom", phone: "+15555550101", smsMarketingOptIn: true });
    const kid = await client({ firstName: "Kid", phone: "(555) 555-0101" });
    const [queued] = await withTenant(kit.A, (tx) => tx.insert(schema.notifications).values({ businessId: kit.A, clientId: kid.id, channel: "sms", template: "reminder", recipient: "+15555550101", body: "See you", scheduledAt: new Date(Date.now() + 3_600_000) }).returning());
    await withTenant(kit.A, (tx) => suppressSms(tx, kit.A, "5555550101", "stop"));
    expect([(await get(mom.id))!.smsOptIn, (await get(mom.id))!.smsMarketingOptIn, (await get(kid.id))!.smsOptIn]).toEqual([false, false, false]);
    const n = await withTenant(kit.A, (tx) => tx.query.notifications.findFirst({ where: eq(schema.notifications.id, queued!.id) }));
    expect(n!.status).toBe("cancelled");
    expect(await withTenant(kit.A, (tx) => isSmsSuppressed(tx, "+1 555 555 0101"))).toBe(true);
    await withTenant(kit.A, (tx) => unsuppressSms(tx, kit.A, "+15555550101"));
    expect(await withTenant(kit.A, (tx) => isSmsSuppressed(tx, "+15555550101"))).toBe(false);
    expect([(await get(mom.id))!.smsOptIn, (await get(mom.id))!.smsMarketingOptIn]).toEqual([true, false]);
  });

  it("texts a campaign only to clients with marketing consent, once per number, never to a STOP number", async () => {
    const a = await client({ firstName: "A", phone: "+15555550201", smsMarketingOptIn: true });
    await client({ firstName: "A2", phone: "+15555550201", smsMarketingOptIn: true }); // same phone: one text
    await client({ firstName: "B", phone: "+15555550202" }); // appointment texts only
    await client({ firstName: "S", phone: "+15555550203", smsMarketingOptIn: true });
    await withTenant(kit.A, (tx) => tx.insert(schema.smsSuppressions).values({ businessId: kit.A, phoneTail: "5555550203", source: "stop" }));
    const [c] = await withTenant(kit.A, (tx) => tx.insert(schema.campaigns).values({ businessId: kit.A, name: "Promo", channel: "sms", body: "20% off", audience: {} }).returning());
    expect(await sendCampaign(await business(), c!.id, userId)).toBe(1);
    const rows = await withTenant(kit.A, (tx) => tx.select().from(schema.notifications).where(eq(schema.notifications.campaignId, c!.id)));
    expect(rows.map((r) => [r.recipient, r.marketing, r.clientId])).toEqual([["+15555550201", true, a.id]]);
  });

  it("re-checks consent when sending: a marketing text queued before consent was withdrawn is skipped", async () => {
    const x = await client({ firstName: "X", phone: "+15555550301", smsMarketingOptIn: false });
    const [row] = await withTenant(kit.A, (tx) => tx.insert(schema.notifications).values({ businessId: kit.A, clientId: x.id, channel: "sms", template: "campaign", recipient: "+15555550301", body: "Sale!", marketing: true }).returning());
    const r = await deliverMany(kit.A, [row!.id]);
    expect(r.skipped).toBe(1);
    const n = await withTenant(kit.A, (tx) => tx.query.notifications.findFirst({ where: inArray(schema.notifications.id, [row!.id]) }));
    expect([n!.status, n!.error]).toEqual(["skipped", "No consent to marketing texts"]);
  });

  it("unsubscribe turns off marketing email but keeps appointment emails", async () => {
    const y = await client({ firstName: "Y", email: "y@example.test" });
    const url = (await import("@/lib/unsubscribe")).unsubscribeUrl(await business(), y.id);
    const token = url.split("/").pop()!;
    expect(await applyUnsubscribe(await business(), token)).toBe(true);
    expect(await applyUnsubscribe(await business(), `${y.id}.forged-signature-xxxxxxxxxxxxxxx`)).toBe(false);
    const after = (await get(y.id))!;
    expect([after.emailOptIn, after.emailMarketingOptIn]).toEqual([true, false]);
  });
});
