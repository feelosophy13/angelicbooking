/**
 * Integration test for the workflow engine's guardrails (review 2026-10-18): a "stop if the client books again" run stops for any
 * visit on the calendar, pre-booked at the desk or not; "first visit" counts only completed visits before this one; a step that throws
 * marks only its run failed and the rest of the batch goes on; and delivery writes what became of a queued message back into the
 * run's log, which is what the run's badge reads. Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise.
 * No provider is configured here, so every message is skipped at send time and nothing leaves the machine.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { appointmentFacts, triggerAppointmentWorkflows, triggerWorkflows } from "@/server/workflows";
import { deliverMany } from "@/lib/notify";
import { runOutcome } from "@/lib/workflows-logic";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("@/lib/notify/providers", async (orig) => ({ ...(await orig<typeof import("@/lib/notify/providers")>()), emailConfigured: () => false, smsConfigured: () => false }));
const { reported } = vi.hoisted(() => ({ reported: vi.fn() }));
vi.mock("@/lib/report-error", () => ({ reportError: (...args: unknown[]) => { reported(...args); return Promise.resolve(); } }));

const up = await reachable();
const HOUR = 3_600_000;

describe.skipIf(!up)("workflow engine guardrails", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let business: typeof schema.businesses.$inferSelect;
  let staffId: string;
  beforeAll(async () => {
    kit = await setupKit([]);
    business = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }))!;
    await withTenant(kit.A, async (tx) => {
      const [s] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Sam" }).returning({ id: schema.staff.id });
      staffId = s!.id;
    });
    // Create the built-in templates now and switch them all off, so only the workflows each test makes take part.
    await triggerWorkflows(business, "client_created", { clientId: null, dedupeKey: "none" });
    await withTenant(kit.A, (tx) => tx.update(schema.workflows).set({ enabled: false }).where(eq(schema.workflows.businessId, kit.A)));
  });
  afterAll(async () => {
    await kit?.teardown();
  });

  const client = (firstName: string, extra: Partial<typeof schema.clients.$inferInsert> = {}) =>
    withTenant(kit.A, async (tx) => (await tx.insert(schema.clients).values({ businessId: kit.A, firstName, smsOptIn: false, emailOptIn: false, ...extra }).returning())[0]!);
  const visit = (clientId: string, at: Date, status: "completed" | "booked") =>
    withTenant(kit.A, async (tx) => {
      const [a] = await tx.insert(schema.appointments).values({ businessId: kit.A, clientId, status }).returning({ id: schema.appointments.id });
      await tx.insert(schema.appointmentItems).values({ businessId: kit.A, appointmentId: a!.id, staffId, serviceName: "Cut", startAt: at, endAt: new Date(at.getTime() + HOUR), priceCents: 5000, status, allowOverlap: true });
      return a!.id;
    });
  const workflow = (input: Partial<typeof schema.workflows.$inferInsert> & { name: string; trigger: typeof schema.workflows.$inferInsert.trigger }) =>
    withTenant(kit.A, async (tx) => (await tx.insert(schema.workflows).values({ businessId: kit.A, enabled: true, ...input }).returning())[0]!);
  const runsOf = (workflowId: string) => withTenant(kit.A, (tx) => tx.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.workflowId, workflowId)));

  it("stops a rebook flow for a client who already has a visit on the calendar, whenever it was booked", async () => {
    const w = await workflow({ name: "Rebook", trigger: "appointment_completed", exitOnBooking: true, steps: [{ id: "t", type: "tag", tag: "nudged" }] });
    const preBooked = await client("Pre");
    const free = await client("Free");
    const now = Date.now();
    // The next visit was booked at the desk before this one was checked out (the normal flow).
    await visit(preBooked.id, new Date(now + 14 * 24 * HOUR), "booked");
    const a = await visit(preBooked.id, new Date(now - 2 * HOUR), "completed");
    const b = await visit(free.id, new Date(now - 2 * HOUR), "completed");
    await triggerAppointmentWorkflows(business, "appointment_completed", a);
    await triggerAppointmentWorkflows(business, "appointment_completed", b);
    const runs = await runsOf(w.id);
    expect(runs.find((r) => r.clientId === preBooked.id)!.status).toBe("cancelled");
    expect(runs.find((r) => r.clientId === preBooked.id)!.log.at(-1)!.detail).toBe("Client has a visit booked");
    expect(runs.find((r) => r.clientId === free.id)!.status).toBe("done");
    await withTenant(kit.A, (tx) => tx.update(schema.workflows).set({ enabled: false }).where(eq(schema.workflows.id, w.id)));
  });

  it("counts only completed visits before this one as earlier visits", async () => {
    const c = await client("First");
    const now = Date.now();
    await visit(c.id, new Date(now + 30 * 24 * HOUR), "booked"); // pre-booked next visit: not a prior visit
    const today = await visit(c.id, new Date(now - 2 * HOUR), "completed");
    expect((await withTenant(kit.A, (tx) => appointmentFacts(tx, today)))!.firstVisit).toBe(true);
    await visit(c.id, new Date(now - 60 * 24 * HOUR), "completed");
    expect((await withTenant(kit.A, (tx) => appointmentFacts(tx, today)))!.firstVisit).toBe(false);
  });

  it("marks only the run whose step throws as failed and finishes the others", async () => {
    // A points step past the integer range (the editor caps at 100,000; this bypasses it) makes the ledger insert throw.
    const bad = await workflow({ name: "Bad points", trigger: "appointment_completed", steps: [{ id: "p", type: "points", points: 1e12 }] });
    const good = await workflow({ name: "Tag", trigger: "appointment_completed", steps: [{ id: "t", type: "tag", tag: "seen" }] });
    const c = await client("Vic");
    const a = await visit(c.id, new Date(Date.now() - 2 * HOUR), "completed");
    reported.mockClear();
    await triggerAppointmentWorkflows(business, "appointment_completed", a);
    const [badRun] = await runsOf(bad.id);
    expect(badRun!.status).toBe("failed");
    expect(badRun!.log.at(-1)!.event).toBe("failed");
    expect(badRun!.log.at(-1)!.detail).toMatch(/^Step failed: /);
    expect((await runsOf(good.id)).map((r) => r.status)).toEqual(["done"]);
    expect((await withTenant(kit.A, (tx) => tx.query.clients.findFirst({ where: eq(schema.clients.id, c.id) })))!.tags).toEqual(["seen"]);
    expect(reported).toHaveBeenCalledTimes(1);
    await withTenant(kit.A, (tx) => tx.update(schema.workflows).set({ enabled: false }).where(and(eq(schema.workflows.businessId, kit.A), eq(schema.workflows.trigger, "appointment_completed"))));
  });

  it("writes what delivery did with a queued message into the run's log, which the badge reads", async () => {
    const w = await workflow({ name: "Aftercare", trigger: "appointment_completed", enabled: false, steps: [{ id: "e", type: "email", subject: "hi", body: "hi" }] });
    const c = await client("Tex", { email: "tex@example.com", emailOptIn: true });
    const { runId, notificationId } = await withTenant(kit.A, async (tx) => {
      const started = { at: new Date().toISOString(), step: null, event: "started" as const, detail: "Visit completed" };
      const queued = { at: new Date().toISOString(), step: 0, event: "queued" as const, detail: "Email queued to tex@example.com" };
      const done = { at: new Date().toISOString(), step: null, event: "done" as const, detail: "Finished" };
      const [run] = await tx.insert(schema.workflowRuns).values({ businessId: kit.A, workflowId: w.id, clientId: c.id, dedupeKey: "x", status: "done", stepIndex: 1, log: [started, queued, done] }).returning({ id: schema.workflowRuns.id });
      const [n] = await tx.insert(schema.notifications).values({ businessId: kit.A, clientId: c.id, channel: "email", template: "workflow_custom", recipient: "tex@example.com", subject: "hi", body: "<p>hi</p>", workflowRunId: run!.id }).returning({ id: schema.notifications.id });
      return { runId: run!.id, notificationId: n!.id };
    });
    const before = (await runsOf(w.id))[0]!;
    expect(runOutcome(before)).toBe("queued"); // handed to delivery, not yet tried
    await deliverMany(kit.A, [notificationId]);
    const n = await withTenant(kit.A, (tx) => tx.query.notifications.findFirst({ where: eq(schema.notifications.id, notificationId) }));
    expect(n!.status).toBe("skipped");
    const after = (await runsOf(w.id)).find((r) => r.id === runId)!;
    expect(after.log.at(-1)!.event).toBe("skipped");
    expect(after.log.at(-1)!.detail).toBe(`Email skipped: ${n!.error}`);
    expect(runOutcome(after)).toBe("skipped");
  });
});
