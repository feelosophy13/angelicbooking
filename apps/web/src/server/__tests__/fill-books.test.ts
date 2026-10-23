/**
 * Fill My Books end to end against the database: a gap on tomorrow's calendar becomes an opening; the waitlist, a client due back and a
 * regular are suggested (a due client without marketing consent is listed but can't be invited, a booked one isn't listed); Send queues
 * personal invitations within the per-slot cap, marked marketing except for the waitlist; a booking by an invited client is recorded
 * against the invitation, and the taken slot stops being an opening. Needs Postgres at DATABASE_URL; skipped otherwise. Nothing is
 * delivered: delivery is mocked out and the queued messages are cancelled before teardown.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { instantToISODate, weekdayOf, zonedToInstant } from "@angelic/core";
import { shiftISODate } from "@/lib/utils";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("@/lib/notify/providers", async (orig) => ({ ...(await orig<typeof import("@/lib/notify/providers")>()), emailConfigured: () => true }));

const { findOpenings, sendFillInvites, recordFillBookings, FillError } = await import("@/server/fill-books");

const up = await reachable();
const DAY = 86_400_000;

describe.skipIf(!up)("Fill My Books", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let staffId: string;
  let serviceId: string;
  let tz: string;
  let tomorrow: string;
  let now: Date;
  const ids: Record<string, string> = {};
  const business = () => db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }).then((b) => b!);

  beforeAll(async () => {
    kit = await setupKit([]);
    await db.update(schema.businesses).set({ addressLine: "1 Main St, Springfield", fillDaysAhead: 2, fillMaxPerSlot: 2, minNoticeMin: 60 }).where(eq(schema.businesses.id, kit.A));
    tz = (await business()).timezone;
    const today = instantToISODate(new Date(), tz);
    tomorrow = shiftISODate(today, 1);
    now = zonedToInstant(today, "08:00", tz);
    const at = (hhmm: string, day = tomorrow) => zonedToInstant(day, hhmm, tz);
    await withTenant(kit.A, async (tx) => {
      const [s] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Jamie Lee" }).returning({ id: schema.staff.id });
      staffId = s!.id;
      // Works tomorrow only, 9 to 5.
      await tx.insert(schema.staffSchedules).values({ businessId: kit.A, staffId, weekday: weekdayOf(tomorrow), startTime: "09:00", endTime: "17:00" });
      const [svc] = await tx.insert(schema.services).values({ businessId: kit.A, name: "Cut", durationMin: 60, priceCents: 6000 }).returning({ id: schema.services.id });
      serviceId = svc!.id;
      const mk = async (key: string, extra: Partial<typeof schema.clients.$inferInsert> = {}) => {
        const [c] = await tx.insert(schema.clients).values({ businessId: kit.A, firstName: key, lastName: "Test", email: `${key.toLowerCase()}@example.invalid`, phone: "+15555550100", ...extra }).returning({ id: schema.clients.id });
        ids[key] = c!.id;
      };
      await mk("Wait", { emailMarketingOptIn: false });
      await mk("Due");
      await mk("NoConsent", { emailMarketingOptIn: false });
      await mk("Booked");
      await mk("Regular");
      const appt = async (clientId: string, start: Date, status: "completed" | "booked") => {
        const [a] = await tx.insert(schema.appointments).values({ businessId: kit.A, clientId, status }).returning({ id: schema.appointments.id });
        await tx.insert(schema.appointmentItems).values({ businessId: kit.A, appointmentId: a!.id, staffId, serviceId, serviceName: "Cut", startAt: start, endAt: new Date(start.getTime() + 3_600_000), priceCents: 6000, status });
        return a!.id;
      };
      // Tomorrow is booked 9–1 and 3–5 (another client), leaving 1–3 open.
      const filler = (await tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Filler" }).returning({ id: schema.clients.id }))[0]!.id;
      for (const h of ["09:00", "10:00", "11:00", "12:00", "15:00", "16:00"]) await appt(filler, at(h), "booked");
      // Past visits, an hour apart so they don't overlap on Jamie's calendar.
      for (const [i, key] of ["Due", "NoConsent", "Booked"].entries()) for (const ago of [100, 70, 40]) await appt(ids[key]!, new Date(now.getTime() - ago * DAY + (i + 1) * 3_600_000), "completed");
      for (const ago of [110, 80, 50, 20]) await appt(ids.Regular!, new Date(now.getTime() - ago * DAY + 5 * 3_600_000), "completed");
      await appt(ids.Booked!, new Date(now.getTime() + 9 * DAY), "booked");
      await tx.insert(schema.waitlist).values({ businessId: kit.A, clientId: ids.Wait!, date: tomorrow });
    });
  });

  afterAll(async () => {
    if (kit) await withTenant(kit.A, (tx) => tx.update(schema.notifications).set({ status: "cancelled" }).where(eq(schema.notifications.businessId, kit.A)));
    await kit?.teardown();
  });

  it("finds the gap and suggests the right clients, best first", async () => {
    const { openings } = await findOpenings(await business(), now);
    const o = openings.find((x) => x.date === tomorrow)!;
    expect(o).toBeTruthy();
    expect([new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(o.start), o.minutes]).toEqual(["13:00", 120]);
    expect(o.suggestions.map((s) => [s.name, s.reason, s.channel])).toEqual([
      ["Wait Test", "waitlist", "email"], // no marketing consent, but asked for this day
      ["Due Test", "overdue", "email"],
      ["Regular Test", "regular", "email"],
      ["NoConsent Test", "overdue", null],
    ]);
    expect(o.suggestions.find((s) => s.name === "NoConsent Test")!.blocked).toMatch(/consent/);
    expect(openings.every((x) => x.date === tomorrow)).toBe(true); // nobody works today
  });

  it("sends within the per-slot cap and marks marketing except for the waitlist", async () => {
    const b = await business();
    const { openings } = await findOpenings(b, now);
    const o = openings[0]!;
    const r = await sendFillInvites(b, { staffId, start: o.start, locationId: null, clientIds: [ids.Wait!, ids.Due!, ids.Regular!, ids.NoConsent!] }, null, now);
    expect(r.sent).toBe(2);
    const rows = await withTenant(kit.A, (tx) => tx.select().from(schema.notifications).where(eq(schema.notifications.template, "fill_invite")));
    const byClient = new Map(rows.map((n) => [n.clientId, n]));
    expect([...byClient.keys()].sort()).toEqual([ids.Wait!, ids.Due!].sort());
    expect(byClient.get(ids.Wait!)!.marketing).toBe(false);
    expect(byClient.get(ids.Due!)!.marketing).toBe(true);
    expect(byClient.get(ids.Due!)!.body).toContain(`time=${encodeURIComponent(o.start.toISOString())}`);
    expect(byClient.get(ids.Due!)!.scheduledAt.getTime()).toBeGreaterThanOrEqual(now.getTime()); // held to daytime
    await expect(sendFillInvites(b, { staffId, start: o.start, locationId: null, clientIds: [ids.Regular!] }, null, now)).rejects.toBeInstanceOf(FillError);
  });

  it("records the booking it brought and stops offering the taken slot", async () => {
    const o = (await findOpenings(await business(), now)).openings[0]!;
    await withTenant(kit.A, async (tx) => {
      const [a] = await tx.insert(schema.appointments).values({ businessId: kit.A, clientId: ids.Due!, status: "booked", source: "online" }).returning({ id: schema.appointments.id });
      await tx.insert(schema.appointmentItems).values({ businessId: kit.A, appointmentId: a!.id, staffId, serviceId, serviceName: "Cut", startAt: o.start, endAt: new Date(o.start.getTime() + 3_600_000), priceCents: 6000, status: "booked" });
    });
    expect(await recordFillBookings(kit.A)).toBe(1);
    const inv = await withTenant(kit.A, (tx) => tx.query.fillInvites.findFirst({ where: eq(schema.fillInvites.clientId, ids.Due!) }));
    expect(inv!.bookedExactSlot).toBe(true);
    const after = (await findOpenings(await business(), now)).openings;
    expect(after.some((x) => x.start.getTime() === o.start.getTime())).toBe(false);
    // The rest of the gap (2–3) is still open, and its invitations count toward the same slot cap.
    expect(after).toHaveLength(1);
  });
});
