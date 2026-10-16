/**
 * Integration test for the delivery run: businesses take turns (one business's campaign can't starve another's reminders), appointment
 * messages go before marketing, and a "too many requests" from the email provider puts the message back without using up a try.
 * Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise. The email provider is mocked.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

const sent: string[] = [];
const busy = new Set<string>();
vi.mock("@/lib/notify/providers", async (orig) => {
  const real = await orig<typeof import("@/lib/notify/providers")>();
  return {
    ...real,
    emailConfigured: () => true,
    emailTurn: async () => undefined,
    sendEmail: async (input: { to: string }) => {
      if (busy.has(input.to)) throw new real.EmailRateLimitError(1);
      sent.push(input.to);
      return { id: `em_${sent.length}` };
    },
  };
});
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

const { deliverDue, interleave } = await import("@/lib/notify");
const up = await reachable();

describe("interleave", () => {
  it("alternates between lists", () => expect(interleave([["a1", "a2", "a3"], ["b1"], []])).toEqual(["a1", "b1", "a2", "a3"]));
});

describe.skipIf(!up)("delivery fairness", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let fan: string;
  beforeAll(async () => {
    kit = await setupKit([]);
    fan = (await withTenant(kit.A, (tx) => tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Fan", email: "fan@a.test", emailMarketingOptIn: true }).returning()))[0]!.id;
  });
  afterAll(async () => {
    await kit?.teardown();
  });
  const queue = (businessId: string, recipient: string, marketing = false, at = new Date(Date.now() - 60_000)) =>
    withTenant(businessId, async (tx) => (await tx.insert(schema.notifications).values({ businessId, clientId: marketing ? fan : null, channel: "email", template: marketing ? "campaign" : "reminder", recipient, subject: "Hi", body: "<p>Hi</p>", marketing, scheduledAt: at }).returning())[0]!);

  it("takes turns between businesses, reminders before marketing, and requeues a throttled email without using a try", async () => {
    // A queued its campaign first; its reminder and B's reminders came later.
    for (let i = 0; i < 12; i++) await queue(kit.A, `promo${i}@a.test`, true, new Date(Date.now() - 600_000));
    await queue(kit.A, "reminder@a.test");
    await queue(kit.B, "one@b.test");
    await queue(kit.B, "two@b.test");
    const slow = await queue(kit.B, "busy@b.test");
    busy.add("busy@b.test");
    await deliverDue({ perRound: 3, businessIds: [kit.A, kit.B] });
    expect(sent.indexOf("reminder@a.test")).toBeLessThan(sent.findIndex((s) => s.startsWith("promo")));
    // B's reminders go out in the first round, not after A's twelve promos.
    expect(sent.indexOf("one@b.test")).toBeLessThan(6);
    expect(sent.indexOf("two@b.test")).toBeLessThan(6);
    expect(sent.filter((s) => s.startsWith("promo")).length).toBe(12);
    const n = (await withTenant(kit.B, (tx) => tx.query.notifications.findFirst({ where: eq(schema.notifications.id, slow.id) })))!;
    expect([n.status, n.attempts]).toEqual(["queued", 0]);
    expect(n.scheduledAt.getTime()).toBeGreaterThan(Date.now());
  });
});
