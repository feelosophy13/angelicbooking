/**
 * Integration test: booking for more than one person online (server/group-booking) and family links (server/client-links). Group
 * availability, per-person prices and deposits, one booking code for everyone, cancelling one vs all from the manage link (each
 * refund names only that person's share of the shared charge), moving the group, checking out together, and a child's messages going
 * to a parent. Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise. Stripe is mocked.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined }), headers: async () => new Headers({ host: "kit.test" }) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("next/navigation", async (orig) => ({ ...(await orig<typeof import("next/navigation")>()), redirect: (url: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { url }); } }));
const refundCalls: { payment_intent: string; amount?: number }[] = [];
vi.mock("@/lib/stripe", async (orig) => ({
  ...(await orig<typeof import("@/lib/stripe")>()),
  stripe: () => ({ refunds: { create: async (p: { payment_intent: string; amount?: number }) => { refundCalls.push(p); return { id: `re_${refundCalls.length}` }; } } }),
}));
import { eq, inArray } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { addDays, instantToISODate, zonedToInstant } from "@angelic/core";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";
import { encodeVerifiedContact } from "@/lib/client-session";
import type { PaymentContext } from "@/server/locations";
import type { GuestChoice } from "@/lib/group-guests";

const { bookOnline } = await import("@/app/book/[slug]/actions");
const { createGroupBooking, groupPaymentRequirement, planGroup, groupAppointments } = await import("@/server/group-booking");
const { cancelOnline, getManagedAppointment, getPublicBusiness, groupMoveTimes, rescheduleOnline } = await import("@/server/public-booking");
const { appointmentContact, linkClients, linkedClients, unlinkClients } = await import("@/server/client-links");
const { openGroupSale, openSaleForAppointment } = await import("@/server/sales");
const { BookingError } = await import("@/server/booking");

const up = await reachable();
const PHONE = "+15715550191";

describe.skipIf(!up)("booking for more than one person", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let ana: string, bea: string, cy: string;
  let cut: string, mani: string, kids: string, brow: string;
  let tz = "America/New_York";
  let day = "";
  const at = (hhmm: string, d = day) => zonedToInstant(d, hhmm, tz);
  // Stripe looks connected, so deposits are asked for (the charge itself is faked below).
  const pay = { ready: true, helcimReady: false, provider: "stripe", accountId: "acct_test" } as unknown as PaymentContext;
  const biz = async () => (await getPublicBusiness(kit.A))!;

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||= "pk_test_x";
    kit = await setupKit([]);
    await db.update(schema.businesses).set({ onlineBookingEnabled: true, publishRequiresVerified: false, verifyBookingContact: false, cancelWindowHours: 24, depositRefundAs: "original" }).where(eq(schema.businesses.id, kit.A));
    tz = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }))!.timezone;
    day = addDays(instantToISODate(new Date(), tz), 10);
    await withTenant(kit.A, async (tx) => {
      await tx.insert(schema.locations).values({ businessId: kit.A, name: "Main", isDefault: true });
      const staff = await tx.insert(schema.staff).values([{ businessId: kit.A, displayName: "Ana", sortOrder: 1 }, { businessId: kit.A, displayName: "Bea", sortOrder: 2 }, { businessId: kit.A, displayName: "Cy", sortOrder: 3 }]).returning();
      [ana, bea, cy] = staff.map((s) => s.id) as [string, string, string];
      for (const s of staff) for (let weekday = 0; weekday < 7; weekday++) await tx.insert(schema.staffSchedules).values({ businessId: kit.A, staffId: s.id, weekday, startTime: "09:00", endTime: "17:00" });
      const sv = await tx
        .insert(schema.services)
        .values([
          { businessId: kit.A, name: "Cut", durationMin: 60, priceCents: 6000, depositCents: 2000, depositType: "flat" },
          { businessId: kit.A, name: "Manicure", durationMin: 30, priceCents: 3000, depositType: "percent", depositPercent: 50 },
          { businessId: kit.A, name: "Kids cut", durationMin: 30, priceCents: 2500 },
          { businessId: kit.A, name: "Brow tint", durationMin: 15, priceCents: 1500 },
        ])
        .returning();
      [cut, mani, kids, brow] = sv.map((s) => s.id) as [string, string, string, string];
      // Bea charges more for a manicure; Cy doesn't do cuts.
      await tx.insert(schema.staffServices).values([{ businessId: kit.A, staffId: ana, serviceId: cut }, { businessId: kit.A, staffId: bea, serviceId: cut }, { businessId: kit.A, staffId: bea, serviceId: mani, priceCentsOverride: 4000 }, { businessId: kit.A, staffId: cy, serviceId: mani }]);
      // Brow tint is suggested with a kids cut, at $10.
      await tx.insert(schema.serviceAddons).values({ businessId: kit.A, serviceId: kids, addonServiceId: brow, priceCents: 1000 });
    });
  });
  afterAll(async () => {
    await kit?.teardown();
  });

  const g = (serviceId: string, staffId: string, timing: GuestChoice["timing"], extraServiceIds: string[] = []): GuestChoice => ({ serviceId, staffId, timing, extraServiceIds });

  describe("group availability", () => {
    it("plans guests together with others, or right after the person before", async () => {
      // Mia with Ana after Jen's hour; Pat with Cy at once; Lou with Cy as Pat finishes.
      const plan = await planGroup(await biz(), { serviceId: cut, staffId: ana, startAt: at("10:00"), guests: [g(kids, ana, "after"), g(mani, cy, "together"), g(mani, cy, "after")] });
      expect(plan.guests.map((p) => [p.staffName, p.startAt.toISOString()])).toEqual([["Ana", at("11:00").toISOString()], ["Cy", at("10:00").toISOString()], ["Cy", at("10:30").toISOString()]]);
    });

    it("refuses a stylist already busy with someone else in the booking", async () => {
      await expect(planGroup(await biz(), { serviceId: cut, staffId: ana, startAt: at("10:00"), guests: [g(kids, ana, "together")] })).rejects.toThrow(/with someone else in your booking/);
    });

    it("gives 'any' guests whoever is still free, never the same person twice", async () => {
      const plan = await planGroup(await biz(), { serviceId: mani, staffId: cy, startAt: at("11:00"), guests: [g(mani, "any", "together"), g(kids, "any", "together")] });
      // Cy has the booker, so the manicure goes to Bea (the other one who does them) and the kids cut to Ana.
      expect(plan.guests.map((p) => p.staffName)).toEqual(["Bea", "Ana"]);
    });

    it("refuses a guest whose stylist isn't working then", async () => {
      await expect(planGroup(await biz(), { serviceId: cut, staffId: ana, startAt: at("16:00"), guests: [g(kids, "any", "after")] })).rejects.toBeInstanceOf(BookingError);
    });

    it("plans each guest's own add-on at its add-on price, right after their service", async () => {
      const plan = await planGroup(await biz(), { serviceId: cut, staffId: ana, startAt: at("10:00"), guests: [g(kids, bea, "together", [brow])] });
      expect(plan.guests[0]!.extras.map((x) => [x.name, x.priceCents, x.startAt.toISOString()])).toEqual([["Brow tint", 1000, at("10:30").toISOString()]]);
      expect(plan.guests[0]!.totalCents).toBe(3500);
    });
  });

  describe("pricing and deposits", () => {
    it("works out each person's deposit on their own price and adds them up", async () => {
      const plan = await planGroup(await biz(), { serviceId: cut, staffId: ana, startAt: at("13:00"), guests: [g(mani, bea, "together"), g(kids, cy, "together")] });
      expect(plan.guests.map((p) => p.totalCents)).toEqual([4000, 2500]);
      // Cut: $20 flat; Bea's manicure: 50% of her $40; kids cut: none.
      expect(groupPaymentRequirement(await biz(), pay, plan)).toMatchObject({ mode: "deposit", amountCents: 4000, shares: [2000, 2000, 0] });
    });
  });

  describe("one booking for everyone", () => {
    let leadToken = "";
    let ids: string[] = [];
    it("books each person their own appointment, tied together, with their own share of the deposit", async () => {
      const b = await biz();
      const guests = [g(mani, bea, "together"), g(kids, cy, "together")];
      const plan = await planGroup(b, { serviceId: cut, staffId: ana, startAt: at("13:00"), guests });
      const req = groupPaymentRequirement(b, pay, plan);
      const [lead] = await withTenant(kit.A, (tx) => tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Jen", lastName: "Group", phone: PHONE, email: "jen.group@example.test" }).returning());
      const paid = { kind: "deposit" as const, paymentIntentId: `pi_group_${kit.A}`, cents: req.amountCents, surchargeCents: 0, cardLabel: "VISA •••• 4242", accountId: "acct_test", provider: "stripe" as const, meta: { businessId: kit.A, clientId: lead!.id, serviceId: cut, staffId: ana, startAt: at("13:00").toISOString(), locationId: "" } };
      const r = await createGroupBooking(
        b,
        pay,
        {
          serviceId: cut, staffId: ana, startAt: at("13:00"), firstName: "Jen", lastName: "Group", email: "jen.group@example.test", phone: PHONE, notes: null,
          guests,
          guestDetails: [
            { firstName: "Pat", lastName: "Friend", phone: null, email: "pat@example.test", relation: "friend" },
            { firstName: "Mia", lastName: "Group", phone: null, email: null, relation: "child" },
          ],
        },
        new Date(),
        paid,
      );
      leadToken = r.token;
      ids = r.appointmentIds;
      const appts = await withTenant(kit.A, (tx) => tx.select().from(schema.appointments).where(inArray(schema.appointments.id, ids)));
      expect(appts.every((a) => a.groupId === r.appointmentId)).toBe(true);
      expect(new Set(appts.map((a) => a.clientId)).size).toBe(3);
      const byId = new Map(appts.map((a) => [a.id, a]));
      expect(ids.map((id) => byId.get(id)!.depositCents)).toEqual([2000, 2000, 0]);
      expect(ids.map((id) => byId.get(id)!.depositPaymentIntentId)).toEqual([paid.paymentIntentId, paid.paymentIntentId, null]);
      // Mia, typed in as "my child", is now linked to Jen, and her reminders go to Jen's phone and email.
      const fam = await linkedClients(kit.A, lead!.id);
      expect(fam.map((f) => [f.firstName, f.relation])).toEqual([["Mia", "child"]]);
      const mia = await withTenant(kit.A, (tx) => tx.query.clients.findFirst({ where: eq(schema.clients.id, fam[0]!.id) }));
      const reach = await withTenant(kit.A, (tx) => appointmentContact(tx, mia!));
      expect([reach.phone, reach.email, reach.via]).toEqual([PHONE, "jen.group@example.test", lead!.id]);
      // Pat was a friend: not linked.
      expect((await groupAppointments(kit.A, ids[1]!)).length).toBe(3);
    });

    it("the booker's page lists everyone; a guest's own page only says who booked", async () => {
      const m = await getManagedAppointment(kit.A, leadToken);
      expect(m!.group!.lead).toBe(true);
      expect(m!.group!.members.map((x) => x.name)).toEqual(["Jen Group", "Pat Friend", "Mia Group"]);
      const guest = await getManagedAppointment(kit.A, m!.group!.members[1]!.token);
      expect([guest!.group!.lead, guest!.group!.leadName]).toEqual([false, "Jen Group"]);
    });

    it("moves the whole group together from the booker's page", async () => {
      const times = await groupMoveTimes(kit.A, leadToken, day);
      expect(times.some((t) => t.getTime() === at("14:00").getTime())).toBe(true);
      // 16:30 would put the hour-long cut past closing.
      expect(times.some((t) => t.getTime() === at("16:30").getTime())).toBe(false);
      await rescheduleOnline(kit.A, leadToken, at("14:00"));
      const items = await withTenant(kit.A, (tx) => tx.select().from(schema.appointmentItems).where(inArray(schema.appointmentItems.appointmentId, ids)));
      expect([...new Set(items.filter((i) => i.sortOrder === 0).map((i) => i.startAt.toISOString()))]).toEqual([at("14:00").toISOString()]);
    });

    it("cancels just one guest: only their appointment, only their share back", async () => {
      refundCalls.length = 0;
      const m = await getManagedAppointment(kit.A, leadToken);
      const pat = m!.group!.members.find((x) => x.name === "Pat Friend")!;
      await cancelOnline(kit.A, pat.token);
      const appts = await withTenant(kit.A, (tx) => tx.select().from(schema.appointments).where(inArray(schema.appointments.id, ids)));
      expect(appts.filter((a) => a.status === "cancelled").map((a) => a.id)).toEqual([pat.id]);
      // The shared charge is refunded by Pat's $20 share, named explicitly, not in full.
      expect(refundCalls).toEqual([expect.objectContaining({ payment_intent: `pi_group_${kit.A}`, amount: 2000 })]);
    });

    it("cancels everyone from the booker's page", async () => {
      refundCalls.length = 0;
      await cancelOnline(kit.A, leadToken, null, true);
      const appts = await withTenant(kit.A, (tx) => tx.select().from(schema.appointments).where(inArray(schema.appointments.id, ids)));
      expect(appts.every((a) => a.status === "cancelled")).toBe(true);
      expect(refundCalls).toEqual([expect.objectContaining({ amount: 2000 })]);
    });
  });

  it("one booking code covers the guests, and the free path books them all", async () => {
    await db.update(schema.businesses).set({ verifyBookingContact: true }).where(eq(schema.businesses.id, kit.A));
    try {
      const fd = new FormData();
      const guests = `${kids}.${cy}.t`;
      for (const [k, v] of Object.entries({ slug: kit.A, serviceId: kids, staffId: ana, startAt: at("09:00").toISOString(), firstName: "Lee", lastName: "Code", phone: "(571) 555-0192", email: "lee@example.test", notes: "", guests, guest0FirstName: "Sam", guest0Relation: "child" })) fd.set(k, v);
      expect(await bookOnline(undefined, fd)).toEqual({ error: expect.stringMatching(/code/) });
      fd.set("verifyToken", encodeVerifiedContact(kit.A, "+15715550192"));
      const out = await bookOnline(undefined, fd).catch((e: Error & { url?: string }) => e);
      expect((out as { url?: string }).url).toMatch(/\/confirmed\//);
      const lee = await withTenant(kit.A, (tx) => tx.query.clients.findFirst({ where: eq(schema.clients.email, "lee@example.test") }));
      const appts = await withTenant(kit.A, (tx) => tx.select().from(schema.appointments).where(eq(schema.appointments.clientId, lee!.id)));
      const group = await withTenant(kit.A, (tx) => tx.select().from(schema.appointments).where(eq(schema.appointments.groupId, appts[0]!.id)));
      expect(group.length).toBe(2);
    } finally {
      await db.update(schema.businesses).set({ verifyBookingContact: false }).where(eq(schema.businesses.id, kit.A));
    }
  });

  it("refuses a deposit that doesn't cover everyone (a guest added after paying)", async () => {
    const b = await biz();
    const startAt = at("15:00");
    const paid = { kind: "deposit" as const, paymentIntentId: `pi_short_${kit.A}`, cents: 2000, surchargeCents: 0, cardLabel: null, accountId: "acct_test", provider: "stripe" as const, meta: { businessId: kit.A, clientId: "x", serviceId: cut, staffId: ana, startAt: startAt.toISOString(), locationId: "" } };
    const input = { serviceId: cut, staffId: ana, startAt, firstName: "Max", lastName: "Paid", email: null, phone: "+15715550193", notes: null, guests: [g(mani, bea, "together")], guestDetails: [{ firstName: "Zoe", lastName: "", phone: null, email: null, relation: "friend" as const }] };
    await expect(createGroupBooking(b, pay, input, new Date(), paid)).rejects.toThrow(/deposit for your group changed/);
    const made = await withTenant(kit.A, (tx) => tx.select().from(schema.appointments).where(eq(schema.appointments.depositPaymentIntentId, paid.paymentIntentId)));
    expect(made).toEqual([]);
  });

  it("checks a group out on one ticket and completes everyone when it is paid", async () => {
    const b = await biz();
    const guests = [g(mani, cy, "together")];
    const noPay = { ready: false, helcimReady: false, provider: "stripe", accountId: null } as unknown as PaymentContext;
    const r = await createGroupBooking(b, noPay, { serviceId: cut, staffId: bea, startAt: at("09:00", addDays(day, 1)), firstName: "Ola", lastName: "Desk", email: null, phone: "+15715550194", notes: null, guests, guestDetails: [{ firstName: "Kim", lastName: "", phone: null, email: null, relation: "partner" }] });
    const userId = `u_${kit.A}`;
    await db.insert(schema.user).values({ id: userId, name: "Desk", email: `${userId}@example.test`, emailVerified: true }).onConflictDoNothing();
    const saleId = await openGroupSale({ businessId: kit.A, appointmentIds: r.appointmentIds, actorUserId: userId, taxRateBps: 0, currency: "usd" });
    const lines = await withTenant(kit.A, (tx) => tx.select().from(schema.saleLines).where(eq(schema.saleLines.saleId, saleId)));
    expect(lines.map((l) => [l.name, l.amountCents]).sort()).toEqual([["Cut", 6000], ["Manicure", 3000]]);
    // The guest's own "Check out" lands on the shared ticket, not a second one.
    expect(await openSaleForAppointment({ businessId: kit.A, appointmentId: r.appointmentIds[1]!, actorUserId: userId, taxRateBps: 0, currency: "usd" })).toBe(saleId);
    const { recordManualPayment } = await import("@/server/sales");
    await recordManualPayment({ businessId: kit.A, saleId, method: "cash", amountCents: 9000, note: null, actorUserId: userId, taxRateBps: 0 });
    const appts = await withTenant(kit.A, (tx) => tx.select().from(schema.appointments).where(inArray(schema.appointments.id, r.appointmentIds)));
    expect(appts.map((a) => a.status)).toEqual(["completed", "completed"]);
  });

  describe("family links", () => {
    it("links both ways, lists each side's relation, and unlinks", async () => {
      const [mom, kid] = await withTenant(kit.A, (tx) => tx.insert(schema.clients).values([{ businessId: kit.A, firstName: "Rae", lastName: "Mom", phone: "+15715550195", email: "rae@example.test" }, { businessId: kit.A, firstName: "Tia", lastName: "Kid" }]).returning());
      const userId = `u_${kit.A}`;
      await linkClients({ businessId: kit.A, clientId: mom!.id, linkedClientId: kid!.id, relation: "child", actorUserId: userId });
      expect((await linkedClients(kit.A, mom!.id)).map((x) => [x.firstName, x.relation])).toEqual([["Tia", "child"]]);
      expect((await linkedClients(kit.A, kid!.id)).map((x) => [x.firstName, x.relation])).toEqual([["Rae", "parent"]]);
      // A child without a phone or email hears at the parent's; a partner's own contact is never replaced.
      const reach = await withTenant(kit.A, (tx) => appointmentContact(tx, kid!));
      expect([reach.phone, reach.email]).toEqual(["+15715550195", "rae@example.test"]);
      const momReach = await withTenant(kit.A, (tx) => appointmentContact(tx, mom!));
      expect(momReach.via).toBeNull();
      await unlinkClients({ businessId: kit.A, clientId: kid!.id, linkedClientId: mom!.id, actorUserId: userId });
      expect(await linkedClients(kit.A, mom!.id)).toEqual([]);
      const after = await withTenant(kit.A, (tx) => appointmentContact(tx, kid!));
      expect(after.phone).toBeNull();
    });

    it("keeps each business's links to itself", async () => {
      const rows = await withTenant(kit.B, (tx) => tx.select().from(schema.clientLinks));
      expect(rows).toEqual([]);
    });
  });
});
