/**
 * Integration test for the daily birthday / no-visit scan: a no-visit workflow reaches only clients who crossed its line in the last week
 * (not everyone who ever lapsed, and not anyone already booked), each once; the scan runs once a day; 29 February birthdays are celebrated
 * on the 28th in other years. Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise. Nothing is sent (no steps).
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { zonedToInstant } from "@angelic/core";
import { runScheduledTriggers } from "@/server/workflows";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

const up = await reachable();
const DAY = 86_400_000;

describe.skipIf(!up)("scheduled workflows", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let staffId: string;
  let tz: string;
  beforeAll(async () => {
    kit = await setupKit([]);
    tz = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }))!.timezone;
    await withTenant(kit.A, async (tx) => {
      const [s] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Sam" }).returning({ id: schema.staff.id });
      staffId = s!.id;
    });
  });
  afterAll(async () => {
    await kit?.teardown();
  });

  const client = (firstName: string, extra: Partial<typeof schema.clients.$inferInsert> = {}) =>
    withTenant(kit.A, async (tx) => (await tx.insert(schema.clients).values({ businessId: kit.A, firstName, ...extra }).returning())[0]!);
  const visit = (clientId: string, at: Date, status: "completed" | "booked") =>
    withTenant(kit.A, async (tx) => {
      const [a] = await tx.insert(schema.appointments).values({ businessId: kit.A, clientId, status }).returning({ id: schema.appointments.id });
      await tx.insert(schema.appointmentItems).values({ businessId: kit.A, appointmentId: a!.id, staffId, serviceName: "Cut", startAt: at, endAt: new Date(at.getTime() + 3_600_000), priceCents: 5000, status });
    });
  const runsOf = (workflowId: string) => withTenant(kit.A, (tx) => tx.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.workflowId, workflowId)));
  const workflow = (trigger: "no_visit" | "birthday") =>
    withTenant(kit.A, async (tx) => (await tx.insert(schema.workflows).values({ businessId: kit.A, name: trigger, trigger, enabled: true, filters: trigger === "no_visit" ? { days: 60 } : {}, steps: [] }).returning())[0]!);

  it("messages only clients who lapsed in the last week, once, and scans once a day", async () => {
    const w = await workflow("no_visit");
    const recent = await client("Recent"); // 62 days ago: just crossed the line
    const longAgo = await client("LongAgo"); // 400 days ago: lapsed long before, never messaged
    const booked = await client("Booked"); // 62 days ago but already has a booking
    const now = Date.now();
    await visit(recent.id, new Date(now - 62 * DAY), "completed");
    await visit(longAgo.id, new Date(now - 400 * DAY), "completed");
    await visit(booked.id, new Date(now - 62 * DAY + 3 * 3_600_000), "completed");
    await visit(booked.id, new Date(now + 5 * DAY), "booked");
    const noon = zonedToInstant(new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date()), "12:00", tz);
    await runScheduledTriggers(noon);
    expect((await runsOf(w.id)).map((r) => r.clientId)).toEqual([recent.id]);
    // A client who lapses later the same day isn't picked up until tomorrow's scan: the day is done.
    const late = await client("Late");
    await visit(late.id, new Date(now - 61 * DAY + 6 * 3_600_000), "completed");
    await runScheduledTriggers(noon);
    expect((await runsOf(w.id)).length).toBe(1);
    expect((await withTenant(kit.A, (tx) => tx.query.workflows.findFirst({ where: eq(schema.workflows.id, w.id) })))!.lastScanOn).not.toBeNull();
  });

  it("celebrates a 29 February birthday on 28 February in a year without one", async () => {
    const w = await workflow("birthday");
    const leapling = await client("Leap", { birthday: "2000-02-29" });
    await runScheduledTriggers(zonedToInstant("2027-02-28", "12:00", tz));
    expect((await runsOf(w.id)).map((r) => [r.clientId, r.dedupeKey])).toEqual([[leapling.id, `${leapling.id}:2027`]]);
  });
});
