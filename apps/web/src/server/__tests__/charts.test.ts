// Treatment charts against Postgres (the app role, RLS forced): starting a chart from a visit, the template the service sets, the signing
// lock (in the app and in the database), addenda that can't be changed, own clients versus everyone, and one business never seeing
// another's charts.
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { ChartError, DEFAULT_ROLE_PERMISSIONS, type Permissions } from "@angelic/core";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";
import { addAddendum, canChartClient, chartTemplateChoices, createChart, deleteDraft, getChart, lastChartForService, listChartsForClient, saveChart, type ChartCtx } from "@/server/charts";

const up = await reachable();

describe.skipIf(!up)("treatment charts", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  const ids = {} as Record<"jordan" | "ava" | "client" | "other" | "lash" | "facial" | "appt" | "template", string>;
  const users = {} as Record<"jordan" | "ava" | "boss", string>;
  let jordan: ChartCtx, ava: ChartCtx, boss: ChartCtx;
  const ctx = (who: keyof typeof users, staffId: string | null, permissions: Permissions): ChartCtx => ({ user: { id: users[who], name: who === "boss" ? "Olive Owner" : who === "ava" ? "Ava" : "Jordan" }, staffId, permissions });

  beforeAll(async () => {
    kit = await setupKit([]);
    for (const k of ["jordan", "ava", "boss"] as const) {
      users[k] = `${kit.A}_${k}`;
      await db.insert(schema.user).values({ id: users[k], name: k, email: `${users[k]}@example.test`, emailVerified: true });
    }
    await withTenant(kit.A, async (tx) => {
      const [j] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Jordan", userId: users.jordan }).returning();
      const [a] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Ava", userId: users.ava }).returning();
      ids.jordan = j!.id;
      ids.ava = a!.id;
      const [lash] = await tx.insert(schema.services).values({ businessId: kit.A, name: "Classic Lash Fill", durationMin: 60, priceCents: 8000 }).returning();
      const [facial] = await tx.insert(schema.services).values({ businessId: kit.A, name: "Signature Facial", durationMin: 60, priceCents: 12000 }).returning();
      ids.lash = lash!.id;
      ids.facial = facial!.id;
      const [c] = await tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Jo", lastName: "Lee" }).returning();
      const [o] = await tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Sam", lastName: "Other" }).returning();
      ids.client = c!.id;
      ids.other = o!.id;
      const [appt] = await tx.insert(schema.appointments).values({ businessId: kit.A, clientId: c!.id, status: "completed" }).returning();
      ids.appt = appt!.id;
      const start = new Date(Date.now() - 86_400_000);
      await tx.insert(schema.appointmentItems).values({ businessId: kit.A, appointmentId: appt!.id, staffId: j!.id, serviceId: lash!.id, serviceName: "Classic Lash Fill", startAt: start, endAt: new Date(start.getTime() + 3_600_000), priceCents: 8000, status: "completed" });
      // Sam is Ava's client, never Jordan's.
      const [appt2] = await tx.insert(schema.appointments).values({ businessId: kit.A, clientId: o!.id, status: "completed" }).returning();
      await tx.insert(schema.appointmentItems).values({ businessId: kit.A, appointmentId: appt2!.id, staffId: a!.id, serviceId: facial!.id, serviceName: "Signature Facial", startAt: start, endAt: new Date(start.getTime() + 3_600_000), priceCents: 12000, status: "completed" });
      const [t] = await tx.insert(schema.chartTemplates).values({ businessId: kit.A, name: "Our facial chart", serviceIds: [facial!.id], fields: [{ id: "notes", type: "textarea", label: "Notes", required: true }] }).returning();
      ids.template = t!.id;
    });
    jordan = ctx("jordan", ids.jordan, DEFAULT_ROLE_PERMISSIONS.provider);
    ava = ctx("ava", ids.ava, DEFAULT_ROLE_PERMISSIONS.provider);
    boss = ctx("boss", null, DEFAULT_ROLE_PERMISSIONS.manager);
  });
  afterAll(async () => {
    await kit.teardown();
    for (const k of Object.values(users)) await db.delete(schema.user).where(eq(schema.user.id, k));
  });
  const A = () => kit.A;
  const tx = <T,>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(A(), fn);

  it("opens on the template set on the service, else the starter that suits the service's name", async () => {
    expect((await tx((t) => chartTemplateChoices(t, { id: ids.facial, name: "Signature Facial" }))).preferred).toBe(ids.template);
    const lash = await tx((t) => chartTemplateChoices(t, { id: ids.lash, name: "Classic Lash Fill" }));
    expect(lash.preferred).toBe("starter:lash");
    expect(lash.choices.map((c) => c.value)).toContain("starter:soap");
    expect((await tx((t) => chartTemplateChoices(t, null))).preferred).toBe("starter:soap");
  });

  it("own clients: a provider charts the clients they have a visit with, not a colleague's", async () => {
    expect(await tx((t) => canChartClient(t, jordan, ids.client, "write"))).toBe(true);
    expect(await tx((t) => canChartClient(t, jordan, ids.other, "read"))).toBe(false);
    expect(await tx((t) => canChartClient(t, boss, ids.other, "read"))).toBe(true);
    expect(await tx((t) => canChartClient(t, ctx("boss", null, DEFAULT_ROLE_PERMISSIONS.front_desk), ids.client, "read"))).toBe(false);
    await expect(tx((t) => createChart(t, A(), jordan, { clientId: ids.other, appointmentId: null, serviceId: null, template: "starter:soap", answers: {}, sign: false }))).rejects.toThrow(ChartError);
  });

  let draftId = "";
  it("starts a draft from the visit: client, service, provider and a copy of the template", async () => {
    draftId = await tx((t) => createChart(t, A(), jordan, { clientId: ids.client, appointmentId: ids.appt, serviceId: ids.lash, template: "starter:lash", answers: { service: "Fill" }, sign: false }));
    const hit = (await tx((t) => getChart(t, draftId)))!;
    expect(hit.note).toMatchObject({ clientId: ids.client, appointmentId: ids.appt, serviceId: ids.lash, serviceName: "Classic Lash Fill", staffId: ids.jordan, authorName: "Jordan", signedAt: null });
    expect(hit.note.templateSnapshot.name).toBe("Lash service");
    expect(hit.staffName).toBe("Jordan");
  });

  it("a visit that isn't this client's is refused", async () => {
    await expect(tx((t) => createChart(t, A(), boss, { clientId: ids.other, appointmentId: ids.appt, serviceId: null, template: "starter:soap", answers: {}, sign: false }))).rejects.toThrow(/isn't this client's/);
  });

  it("only the author (or someone who charts everyone) changes a draft; signing needs the required fields", async () => {
    await expect(tx((t) => saveChart(t, ava, draftId, { service: "Fill" }, false))).rejects.toThrow(ChartError);
    await tx((t) => saveChart(t, jordan, draftId, { service: "Fill", notes: "Retention good" }, false));
    await expect(tx((t) => saveChart(t, jordan, draftId, { notes: "x" }, true))).rejects.toMatchObject({ field: "service", message: expect.stringMatching(/before you sign/) });
    const signed = await tx((t) => saveChart(t, jordan, draftId, { service: "Fill", reaction: "None", notes: "Retention good" }, true));
    expect(signed.signedAt).toBeInstanceOf(Date);
    expect(signed.signedByName).toBe("Jordan");
  });

  it("a signed chart is locked: the app refuses, and so does the database", async () => {
    await expect(tx((t) => saveChart(t, jordan, draftId, { service: "Removal" }, false))).rejects.toThrow(/signed/);
    await expect(tx((t) => saveChart(t, boss, draftId, { service: "Removal" }, false))).rejects.toThrow(/signed/);
    await expect(tx((t) => deleteDraft(t, boss, draftId))).rejects.toThrow(/can't be deleted/);
    // Straight to the table, past the app: the trigger refuses changes to what was recorded or to the signature.
    await expect(tx((t) => t.update(schema.chartNotes).set({ answers: { service: "Removal" } }).where(eq(schema.chartNotes.id, draftId)))).rejects.toThrow();
    await expect(tx((t) => t.update(schema.chartNotes).set({ signedAt: null }).where(eq(schema.chartNotes.id, draftId)))).rejects.toThrow();
    // Links may still go blank (a deleted visit), which isn't a change to the record.
    await tx((t) => t.update(schema.chartNotes).set({ templateId: null }).where(eq(schema.chartNotes.id, draftId)));
    expect((await tx((t) => getChart(t, draftId)))!.note.answers).toMatchObject({ service: "Fill" });
  });

  it("addenda: anyone who charts the client adds one; each keeps its author and time; none is ever changed", async () => {
    await tx((t) => addAddendum(t, A(), jordan, draftId, "  Client called day 2, all fine. "));
    await tx((t) => addAddendum(t, A(), boss, draftId, "Reviewed."));
    await expect(tx((t) => addAddendum(t, A(), ava, draftId, "Not my client"))).rejects.toThrow(ChartError);
    await expect(tx((t) => addAddendum(t, A(), jordan, draftId, "   "))).rejects.toThrow(ChartError);
    const { addenda } = (await tx((t) => getChart(t, draftId)))!;
    expect(addenda.map((a) => [a.authorName, a.body])).toEqual([["Jordan", "Client called day 2, all fine."], ["Olive Owner", "Reviewed."]]);
    expect(addenda[0]!.createdAt.getTime()).toBeLessThanOrEqual(addenda[1]!.createdAt.getTime());
    await expect(tx((t) => t.update(schema.chartAddenda).set({ body: "edited" }).where(eq(schema.chartAddenda.id, addenda[0]!.id)))).rejects.toThrow();
  });

  it("an addendum goes on a signed chart only; a draft is changed directly or deleted by its author", async () => {
    const id = await tx((t) => createChart(t, A(), jordan, { clientId: ids.client, appointmentId: ids.appt, serviceId: ids.lash, template: "starter:soap", answers: {}, sign: false }));
    await expect(tx((t) => addAddendum(t, A(), jordan, id, "early"))).rejects.toThrow(/draft/);
    await expect(tx((t) => deleteDraft(t, ava, id))).rejects.toThrow(ChartError);
    await tx((t) => deleteDraft(t, jordan, id));
    expect(await tx((t) => getChart(t, id))).toBeNull();
  });

  it("the history lists, filters, and finds the last signed chart for the same service", async () => {
    await tx((t) => createChart(t, A(), jordan, { clientId: ids.client, appointmentId: ids.appt, serviceId: ids.lash, template: "starter:soap", answers: {}, sign: false }));
    const all = await tx((t) => listChartsForClient(t, ids.client));
    expect(all.rows).toHaveLength(2);
    expect((await tx((t) => listChartsForClient(t, ids.client, { status: "signed" }))).rows.map((r) => r.note.id)).toEqual([draftId]);
    expect((await tx((t) => listChartsForClient(t, ids.client, { serviceId: ids.facial }))).rows).toHaveLength(0);
    expect((await tx((t) => listChartsForClient(t, ids.client, { status: "signed" }))).rows[0]!.addenda).toBe(2);
    expect((await tx((t) => lastChartForService(t, ids.client, ids.lash)))!.id).toBe(draftId);
    expect(await tx((t) => lastChartForService(t, ids.client, ids.lash, draftId))).toBeNull();
  });

  it("another business sees none of it", async () => {
    expect(await withTenant(kit.B, (t) => t.select().from(schema.chartNotes))).toHaveLength(0);
    expect(await withTenant(kit.B, (t) => t.select().from(schema.chartAddenda))).toHaveLength(0);
    expect(await withTenant(kit.B, (t) => getChart(t, draftId))).toBeNull();
  });
});
