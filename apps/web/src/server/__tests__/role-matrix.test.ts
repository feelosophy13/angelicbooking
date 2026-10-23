/**
 * The per-role regression guard for PERMISSIONS-PLAN-2026-10-18.md: each default role opens the real pages (rendered to HTML with the
 * page's own data loaders) and the mobile routes against one seeded business, and the test says which sensitive fields may appear for
 * whom: a client's phone and email, what they spend, other staff's hours and time-clock rows, prices, stock counts, the review authors,
 * other people's tickets. A new leak fails here, not on the owner's screen.
 *
 * The viewer is swapped by mocking lib/tenant (the only place the tenant and permissions are decided) and lib/mobile-auth; everything
 * below them runs for real against Postgres at DATABASE_URL (the app role, RLS forced); skipped when it is not reachable.
 */
import "../../../../../packages/db/src/env";
import React, { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { can, DEFAULT_ROLE_PERMISSIONS, instantToISODate, type Action, type Permissions, type Role } from "@angelic/core";
import { reachable } from "@/lib/__tests__/api-test-kit";

// The component tree is written for the automatic JSX runtime; give the test transform what it needs.
(globalThis as unknown as { React: typeof React }).React = React;

type Viewer = { business: typeof schema.businesses.$inferSelect; role: string; permissions: Permissions; user: { id: string; name: string; email: string }; staffId: string | null };
const state = vi.hoisted(() => ({ viewer: null as Viewer | null }));

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set() {}, delete() {} }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath() {}, revalidateTag() {}, unstable_cache: (f: unknown) => f }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); },
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
// The appointment page's supplies card is an async server component, which the static renderer cannot await; it is not under test.
vi.mock("@/app/app/[slug]/appointments/[id]/supplies-card", () => ({ SuppliesCard: () => null }));
vi.mock("@/lib/tenant", async (orig) => {
  const actual = await orig<typeof import("@/lib/tenant")>();
  const ctx = () => {
    if (!state.viewer) throw new Error("no viewer set");
    return { ...state.viewer, viewingAs: null, realRole: state.viewer.role, plan: { state: "ok" } as never };
  };
  const need = (ok: boolean) => { if (!ok) throw new actual.PermissionError(); };
  return {
    ...actual,
    requireBusiness: async () => ctx(),
    requireAction: async (_slug: string, a: Action) => { const c = ctx(); need(can(c.permissions, a)); return c; },
    requireActions: async (_slug: string, ...as: Action[]) => { const c = ctx(); need(as.every((a) => can(c.permissions, a))); return c; },
    requireAnyAction: async (_slug: string, ...as: Action[]) => { const c = ctx(); need(as.some((a) => can(c.permissions, a))); return c; },
    requireBillingAction: async () => { const c = ctx(); need(can(c.permissions, "billing.manage")); return c; },
  };
});
vi.mock("@/lib/mobile-auth", () => ({
  mobileContext: async () => {
    const v = state.viewer!;
    return { session: { user: v.user }, memberships: [], business: v.business, role: v.role, permissions: v.permissions, myStaffId: v.staffId };
  },
}));

const up = await reachable();

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PageModule = { default: (p: any) => Promise<unknown> };
async function render(load: () => Promise<PageModule>, params: Record<string, string> = {}, sp: Record<string, string> = {}) {
  const { default: Page } = await load();
  const el = await Page({ params: Promise.resolve({ slug: "matrix", ...params }), searchParams: Promise.resolve(sp) });
  return text(renderToStaticMarkup(el as ReactElement));
}
/** True when the page refuses the viewer (the permission error, or an own-only notFound). */
async function denied(load: () => Promise<PageModule>, params: Record<string, string> = {}) {
  const { PermissionError } = await import("@/lib/tenant");
  try {
    await render(load, params);
    return false;
  } catch (e) {
    if (e instanceof PermissionError || (e as Error).message === "NEXT_NOT_FOUND") return true;
    throw e;
  }
}
const req = (url: string) => new Request(`http://x${url}`);

