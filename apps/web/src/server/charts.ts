import { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { assertChartEditable, ChartError, chartScope, cleanAddendum, firstMissing, starterChartTemplate, STARTER_CHART_TEMPLATES, type ChartAnswers, type ChartFieldDef, type StarterChartTemplate } from "@angelic/core";
import { schema, type TenantDb } from "@angelic/db";
import type { TenantContext } from "@/lib/tenant";

/**
 * Treatment charts (SOAP notes). Charts are clinical records: they are read and written only through these helpers, which check the
 * charts permissions (everyone's, or the clients the person has a visit with) on every call. Nothing here is reachable from the public
 * booking site or the API (a guard test checks the imports), and every chart opened is written to the activity log.
 */
export type ChartCtx = Pick<TenantContext, "permissions" | "staffId"> & { user: { id: string; name: string } };
export type ChartTemplateRow = typeof schema.chartTemplates.$inferSelect;
export type ChartNoteRow = typeof schema.chartNotes.$inferSelect;
export type ChartAddendumRow = typeof schema.chartAddenda.$inferSelect;
export const CHARTS_PAGE_SIZE = 25;

/** Whether this client is one of the person's own: they are (or were) booked on one of the client's visits. */
async function isOwnClient(tx: TenantDb, staffId: string | null | undefined, clientId: string): Promise<boolean> {
  if (!staffId) return false;
  const row = await tx
    .select({ id: schema.appointments.id })
    .from(schema.appointmentItems)
    .innerJoin(schema.appointments, eq(schema.appointments.id, schema.appointmentItems.appointmentId))
    .where(and(eq(schema.appointments.clientId, clientId), eq(schema.appointmentItems.staffId, staffId)))
    .limit(1);
  return row.length > 0;
}

/** May this person read (or write) this client's charts? "any" covers every client; "own" only clients they have a visit with. */
export async function canChartClient(tx: TenantDb, ctx: Pick<ChartCtx, "permissions" | "staffId">, clientId: string, mode: "read" | "write"): Promise<boolean> {
  const scope = chartScope(ctx.permissions, mode);
  if (scope === "any") return true;
  if (scope === "own") return isOwnClient(tx, ctx.staffId, clientId);
  return false;
}

/** A draft is changed (or signed, or thrown away) by the person who started it, or by someone who may chart any client. */
export function canEditDraft(ctx: Pick<ChartCtx, "permissions" | "user">, note: Pick<ChartNoteRow, "authorUserId" | "signedAt">): boolean {
  if (note.signedAt) return false;
  return chartScope(ctx.permissions, "write") === "any" || note.authorUserId === ctx.user.id;
}

export function listChartTemplates(tx: TenantDb, opts: { activeOnly?: boolean } = {}): Promise<ChartTemplateRow[]> {
  return tx.select().from(schema.chartTemplates).where(opts.activeOnly ? eq(schema.chartTemplates.active, true) : undefined).orderBy(desc(schema.chartTemplates.active), asc(schema.chartTemplates.name));
}

/** How many charts were started from each template, for the templates list and to keep used ones from being deleted. */
export async function chartCountsByTemplate(tx: TenantDb): Promise<Map<string, number>> {
  const rows = await tx.select({ id: schema.chartNotes.templateId, n: count() }).from(schema.chartNotes).where(isNotNull(schema.chartNotes.templateId)).groupBy(schema.chartNotes.templateId);
  return new Map(rows.map((r) => [r.id!, Number(r.n)]));
}

/** A template choice on the New chart page: one of the salon's, or a starter it hasn't added (used as is). */
export type ChartTemplateChoice = { value: string; name: string; description: string | null; fields: ChartFieldDef[]; templateId: string | null };
const fromRow = (t: ChartTemplateRow): ChartTemplateChoice => ({ value: t.id, name: t.name, description: t.description, fields: t.fields as ChartFieldDef[], templateId: t.id });
const fromStarter = (s: StarterChartTemplate): ChartTemplateChoice => ({ value: `starter:${s.key}`, name: s.name, description: null, fields: s.fields, templateId: null });

/**
 * What a new chart can be started from, and which one to open with: the template set on the service, else the salon's own template
 * made from the starter that suits the service's name, else that starter, else SOAP.
 */
export async function chartTemplateChoices(tx: TenantDb, service: { id: string; name: string } | null): Promise<{ choices: ChartTemplateChoice[]; preferred: string }> {
  const own = await listChartTemplates(tx, { activeOnly: true });
  const added = new Set(own.map((t) => t.starterKey).filter(Boolean));
  const choices = [...own.map(fromRow), ...STARTER_CHART_TEMPLATES.filter((s) => !added.has(s.key)).map(fromStarter)];
  const set = service ? own.find((t) => t.serviceIds.includes(service.id)) : undefined;
  const starter = service ? STARTER_CHART_TEMPLATES.find((s) => s.servicePattern?.test(service.name)) : undefined;
  const key = starter?.key ?? "soap";
  const preferred = set?.id ?? own.find((t) => t.starterKey === key)?.id ?? (added.has(key) ? choices[0]!.value : `starter:${key}`);
  return { choices, preferred };
}

export type ChartListFilters = { serviceId?: string | null; templateId?: string | null; staffId?: string | null; status?: "draft" | "signed" | null; page?: number };

/** A client's charts, newest first, filtered and paged. The caller has checked canChartClient(…, "read"). */
export async function listChartsForClient(tx: TenantDb, clientId: string, f: ChartListFilters = {}) {
  const where = and(
    eq(schema.chartNotes.clientId, clientId),
    f.serviceId ? eq(schema.chartNotes.serviceId, f.serviceId) : undefined,
    f.templateId ? eq(schema.chartNotes.templateId, f.templateId) : undefined,
    f.staffId ? eq(schema.chartNotes.staffId, f.staffId) : undefined,
    f.status === "draft" ? isNull(schema.chartNotes.signedAt) : f.status === "signed" ? isNotNull(schema.chartNotes.signedAt) : undefined,
  );
  const page = Math.max(1, f.page ?? 1);
  const rows = await tx
    .select({
      note: schema.chartNotes,
      staffName: schema.staff.displayName,
      visitAt: sql<Date | null>`(select min(ai.start_at) from appointment_items ai where ai.appointment_id = ${schema.chartNotes.appointmentId})`.mapWith((v) => (v ? new Date(v) : null)),
      addenda: sql<number>`(select count(*) from chart_addenda ca where ca.note_id = ${schema.chartNotes.id})`.mapWith(Number),
    })
    .from(schema.chartNotes)
    .leftJoin(schema.staff, eq(schema.staff.id, schema.chartNotes.staffId))
    .where(where)
    .orderBy(desc(schema.chartNotes.createdAt))
    .limit(CHARTS_PAGE_SIZE + 1)
    .offset((page - 1) * CHARTS_PAGE_SIZE);
  return { rows: rows.slice(0, CHARTS_PAGE_SIZE), hasMore: rows.length > CHARTS_PAGE_SIZE, page };
}

/** The services and providers that appear on a client's charts, for the filter bar. */
export async function chartFacets(tx: TenantDb, clientId: string) {
  const rows = await tx
    .selectDistinct({ serviceId: schema.chartNotes.serviceId, serviceName: schema.chartNotes.serviceName, staffId: schema.chartNotes.staffId, staffName: schema.staff.displayName, templateId: schema.chartNotes.templateId, templateName: sql<string>`${schema.chartNotes.templateSnapshot}->>'name'` })
    .from(schema.chartNotes)
    .leftJoin(schema.staff, eq(schema.staff.id, schema.chartNotes.staffId))
    .where(eq(schema.chartNotes.clientId, clientId));
  const uniq = <T extends { id: string; name: string }>(xs: T[]) => [...new Map(xs.map((x) => [x.id, x])).values()].sort((a, b) => a.name.localeCompare(b.name));
  return {
    services: uniq(rows.filter((r) => r.serviceId).map((r) => ({ id: r.serviceId!, name: r.serviceName ?? "Service" }))),
    staff: uniq(rows.filter((r) => r.staffId).map((r) => ({ id: r.staffId!, name: r.staffName ?? "Provider" }))),
    templates: uniq(rows.filter((r) => r.templateId).map((r) => ({ id: r.templateId!, name: r.templateName ?? "Chart" }))),
  };
}

/** The client's most recent signed chart for this service (the quick reference while charting), other than the one open. */
export async function lastChartForService(tx: TenantDb, clientId: string, serviceId: string | null, exceptId: string | null = null): Promise<ChartNoteRow | null> {
  if (!serviceId) return null;
  const [row] = await tx
    .select()
    .from(schema.chartNotes)
    .where(and(eq(schema.chartNotes.clientId, clientId), eq(schema.chartNotes.serviceId, serviceId), isNotNull(schema.chartNotes.signedAt), exceptId ? ne(schema.chartNotes.id, exceptId) : undefined))
    .orderBy(desc(schema.chartNotes.signedAt))
    .limit(1);
  return row ?? null;
}

export async function getChart(tx: TenantDb, noteId: string): Promise<{ note: ChartNoteRow; addenda: ChartAddendumRow[]; staffName: string | null } | null> {
  const [hit] = await tx.select({ note: schema.chartNotes, staffName: schema.staff.displayName }).from(schema.chartNotes).leftJoin(schema.staff, eq(schema.staff.id, schema.chartNotes.staffId)).where(eq(schema.chartNotes.id, noteId)).limit(1);
  if (!hit) return null;
  const addenda = await tx.select().from(schema.chartAddenda).where(eq(schema.chartAddenda.noteId, noteId)).orderBy(asc(schema.chartAddenda.createdAt));
  return { note: hit.note, addenda, staffName: hit.staffName };
}

/** Charts started on this visit, for the appointment page. */
export function chartsForAppointment(tx: TenantDb, appointmentId: string) {
  return tx.select().from(schema.chartNotes).where(eq(schema.chartNotes.appointmentId, appointmentId)).orderBy(asc(schema.chartNotes.createdAt));
}

/** The visit photos a chart may show: those of its own appointment. */
export async function chartPhotos(tx: TenantDb, appointmentId: string | null) {
  if (!appointmentId) return [];
  return tx
    .select({ id: schema.visitPhotos.id, fileId: schema.visitPhotos.fileId, thumbFileId: schema.visitPhotos.thumbFileId, phase: schema.visitPhotos.phase, serviceId: schema.visitPhotos.serviceId })
    .from(schema.visitPhotos)
    .where(eq(schema.visitPhotos.appointmentId, appointmentId))
    .orderBy(asc(schema.visitPhotos.takenAt));
}

/** The visit a chart is for: it must be this client's, and its service and provider must be on it. */
export async function chartVisit(tx: TenantDb, clientId: string, appointmentId: string | null, serviceId: string | null) {
  if (!appointmentId) return null;
  const appt = await tx.query.appointments.findFirst({ where: and(eq(schema.appointments.id, appointmentId), eq(schema.appointments.clientId, clientId)), columns: { id: true } });
  if (!appt) throw new ChartError("That visit isn't this client's.");
  const items = await tx
    .select({ serviceId: schema.appointmentItems.serviceId, serviceName: schema.appointmentItems.serviceName, staffId: schema.appointmentItems.staffId, startAt: schema.appointmentItems.startAt })
    .from(schema.appointmentItems)
    .where(eq(schema.appointmentItems.appointmentId, appointmentId))
    .orderBy(asc(schema.appointmentItems.sortOrder));
  const item = items.find((i) => i.serviceId === serviceId) ?? items[0] ?? null;
  return { id: appt.id, items, item };
}

export type NewChartInput = {
  clientId: string;
  appointmentId: string | null;
  serviceId: string | null;
  /** A template id, or `starter:<key>` for a starter the salon hasn't added. */
  template: string;
  answers: ChartAnswers;
  sign: boolean;
};

async function templateFor(tx: TenantDb, value: string): Promise<{ templateId: string | null; snapshot: { name: string; fields: ChartFieldDef[] } }> {
  if (value.startsWith("starter:")) {
    const s = starterChartTemplate(value.slice(8));
    if (!s) throw new ChartError("Choose a chart template.");
    return { templateId: null, snapshot: { name: s.name, fields: s.fields } };
  }
  const t = await tx.query.chartTemplates.findFirst({ where: eq(schema.chartTemplates.id, value) });
  if (!t) throw new ChartError("That chart template was removed. Choose another.");
  return { templateId: t.id, snapshot: { name: t.name, fields: t.fields as ChartFieldDef[] } };
}

function signature(ctx: ChartCtx, answers: ChartAnswers, fields: ChartFieldDef[], sign: boolean) {
  if (!sign) return {};
  const missing = firstMissing(fields, answers);
  // Shown under the field, and as "Please check: <label>: …" in the banner.
  if (missing) throw new ChartError("Needed before you sign. Save a draft to finish later.", missing.id);
  return { signedAt: new Date(), signedByUserId: ctx.user.id, signedByName: ctx.user.name };
}

/** The fields a chart was started on (its snapshot), for reading the posted answers before saving. */
export async function fieldsForNew(tx: TenantDb, template: string): Promise<ChartFieldDef[]> {
  return (await templateFor(tx, template)).snapshot.fields;
}

/** Start a chart (as a draft, or signed straight away). */
export async function createChart(tx: TenantDb, businessId: string, ctx: ChartCtx, input: NewChartInput): Promise<string> {
  if (!(await canChartClient(tx, ctx, input.clientId, "write"))) throw new ChartError("You can't chart this client.");
  const visit = await chartVisit(tx, input.clientId, input.appointmentId, input.serviceId);
  const { templateId, snapshot } = await templateFor(tx, input.template);
  const item = visit?.item ?? null;
  let serviceId = item?.serviceId ?? null;
  let serviceName = item?.serviceName?.replace(/ \(finish\)$/, "") ?? null;
  if (!visit && input.serviceId) {
    const svc = await tx.query.services.findFirst({ where: eq(schema.services.id, input.serviceId), columns: { id: true, name: true } });
    serviceId = svc?.id ?? null;
    serviceName = svc?.name ?? null;
  }
  // The chart is for the provider who did the work: the visit's, else the person charting when they are on staff.
  const staffId = item?.staffId ?? ctx.staffId ?? null;
  const [row] = await tx
    .insert(schema.chartNotes)
    .values({ businessId, clientId: input.clientId, appointmentId: visit?.id ?? null, serviceId, serviceName, staffId, templateId, templateSnapshot: snapshot, answers: input.answers, authorUserId: ctx.user.id, authorName: ctx.user.name, ...signature(ctx, input.answers, snapshot.fields, input.sign) })
    .returning({ id: schema.chartNotes.id });
  return row!.id;
}

/** Save a draft's answers, and sign it when asked. A signed chart is refused here and by the database. */
export async function saveChart(tx: TenantDb, ctx: ChartCtx, noteId: string, answers: ChartAnswers, sign: boolean): Promise<ChartNoteRow> {
  const note = await tx.query.chartNotes.findFirst({ where: eq(schema.chartNotes.id, noteId) });
  if (!note) throw new ChartError("This chart was deleted.");
  assertChartEditable(note);
  if (!(await canChartClient(tx, ctx, note.clientId, "write")) || !canEditDraft(ctx, note)) throw new ChartError("Only the person who started this draft can change it.");
  const [row] = await tx
    .update(schema.chartNotes)
    .set({ answers, updatedAt: new Date(), ...signature(ctx, answers, note.templateSnapshot.fields as ChartFieldDef[], sign) })
    .where(and(eq(schema.chartNotes.id, noteId), isNull(schema.chartNotes.signedAt)))
    .returning();
  if (!row) throw new ChartError("This chart was signed meanwhile, so it can't be changed. Add an addendum instead.");
  return row;
}

/** Add an addendum to a signed chart: anyone who may chart this client. */
export async function addAddendum(tx: TenantDb, businessId: string, ctx: ChartCtx, noteId: string, body: string): Promise<ChartNoteRow> {
  const note = await tx.query.chartNotes.findFirst({ where: eq(schema.chartNotes.id, noteId) });
  if (!note) throw new ChartError("This chart was deleted.");
  if (!note.signedAt) throw new ChartError("This chart is still a draft: change it directly, then sign it.");
  if (!(await canChartClient(tx, ctx, note.clientId, "write"))) throw new ChartError("You can't chart this client.");
  await tx.insert(schema.chartAddenda).values({ businessId, noteId, authorUserId: ctx.user.id, authorName: ctx.user.name, body: cleanAddendum(body) });
  return note;
}

/** Throw away a draft. Signed charts are never deleted (only with the client). */
export async function deleteDraft(tx: TenantDb, ctx: ChartCtx, noteId: string): Promise<ChartNoteRow> {
  const note = await tx.query.chartNotes.findFirst({ where: eq(schema.chartNotes.id, noteId) });
  if (!note) throw new ChartError("This chart was deleted.");
  if (note.signedAt) throw new ChartError("A signed chart can't be deleted.");
  if (!(await canChartClient(tx, ctx, note.clientId, "write")) || !canEditDraft(ctx, note)) throw new ChartError("Only the person who started this draft can delete it.");
  await tx.delete(schema.chartNotes).where(and(eq(schema.chartNotes.id, noteId), isNull(schema.chartNotes.signedAt)));
  return note;
}

/** Visit ids (of these) that have at least one chart, for marking visits in lists. */
export async function chartedAppointments(tx: TenantDb, appointmentIds: string[]): Promise<Set<string>> {
  if (!appointmentIds.length) return new Set();
  const rows = await tx.selectDistinct({ id: schema.chartNotes.appointmentId }).from(schema.chartNotes).where(inArray(schema.chartNotes.appointmentId, appointmentIds));
  return new Set(rows.map((r) => r.id!));
}
