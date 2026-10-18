/** Inbox conversations: one row per person, unread counts, unknown numbers, mark-read, tenant isolation. Needs Postgres at DATABASE_URL; skipped otherwise. */
import "../../../../../packages/db/src/env";
import { beforeAll, describe, expect, it } from "vitest";
import { getSql, schema, withTenant } from "@angelic/db";
import { reachable, setupKit } from "../../lib/__tests__/api-test-kit";
import { addNumberAsClient, classifyKeyword, clientByPhone, clientThread, conversationContext, listConversations, markConversationRead, markConversationUnread } from "../inbound";
import { recordDeliveryStatus } from "../delivery-status";

const up = await reachable();
let kit: Awaited<ReturnType<typeof setupKit>>;
let ann = "";

beforeAll(async () => {
  if (!up) return;
  kit = await setupKit([]);
  const [c] = await withTenant(kit.A, (tx) => tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Ann", lastName: "Lee", phone: "+15555550177" }).returning());
  ann = c!.id;
  await withTenant(kit.A, (tx) =>
    tx.insert(schema.inboundMessages).values([
      { businessId: kit.A, clientId: ann, fromNumber: "+15555550177", toNumber: "+15555550100", body: "Can I move to 3pm?", receivedAt: new Date(Date.now() - 60_000) },
      { businessId: kit.A, clientId: ann, fromNumber: "+15555550177", toNumber: "+15555550100", body: "Thanks!", receivedAt: new Date() },
      { businessId: kit.A, clientId: null, fromNumber: "+15555550199", toNumber: "+15555550100", body: "Who is this?", receivedAt: new Date(Date.now() - 120_000) },
    ]),
  );
  await withTenant(kit.B, (tx) => tx.insert(schema.inboundMessages).values({ businessId: kit.B, fromNumber: "+15555550188", toNumber: "+15555550100", body: "other tenant" }));
});

describe.skipIf(!up)("inbox conversations", () => {
  it("groups by person, newest first, with unread counts and no other tenant's texts", async () => {
    const { items: list } = await listConversations(kit.A);
    expect(list.map((c) => c.key)).toEqual([ann, "tel:+15555550199"]);
    expect(list[0]).toMatchObject({ name: "Ann Lee", unread: 2, lastBody: "Thanks!", lastDir: "in" });
    expect(list[1]).toMatchObject({ clientId: null, unread: 1 });
  });

  it("marks one conversation read and leaves the rest unread", async () => {
    await markConversationRead(kit.A, ann);
    const list = (await listConversations(kit.A)).items;
    expect(list.find((c) => c.key === ann)?.unread).toBe(0);
    expect(list.find((c) => c.key === "tel:+15555550199")?.unread).toBe(1);
    await markConversationRead(kit.A, "tel:+15555550199");
    expect((await listConversations(kit.A)).items.every((c) => c.unread === 0)).toBe(true);
  });

  it("marks a conversation unread again (its latest text only) and counts it in the filter", async () => {
    expect(await markConversationUnread(kit.A, ann)).toBe(true);
    const r = await listConversations(kit.A, { filter: "unread" });
    expect(r.items.map((c) => c.key)).toEqual([ann]);
    expect(r.items[0]?.unread).toBe(1);
    expect(r.unread).toBe(1);
    expect(await markConversationUnread(kit.A, "tel:+15555550000")).toBe(false);
    await markConversationRead(kit.A, ann);
  });

  it("knows who still needs a reply and shows the next booked visit beside them", async () => {
    const [loc] = await withTenant(kit.A, (tx) => tx.insert(schema.locations).values({ businessId: kit.A, name: "Main", isDefault: true }).returning());
    const [st] = await withTenant(kit.A, (tx) => tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Jo", fullName: "Jo Test" }).returning());
    const start = new Date(Date.now() + 3 * 86_400_000);
    const [appt] = await withTenant(kit.A, (tx) => tx.insert(schema.appointments).values({ businessId: kit.A, locationId: loc!.id, clientId: ann, status: "booked", source: "staff" }).returning());
    await withTenant(kit.A, (tx) => tx.insert(schema.appointmentItems).values({ businessId: kit.A, appointmentId: appt!.id, staffId: st!.id, serviceName: "Lash fill", startAt: start, endAt: new Date(start.getTime() + 3_600_000), priceCents: 8000 }));
    const list = (await listConversations(kit.A)).items;
    expect(list.find((c) => c.key === ann)?.nextAt?.getTime()).toBe(start.getTime());
    expect(list.find((c) => c.key === ann)?.lastDir).toBe("in");
    const ctx = await conversationContext(kit.A, ann);
    expect(ctx.next).toMatchObject({ id: appt!.id, service: "Lash fill", staff: "Jo" });
    expect(ctx.last).toBeNull();
    expect(ctx.completed).toBe(0);
    // A reply from the desk is the newest message: the client no longer needs a reply.
    await withTenant(kit.A, (tx) => tx.insert(schema.notifications).values({ businessId: kit.A, clientId: ann, channel: "sms", template: "staff_reply", recipient: "+15555550177", body: "Sure, 3pm works", status: "sent", sentAt: new Date(Date.now() + 1000), scheduledAt: new Date(Date.now() + 1000) }));
    expect((await listConversations(kit.A, { filter: "needs_reply" })).items.some((c) => c.key === ann)).toBe(false);
    const thread = await clientThread(kit.A, ann);
    expect(thread.map((m) => m.dir)).toEqual(["in", "in", "out"]);
    expect(thread[2]).toMatchObject({ template: "staff_reply", status: "sent", deliveryStatus: null, error: null });
  });
});

describe("keywords", () => {
  it("reads STOP in a short message but CANCEL/YES only on their own", () => {
    expect(classifyKeyword("STOP")).toBe("stop");
    expect(classifyKeyword("please stop")).toBe("stop");
    expect(classifyKeyword("Stop texting me.")).toBe("stop");
    expect(classifyKeyword("cancel")).toBe("stop");
    expect(classifyKeyword("can I cancel my appointment")).toBeNull();
    expect(classifyKeyword("yes")).toBe("start");
    expect(classifyKeyword("yes please book me")).toBeNull();
    expect(classifyKeyword("HELP")).toBe("help");
    expect(classifyKeyword("")).toBeNull();
  });
});

describe.skipIf(!up)("inbox: numbers, paging, delivery", () => {
  it("matches a client however their number was typed", async () => {
    await withTenant(kit.A, (tx) => tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Bo", lastName: "Fay", phone: "(555) 555-0166" }));
    const found = await withTenant(kit.A, (tx) => clientByPhone(tx, "+15555550166"));
    expect(found?.firstName).toBe("Bo");
  });

  it("adds a texting stranger as a client and moves their texts over", async () => {
    const id = await addNumberAsClient(kit.A, "+15555550199", { firstName: "Cy", lastName: "Doe" });
    const { items } = await listConversations(kit.A);
    expect(items.find((c) => c.key === id)?.name).toBe("Cy Doe");
    expect(items.some((c) => c.key === "tel:+15555550199")).toBe(false);
  });

  it("filters and pages the list", async () => {
    expect((await listConversations(kit.A, { q: "cy" })).items.map((c) => c.name)).toEqual(["Cy Doe"]);
    const paged = await listConversations(kit.A, { limit: 1 });
    expect(paged.items).toHaveLength(1);
    expect(paged.total).toBeGreaterThan(1);
  });

  it("records a carrier receipt and fails an undelivered text, never moving a delivered one backwards", async () => {
    const run = Date.now().toString(36);
    const [a] = await withTenant(kit.A, (tx) => tx.insert(schema.notifications).values({ businessId: kit.A, channel: "sms", template: "staff_reply", recipient: "+15555550177", body: "hi", status: "sent", providerId: `SM_ok_${run}` }).returning());
    const [b] = await withTenant(kit.A, (tx) => tx.insert(schema.notifications).values({ businessId: kit.A, channel: "sms", template: "staff_reply", recipient: "+15555550178", body: "hi", status: "sent", providerId: `SM_bad_${run}` }).returning());
    expect(await recordDeliveryStatus({ sid: `SM_ok_${run}`, status: "delivered" })).toBe(true);
    await recordDeliveryStatus({ sid: `SM_ok_${run}`, status: "sent" });
    await recordDeliveryStatus({ sid: `SM_bad_${run}`, status: "undelivered", errorCode: "30006" });
    expect(await recordDeliveryStatus({ sid: "SM_unknown", status: "delivered" })).toBe(false);
    const rows = await withTenant(kit.A, (tx) => tx.select().from(schema.notifications));
    expect(rows.find((r) => r.id === a!.id)).toMatchObject({ deliveryStatus: "delivered" });
    expect(rows.find((r) => r.id === b!.id)).toMatchObject({ status: "failed", deliveryStatus: "undelivered" });
    expect(rows.find((r) => r.id === b!.id)?.error).toMatch(/landline/);
  });
});