const pages = {
  clients: () => import("@/app/app/[slug]/clients/page"),
  client: () => import("@/app/app/[slug]/clients/[clientId]/page"),
  appointment: () => import("@/app/app/[slug]/appointments/[id]/page"),
  reviews: () => import("@/app/app/[slug]/reviews/page"),
  staff: () => import("@/app/app/[slug]/staff/page"),
  staffHours: () => import("@/app/app/[slug]/staff-hours/page"),
  time: () => import("@/app/app/[slug]/time/page"),
  sales: () => import("@/app/app/[slug]/sales/page"),
  products: () => import("@/app/app/[slug]/products/page"),
  giftCards: () => import("@/app/app/[slug]/gift-cards/page"),
  drawer: () => import("@/app/app/[slug]/drawer/page"),
  drawerHistory: () => import("@/app/app/[slug]/drawer/history/page"),
  closing: () => import("@/app/app/[slug]/reports/closing/page"),
  clientCharts: () => import("@/app/app/[slug]/clients/[clientId]/charts/page"),
  chart: () => import("@/app/app/[slug]/charts/[noteId]/page"),
} satisfies Record<string, () => Promise<PageModule>>;

describe.skipIf(!up)("what each default role sees", () => {
  const tag = crypto.randomUUID().slice(0, 8);
  const biz = `matrix_${tag}`;
  const uid = (k: string) => `${biz}_${k}`;
  const ids = {} as Record<"jordan" | "ava" | "client" | "service" | "a1" | "a2" | "a3" | "main" | "chart", string>;
  let business: typeof schema.businesses.$inferSelect;
  const PHONE = "+17035551001";
  /** How the client list prints it (lib/format.ts `phone`). */
  const PHONE_SHOWN = "(703) 555-1001";
  const EMAIL = "jo.lee@example.test";

  beforeAll(async () => {
    await db.insert(schema.organization).values({ id: biz, name: biz, slug: biz });
    await db.insert(schema.businesses).values({ id: biz, name: "Matrix Salon", slug: biz, timezone: "America/New_York" });
    business = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, biz) }))!;
    await db.insert(schema.user).values([
      { id: uid("owner"), name: "Olive Owner", email: `${uid("owner")}@example.test`, emailVerified: true },
      { id: uid("jordan"), name: "Jordan", email: `${uid("jordan")}@example.test`, emailVerified: true },
      { id: uid("ava"), name: "Ava", email: `${uid("ava")}@example.test`, emailVerified: true },
      { id: uid("marcus"), name: "Marcus", email: `${uid("marcus")}@example.test`, emailVerified: true },
    ]);
    const tz = business.timezone;
    const today = instantToISODate(new Date(), tz);
    const at = (daysFromNow: number, hour: number) => {
      const d = new Date(`${today}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + daysFromNow);
      const day = d.toISOString().slice(0, 10);
      // Noon-ish local times, so the day never straddles midnight whatever the zone.
      return new Date(`${day}T${String(hour).padStart(2, "0")}:00:00-04:00`);
    };
    await withTenant(biz, async (tx) => {
      const [main] = await tx.insert(schema.locations).values({ businessId: biz, name: "Main", isDefault: true }).returning();
      await tx.insert(schema.locations).values({ businessId: biz, name: "Second" });
      ids.main = main!.id;
      const [jordan] = await tx.insert(schema.staff).values({ businessId: biz, displayName: "Jordan", userId: uid("jordan"), email: "jordan@example.test" }).returning();
      const [ava] = await tx.insert(schema.staff).values({ businessId: biz, displayName: "Ava", userId: uid("ava"), email: "ava@example.test" }).returning();
      ids.jordan = jordan!.id;
      ids.ava = ava!.id;
      await tx.insert(schema.staffSchedules).values([
        { businessId: biz, staffId: ava!.id, weekday: 2, startTime: "10:00", endTime: "16:00", locationId: main!.id },
        { businessId: biz, staffId: jordan!.id, weekday: 4, startTime: "10:00", endTime: "16:00", locationId: main!.id },
      ]);
      const [svc] = await tx.insert(schema.services).values({ businessId: biz, name: "Lash Lift", durationMin: 60, priceCents: 9000 }).returning();
      ids.service = svc!.id;
      const [client] = await tx.insert(schema.clients).values({ businessId: biz, firstName: "Jo", lastName: "Lee", phone: PHONE, email: EMAIL, birthday: "1990-04-12", notes: "allergic to latex" }).returning();
      ids.client = client!.id;
      const appt = async (staffId: string, start: Date, status: "completed" | "booked", priceCents: number) => {
        const [a] = await tx.insert(schema.appointments).values({ businessId: biz, clientId: client!.id, locationId: main!.id, status, notes: "Visit note here" }).returning();
        await tx.insert(schema.appointmentItems).values({ businessId: biz, appointmentId: a!.id, staffId, serviceId: svc!.id, serviceName: "Lash Lift", startAt: start, endAt: new Date(start.getTime() + 3_600_000), priceCents, status });
        return a!.id;
      };
      ids.a1 = await appt(jordan!.id, at(-1, 10), "completed", 9000); // Jordan's visit yesterday
      ids.a2 = await appt(ava!.id, at(-1, 14), "completed", 12000); // Ava's visit, same day
      ids.a3 = await appt(ava!.id, at(3, 11), "booked", 12000); // Ava's upcoming visit
      await tx.insert(schema.reviews).values([
        { businessId: biz, clientId: client!.id, appointmentId: ids.a1, staffId: jordan!.id, locationId: main!.id, rating: 5, comment: "Loved it", submittedAt: new Date() },
        { businessId: biz, clientId: client!.id, appointmentId: ids.a2, staffId: ava!.id, locationId: main!.id, rating: 4, comment: "Nice work Ava", submittedAt: new Date() },
      ]);
      // A signed treatment chart on Jordan's visit.
      const [chart] = await tx.insert(schema.chartNotes).values({ businessId: biz, clientId: client!.id, appointmentId: ids.a1, serviceId: svc!.id, serviceName: "Lash Lift", staffId: jordan!.id, templateSnapshot: { name: "SOAP note", fields: [{ id: "s", type: "textarea", label: "Subjective" }] }, answers: { s: "Chart secret: eye sensitivity" }, authorUserId: uid("jordan"), authorName: "Jordan", signedAt: new Date(), signedByUserId: uid("jordan"), signedByName: "Jordan" }).returning();
      ids.chart = chart!.id;
      await tx.insert(schema.products).values({ businessId: biz, name: "Shampoo", priceCents: 2400, costCents: 900, trackStock: true, stockQty: 7 });
      await tx.insert(schema.giftCards).values({ businessId: biz, code: "GC-TEST-9Q2M", initialCents: 5000, balanceCents: 5000 });
      const yesterday = instantToISODate(at(-1, 10), tz);
      await tx.insert(schema.timeEntries).values([
        { businessId: biz, staffId: jordan!.id, date: yesterday, minutes: 120, note: "Jordan shift" },
        { businessId: biz, staffId: ava!.id, date: yesterday, minutes: 240, note: "Ava shift" },
      ]);
    });
    // Two paid tickets, one credited to each stylist, each with a tip.
    const { openWalkInSale, addServiceLine, setTips, recordManualPayment } = await import("@/server/sales");
    for (const [staffId, tip] of [[ids.jordan, 1500], [ids.ava, 2000]] as const) {
      const saleId = await openWalkInSale({ businessId: biz, actorUserId: uid("owner"), currency: "usd", clientId: ids.client, locationId: ids.main });
      await addServiceLine({ businessId: biz, saleId, serviceId: ids.service, staffId, taxRateBps: 0, actorUserId: uid("owner") });
      await setTips({ businessId: biz, saleId, tips: [{ staffId, amountCents: tip }], taxRateBps: 0 });
      await recordManualPayment({ businessId: biz, saleId, method: "cash", amountCents: 1_000_000, note: null, actorUserId: uid("owner"), taxRateBps: 0 });
    }
  });
  afterAll(async () => {
    await db.delete(schema.organization).where(eq(schema.organization.id, biz));
    for (const k of ["owner", "jordan", "ava", "marcus"]) await db.delete(schema.user).where(eq(schema.user.id, uid(k)));
  });

  const as = (role: Role, extra?: { permissions?: Permissions }) => {
    const who = { owner: ["owner", null], manager: ["ava", ids.ava], front_desk: ["marcus", null], provider: ["jordan", ids.jordan] } as const;
    const [k, staffId] = who[role];
    state.viewer = { business, role, permissions: extra?.permissions ?? DEFAULT_ROLE_PERMISSIONS[role], user: { id: uid(k), name: k, email: `${uid(k)}@example.test` }, staffId };
  };
  const only = (...a: Action[]) => new Set(a) as Permissions;

  describe("client list", () => {
    it("shows phone, email and lifetime spend to the desk, the manager and the owner, but not to a provider", async () => {
      for (const role of ["owner", "manager", "front_desk"] as const) {
        as(role);
        const html = await render(pages.clients);
        expect(html, role).toContain(PHONE_SHOWN);
        expect(html, role).toContain(EMAIL);
        expect(html, role).toContain("Lifetime spend");
      }
      as("provider");
      const p = await render(pages.clients);
      expect(p).toContain("Jo Lee");
      expect(p).not.toContain(PHONE);
      expect(p).not.toContain(PHONE_SHOWN);
      expect(p).not.toContain(EMAIL);
      expect(p).not.toContain("Lifetime spend");
    });
  });

  describe("client profile", () => {
    it("desk and manager: contact details, spend, every visit with its provider, every rating", async () => {
      for (const role of ["manager", "front_desk"] as const) {
        as(role);
        const html = await render(pages.client, { clientId: ids.client });
        expect(html, role).toContain(PHONE);
        expect(html, role).toContain("Birthday");
        expect(html, role).toContain("Spent (before tips)");
        expect(html, role).toContain("with Ava");
        expect(html, role).toContain("with Jordan");
        expect(html, role).toContain("Loved it");
        expect(html, role).toContain("Nice work Ava");
      }
    });
    it("provider: name and own visits only, no contact details, no spend, no other provider, only own ratings", async () => {
      as("provider");
      const html = await render(pages.client, { clientId: ids.client });
      expect(html).toContain("Jo Lee");
      expect(html).not.toContain(PHONE);
      expect(html).not.toContain(EMAIL);
      expect(html).not.toContain("Birthday");
      expect(html).not.toContain("Spent (before tips)");
      expect(html).toContain("with Jordan");
      expect(html).not.toContain("with Ava");
      expect(html).toContain("Loved it");
      expect(html).not.toContain("Nice work Ava");
      expect(html).toContain("allergic to latex"); // Provider keeps "Read notes and forms"
    });
    it("a role without View clients cannot open the profile at all", async () => {
      as("provider", { permissions: only("appointments.read.own", "appointments.write.own") });
      expect(await denied(pages.client, { clientId: ids.client })).toBe(true);
    });
  });

  describe("appointment detail", () => {
    it("the desk sees the client's phone and record notes on any visit", async () => {
      as("front_desk");
      const html = await render(pages.appointment, { id: ids.a2 });
      expect(html).toContain(PHONE);
      expect(html).toContain("allergic to latex");
    });
    it("a provider opens their own visit without the phone, and cannot open a colleague's", async () => {
      as("provider");
      const html = await render(pages.appointment, { id: ids.a1 });
      expect(html).toContain("Jo Lee");
      expect(html).not.toContain(PHONE);
      expect(html).toContain("allergic to latex");
      expect(await denied(pages.appointment, { id: ids.a2 })).toBe(true);
    });
    it("the mobile detail route strips the client the same way", async () => {
      const mod = await import("@/app/api/mobile/appointments/[id]/route");
      const GET = async (...a: Parameters<typeof mod.GET>): Promise<Response> => (await mod.GET(...a))!;
      as("provider");
      const mine = await (await GET(req(`/api/mobile/appointments/${ids.a1}?slug=matrix`), { params: Promise.resolve({ id: ids.a1 }) })).json();
      expect(mine.client).toEqual({ id: ids.client, firstName: "Jo", lastName: "Lee", notes: "allergic to latex" });
      expect((await GET(req(`/api/mobile/appointments/${ids.a2}?slug=matrix`), { params: Promise.resolve({ id: ids.a2 }) })).status).toBe(404);
      as("front_desk");
      const desk = await (await GET(req(`/api/mobile/appointments/${ids.a2}?slug=matrix`), { params: Promise.resolve({ id: ids.a2 }) })).json();
      expect(desk.client.phone).toBe(PHONE);
    });
  });

  describe("calendar agenda (mobile)", () => {
    const day = () => instantToISODate(new Date(Date.now() - 86_400_000), "America/New_York");
    const agenda = async () => {
      const mod = await import("@/app/api/mobile/agenda/route");
      const GET = async (...a: Parameters<typeof mod.GET>): Promise<Response> => (await mod.GET(...a))!;
      return (await GET(req(`/api/mobile/agenda?slug=matrix&date=${day()}`))).json();
    };
    it("the desk gets every column with phone, notes and prices", async () => {
      as("front_desk");
      const a = await agenda();
      expect(a.items).toHaveLength(2);
      expect(a.items.every((i: { clientPhone?: string }) => i.clientPhone === PHONE)).toBe(true);
      expect(a.items.map((i: { priceCents: number }) => i.priceCents).sort()).toEqual([12000, 9000].sort());
      expect(a.items[0]!.notes).toBe("Visit note here");
    });
    it("a provider gets their own column, no phone, their notes and prices", async () => {
      as("provider");
      const a = await agenda();
      expect(a.items).toHaveLength(1);
      expect(a.items[0]!.staffId).toBe(ids.jordan);
      expect(a.items[0]).not.toHaveProperty("clientPhone");
      expect(a.items[0]!.notes).toBe("Visit note here");
      expect(a.items[0]!.priceCents).toBe(9000);
    });
    it("a role with only its own calendar gets no price and no notes", async () => {
      as("provider", { permissions: only("appointments.read.own") });
      const a = await agenda();
      expect(a.items).toHaveLength(1);
      expect(a.items[0]!.priceCents).toBe(0);
      expect(a.items[0]!.notes).toBeNull();
      expect(a.items[0]).not.toHaveProperty("depositCents");
    });
  });

  describe("reviews", () => {
    it("the desk and the manager see every review with the author's name", async () => {
      for (const role of ["manager", "front_desk"] as const) {
        as(role);
        const html = await render(pages.reviews);
        expect(html, role).toContain("Loved it");
        expect(html, role).toContain("Nice work Ava");
        expect(html, role).toContain("Jo Lee");
        expect(html, role).toContain("By provider");
      }
    });
    it("a provider sees only their own reviews, with no author and no per-provider card", async () => {
      as("provider");
      const html = await render(pages.reviews);
      expect(html).toContain("Loved it");
      expect(html).not.toContain("Nice work Ava");
      expect(html).not.toContain("Jo Lee");
      expect(html).not.toContain("By provider");
      expect(html).not.toContain("with Ava");
    });
    it("a role with neither reviews permission is refused", async () => {
      as("provider", { permissions: only("clients.read", "appointments.read.own") });
      expect(await denied(pages.reviews)).toBe(true);
    });
  });

  describe("staff", () => {
    it("the staff list shows days worked to the desk and the manager, emails to the manager, neither to a provider", async () => {
      as("manager");
      const m = await render(pages.staff);
      expect(m).toContain("Main Tue"); // Ava's day
      expect(m).toContain("ava@example.test");
      as("front_desk");
      const f = await render(pages.staff);
      expect(f).toContain("Main Tue");
      expect(f).not.toContain("ava@example.test");
      as("provider");
      const p = await render(pages.staff);
      expect(p).toContain("Ava");
      expect(p).not.toContain("Main Tue");
      expect(p).not.toContain("ava@example.test");
      as("provider", { permissions: only("appointments.read.own") });
      expect(await denied(pages.staff)).toBe(true);
    });
    it("Staff hours opens for the desk and the manager, not for a provider", async () => {
      as("front_desk");
      expect(await render(pages.staffHours)).toContain("Ava");
      as("provider");
      expect(await denied(pages.staffHours)).toBe(true);
    });
    it("the time clock shows everyone's rows to the desk (read-only) and the manager (editable), own rows to a provider", async () => {
      as("manager");
      const m = await render(pages.time);
      expect(m).toContain("Ava shift");
      expect(m).toContain("Jordan shift");
      expect(m).toContain("Add hours");
      as("front_desk");
      const f = await render(pages.time);
      expect(f).toContain("Ava shift");
      expect(f).toContain("Jordan shift");
      expect(f).not.toContain("Add hours");
      expect(f).not.toContain("Remove");
      as("provider");
      const p = await render(pages.time);
      expect(p).toContain("Jordan shift");
      expect(p).not.toContain("Ava shift");
      expect(p).not.toContain("Add hours");
    });
  });

  describe("sales", () => {
    it("the desk sees every ticket, a provider only the tickets they are credited on", async () => {
      as("front_desk");
      const f = await render(pages.sales, {}, { tab: "all" });
      expect(f).toContain("#1001"); // Jordan's ticket
      expect(f).toContain("#1002"); // Ava's ticket, with her $20 tip in the total
      expect(f).toContain("$110.00");
      as("provider");
      const p = await render(pages.sales, {}, { tab: "all" });
      expect(p).toContain("#1001");
      expect(p).not.toContain("#1002");
      expect(p).not.toContain("$110.00");
      expect(p).toContain("Start sale");
    });
    it("a role that sees every ticket but takes no payments gets the list without Start sale; nobody else opens it", async () => {
      as("manager", { permissions: only("sales.view.all") });
      const m = await render(pages.sales, {}, { tab: "all" });
      expect(m).toContain("#1002");
      expect(m).not.toContain("Start sale");
      as("manager", { permissions: only("reports.view") });
      expect(await denied(pages.sales)).toBe(true);
    });
  });

  describe("products and gift cards", () => {
    it("prices show to everyone with the menu, stock counts to the desk and up, the export only with costs", async () => {
      as("manager");
      const m = await render(pages.products);
      expect(m).toContain("$24.00");
      expect(m).toContain("7 in stock");
      expect(m).toContain("Export");
      as("front_desk");
      const f = await render(pages.products);
      expect(f).toContain("$24.00");
      expect(f).toContain("7 in stock");
      expect(f).not.toContain("Export");
      as("provider");
      const p = await render(pages.products);
      expect(p).toContain("Shampoo");
      expect(p).toContain("$24.00");
      expect(p).not.toContain("in stock");
      expect(p).not.toContain("Export");
      as("provider", { permissions: only("catalog.view") });
      const bare = await render(pages.products);
      expect(bare).toContain("Shampoo");
      expect(bare).not.toContain("$24.00");
    });
    it("gift cards: the desk looks up balances with masked codes, the manager sees codes, a provider is refused", async () => {
      as("manager");
      expect(await render(pages.giftCards)).toContain("GC-TEST-9Q2M");
      as("front_desk");
      const f = await render(pages.giftCards);
      expect(f).toContain("••••9Q2M");
      expect(f).not.toContain("GC-TEST-9Q2M");
      expect(f).toContain("$50.00");
      as("provider");
      expect(await denied(pages.giftCards)).toBe(true);
    });
  });

  describe("cash drawer and closing report", () => {
    it("the desk and the manager open the drawer; a provider is refused", async () => {
      for (const role of ["front_desk", "manager", "owner"] as const) {
        as(role);
        expect(await render(pages.drawer), role).toContain("Open the drawer");
      }
      as("provider");
      expect(await denied(pages.drawer)).toBe(true);
    });
    it("history and the closing report need reports.view: the desk closes without them, the manager sees both", async () => {
      as("front_desk");
      const desk = await render(pages.drawer);
      expect(desk).not.toContain("Closing report");
      expect(await denied(pages.drawerHistory)).toBe(true);
      expect(await denied(pages.closing)).toBe(true);
      as("manager");
      expect(await render(pages.drawer)).toContain("Closing report");
      expect(await render(pages.drawerHistory)).toContain("Close-out history");
      const z = await render(pages.closing, {}, { location: ids.main });
      expect(z).toContain("Payments by method");
      expect(z).toContain("Cash");
    });
    it("reports.view alone sees the drawer page read-only, with no open form", async () => {
      as("front_desk", { permissions: only("reports.view") });
      const html = await render(pages.drawer);
      expect(html).toContain("No drawer is open");
      expect(html).not.toContain("Open the drawer");
    });
  });

  describe("phase 2: the own axes and self-service", () => {
    it("availability: an own-calendar role with it sees every column, colleagues' visits as nameless busy blocks", async () => {
      as("provider", { permissions: only("appointments.read.own", "appointments.read.availability", "catalog.prices", "clients.notes") });
      const mod = await import("@/app/api/mobile/agenda/route");
      const a = await (await mod.GET(req(`/api/mobile/agenda?slug=matrix&date=${instantToISODate(new Date(Date.now() - 86_400_000), "America/New_York")}`)))!.json();
      expect(a.staff.map((s: { id: string }) => s.id).sort()).toEqual([ids.jordan, ids.ava].sort());
      const mine = a.items.find((i: { staffId: string }) => i.staffId === ids.jordan);
      const hers = a.items.find((i: { staffId: string }) => i.staffId === ids.ava);
      expect(mine).toMatchObject({ clientName: "Jo Lee", priceCents: 9000, notes: "Visit note here" });
      expect(hers).toMatchObject({ serviceName: "Busy", clientName: null, clientId: null, priceCents: 0, notes: null, status: "busy" });
      expect(hers).not.toHaveProperty("clientPhone");
      expect(hers).not.toHaveProperty("clientTags");
    });
    it("my pay sheet: payroll.view.own alone shows the person's own row and no controls; payroll.manage shows everyone", async () => {
      const payroll = () => import("@/app/app/[slug]/payroll/page");
      as("provider", { permissions: only("appointments.read.own", "payroll.view.own") });
      const own = await render(payroll);
      expect(own).toContain("My pay");
      expect(own).toContain("Jordan");
      expect(own).not.toContain("Ava");
      expect(own).not.toContain("Finalize");
      expect(own).not.toContain("W-2 summary");
      expect(own).not.toContain("Finalized periods");
      as("manager");
      const all = await render(payroll);
      expect(all).toContain("Ava");
      expect(all).toContain("Jordan");
      expect(all).toContain("Finalize");
      as("provider");
      expect(await denied(payroll)).toBe(true);
    });
    it("self-service: staff.self.hours opens the person's own hours, not a colleague's; without it, nothing", async () => {
      const hours = () => import("@/app/app/[slug]/staff/[staffId]/hours/page");
      const services = () => import("@/app/app/[slug]/staff/[staffId]/services/page");
      as("provider", { permissions: only("appointments.read.own", "staff.directory", "staff.self.hours") });
      expect(await render(hours, { staffId: ids.jordan })).toContain("Save hours");
      expect(await denied(hours, { staffId: ids.ava })).toBe(true);
      expect(await denied(services, { staffId: ids.jordan })).toBe(true);
      as("provider");
      expect(await denied(hours, { staffId: ids.jordan })).toBe(true);
      as("manager");
      expect(await render(hours, { staffId: ids.ava })).toContain("Save hours");
    });
    it("reports: the per-staff table needs reports.staff", async () => {
      const reports = () => import("@/app/app/[slug]/reports/page");
      as("manager", { permissions: only("reports.view", "reports.staff") });
      expect(await render(reports)).toContain("Open in Payroll".replace("Open in Payroll", "Staff"));
      as("manager", { permissions: only("reports.view") });
      const html = await render(reports);
      expect(html).not.toContain("Service commission");
      expect(html).not.toMatch(/\bStaff\b/);
    });
  });

  describe("treatment charts", () => {
    const CHART = "Chart secret: eye sensitivity";
    it("a provider reads the charts of their own clients, and the view is in the activity log", async () => {
      as("provider");
      expect(await render(pages.client, { clientId: ids.client })).toContain("Charts");
      expect(await render(pages.clientCharts, { clientId: ids.client })).toContain("SOAP note");
      expect(await render(pages.chart, { noteId: ids.chart })).toContain(CHART);
      const logged = await withTenant(biz, (tx) => tx.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, ids.chart)));
      expect(logged.some((r) => r.action === "chart.view" && r.actorUserId === uid("jordan"))).toBe(true);
    });
    it("the manager and owner read every client's charts", async () => {
      for (const role of ["manager", "owner"] as const) {
        as(role);
        expect(await render(pages.chart, { noteId: ids.chart }), role).toContain(CHART);
      }
    });
    it("the front desk has no Charts tab and is refused the charts, though it reads notes", async () => {
      as("front_desk");
      const profile = await render(pages.client, { clientId: ids.client });
      expect(profile).toContain("allergic to latex");
      expect(profile).not.toContain("Charts");
      expect(await denied(pages.clientCharts, { clientId: ids.client })).toBe(true);
      expect(await denied(pages.chart, { noteId: ids.chart })).toBe(true);
    });
    it("own charts need the client to be theirs: a login with no staff member sees none", async () => {
      as("front_desk", { permissions: only("clients.read", "charts.read.own") });
      expect(await denied(pages.chart, { noteId: ids.chart })).toBe(true);
      expect(await denied(pages.clientCharts, { clientId: ids.client })).toBe(true);
    });
    it("the appointment shows its charts only to those who may read them", async () => {
      as("provider");
      expect(await render(pages.appointment, { id: ids.a1 })).toContain("SOAP note");
      as("front_desk");
      const desk = await render(pages.appointment, { id: ids.a1 });
      expect(desk).not.toContain("SOAP note");
      expect(desk).not.toContain("Chart this visit");
    });
  });

  describe("owner", () => {
    it("sees everything, as before", async () => {
      as("owner");
      expect(await render(pages.clients)).toContain(PHONE_SHOWN);
      expect(await render(pages.reviews)).toContain("Jo Lee");
      expect(await render(pages.giftCards)).toContain("GC-TEST-9Q2M");
      expect(await render(pages.time)).toContain("Ava shift");
      const products = await render(pages.products);
      expect(products).toContain("7 in stock");
      expect(products).toContain("Export");
    });
  });
});
