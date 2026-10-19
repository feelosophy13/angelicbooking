/**
 * Integration test for booked-appointment automations: a visit booked inside the reminder window skips the reminder (the confirmation covers
 * it); moving a visit restarts only the flows timed from the visit, every time (moving back to an earlier time still reminds), and leaves
 * other "booked" flows alone. Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise. Nothing is sent (tag steps,
 * and the reminder step finds no consented channel).
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { afterAppointmentBooked, processWorkflowRuns, resyncAppointmentRuns, triggerAppointmentWorkflows } from "@/server/workflows";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

const up = await reachable();
const HOUR = 3_600_000;

describe.skipIf(!up)("reminder timing", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let business: typeof schema.businesses.$inferSelect;
  let staffId: string;
  let clientId: string;
  let reminderFlow: string;
  let thanksFlow: string;
  beforeAll(async () => {
    kit = await setupKit([]);
    business = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }))!;
    await withTenant(kit.A, async (tx) => {
      const [s] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Sam" }).returning({ id: schema.staff.id });
      staffId = s!.id;
      const [c] = await tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Ana", smsOptIn: false, emailOptIn: false }).returning({ id: schema.clients.id });
      clientId = c!.id;
      // Every built-in template is created up front (triggerWorkflows does this), then switched off so only ours run.
      const [r] = await tx.insert(schema.workflows).values({ businessId: kit.A, name: "Reminder", trigger: "appointment_booked", enabled: true, steps: [{ id: "w", type: "wait", mode: "before_appointment", hours: 24 }, { id: "r", type: "reminder" }] as never }).returning();
      const [t] = await tx.insert(schema.workflows).values({ businessId: kit.A, name: "Thanks", trigger: "appointment_booked", enabled: true, steps: [{ id: "t2", type: "tag", tag: "thanked" }] as never }).returning();
      reminderFlow = r!.id;
      thanksFlow = t!.id;
    });
    // Create the built-in templates now and disable them, so they don't take part.
    await triggerAppointmentWorkflows(business, "appointment_booked", "none");
    await withTenant(kit.A, (tx) => tx.update(schema.workflows).set({ enabled: false }).where(and(eq(schema.workflows.businessId, kit.A), eq(schema.workflows.trigger, "appointment_booked"))));
    await withTenant(kit.A, (tx) => tx.update(schema.workflows).set({ enabled: true }).where(eq(schema.workflows.id, reminderFlow)));
    await withTenant(kit.A, (tx) => tx.update(schema.workflows).set({ enabled: true }).where(eq(schema.workflows.id, thanksFlow)));
  });
  afterAll(async () => {
    await kit?.teardown();
  });

  const book = (at: Date) =>
    withTenant(kit.A, async (tx) => {
      const [a] = await tx.insert(schema.appointments).values({ businessId: kit.A, clientId }).returning({ id: schema.appointments.id });
      const [item] = await tx.insert(schema.appointmentItems).values({ businessId: kit.A, appointmentId: a!.id, staffId, serviceName: "Cut", startAt: at, endAt: new Date(at.getTime() + HOUR), priceCents: 5000 }).returning({ id: schema.appointmentItems.id });
      return { id: a!.id, itemId: item!.id };
    });
  const move = (itemId: string, at: Date) => withTenant(kit.A, (tx) => tx.update(schema.appointmentItems).set({ startAt: at, endAt: new Date(at.getTime() + HOUR) }).where(eq(schema.appointmentItems.id, itemId)));
  const runs = (appointmentId: string, workflowId: string) => withTenant(kit.A, (tx) => tx.select().from(schema.workflowRuns).where(and(eq(schema.workflowRuns.appointmentId, appointmentId), eq(schema.workflowRuns.workflowId, workflowId))));

  it("skips the reminder for a visit booked inside its window", async () => {
    const a = await book(new Date(Date.now() + 5 * HOUR));
    await triggerAppointmentWorkflows(business, "appointment_booked", a.id);
    const [run] = await runs(a.id, reminderFlow);
    expect(run!.status).toBe("done");
    expect(run!.log.map((l) => l.detail).join(" | ")).toMatch(/inside this window.*Not sent/);
  });

  it("restarts only the visit-timed flow on every move, including back to an earlier time", async () => {
    const first = new Date(Date.now() + 72 * HOUR);
    const a = await book(first);
    await triggerAppointmentWorkflows(business, "appointment_booked", a.id);
    await move(a.itemId, new Date(first.getTime() + 24 * HOUR));
    await resyncAppointmentRuns(business, a.id, "rescheduled");
    await move(a.itemId, first);
    await resyncAppointmentRuns(business, a.id, "rescheduled");
    const reminder = await runs(a.id, reminderFlow);
    expect(reminder.map((r) => r.status).sort()).toEqual(["active", "cancelled", "cancelled"]);
    expect((await runs(a.id, thanksFlow)).length).toBe(1);
  });

  it("re-derives a visit-timed wait from where the visit is now when the cron wakes it (moved with notify:false)", async () => {
    const first = new Date(Date.now() + 120 * HOUR);
    const a = await book(first);
    await triggerAppointmentWorkflows(business, "appointment_booked", a.id);
    const [run] = await runs(a.id, reminderFlow);
    expect(run!.status).toBe("active");
    expect(run!.nextAt!.getTime()).toBe(first.getTime() - 24 * HOUR);
    // Moved two days later by a path that never told the workflow engine (no resync).
    const later = new Date(first.getTime() + 48 * HOUR);
    await move(a.itemId, later);
    await processWorkflowRuns(new Date(run!.nextAt!.getTime() + HOUR), { businessIds: [kit.A] });
    const [after] = await runs(a.id, reminderFlow);
    expect(after!.status).toBe("active");
    expect(after!.nextAt!.getTime()).toBe(later.getTime() - 24 * HOUR);
    expect(after!.log.at(-1)!.detail).toMatch(/^Appointment moved: resumes /);
    expect(after!.log.at(-1)!.detail).not.toMatch(/T\d\d:\d\d:\d\d/); // business-local wording, not ISO
  });

  it("starts the booked flows without a confirmation, leaving out only the reminder ones when reminders are off", async () => {
    const a = await book(new Date(Date.now() + 200 * HOUR));
    await afterAppointmentBooked(business, a.id, { reminders: false });
    expect((await runs(a.id, reminderFlow)).length).toBe(0);
    expect((await runs(a.id, thanksFlow)).map((r) => r.status)).toEqual(["done"]);
    const b = await book(new Date(Date.now() + 230 * HOUR));
    await afterAppointmentBooked(business, b.id);
    expect((await runs(b.id, reminderFlow)).map((r) => r.status)).toEqual(["active"]);
  });
});
