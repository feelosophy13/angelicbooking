/** Inbox conversations: one row per person, unread counts, unknown numbers, mark-read, tenant isolation. Needs Postgres at DATABASE_URL; skipped otherwise. */
import "../../../../../packages/db/src/env";
import { beforeAll, describe, expect, it } from "vitest";
import { getSql, schema, withTenant } from "@angelic/db";
import { reachable, setupKit } from "../../lib/__tests__/api-test-kit";
import { listConversations, markConversationRead } from "../inbound";

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
    const list = await listConversations(kit.A);
    expect(list.map((c) => c.key)).toEqual([ann, "tel:+15555550199"]);
    expect(list[0]).toMatchObject({ name: "Ann Lee", unread: 2, lastBody: "Thanks!", lastDir: "in" });
    expect(list[1]).toMatchObject({ clientId: null, unread: 1 });
  });

  it("marks one conversation read and leaves the rest unread", async () => {
    await markConversationRead(kit.A, ann);
    const list = await listConversations(kit.A);
    expect(list.find((c) => c.key === ann)?.unread).toBe(0);
    expect(list.find((c) => c.key === "tel:+15555550199")?.unread).toBe(1);
    await markConversationRead(kit.A, "tel:+15555550199");
    expect((await listConversations(kit.A)).every((c) => c.unread === 0)).toBe(true);
  });
});
