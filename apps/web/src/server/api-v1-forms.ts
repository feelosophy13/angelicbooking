import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant, type FormFieldDef, type TenantDb } from "@angelic/db";
import { DISPLAY_TYPES, DRIVER_TYPES, FIELD_TYPES, mapTargetsFor } from "@/lib/forms-logic";

/**
 * Forms for the public REST API: the form builder (forms, their questions) and what clients submitted. Same rules as api-v1.ts: the business id
 * comes from the key, every query runs inside withTenant and names business_id explicitly, serializers are allow-lists. Filling a form in on a
 * client's behalf (which stores signatures and files) and emailing a copy are not here.
 */
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const id = z.string().min(1).max(100);

const TYPES = FIELD_TYPES.map((t) => t.type) as [FormFieldDef["type"], ...FormFieldDef["type"][]];
export const FORM_FIELD_TYPES = TYPES as readonly string[];

// ---- Questions ----
// No `.default()` anywhere: the patch schema is the create schema made partial, and a default would silently overwrite stored values.
export const fieldInput = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, "Use letters, digits, - and _ (up to 40)").optional(),
  type: z.enum(TYPES),
  label: z.string().trim().min(1).max(1000),
  required: z.boolean().optional(),
  options: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
  show_if: z.object({ field_id: z.string().min(1).max(40), equals: z.string().trim().min(1).max(200) }).strict().nullish(),
  map_to: z.enum(["email", "phone", "birthday", "notes", "tag"]).nullish(),
  tag: z.string().trim().max(40).nullish(),
}).strict();
type FieldInput = z.infer<typeof fieldInput>;

/**
 * Turn the request's questions into stored definitions with the builder's rules: statements and headings take no answer and are never required;
 * a choice needs options; "show only when" must point at an earlier question that can drive one (a tick box, yes/no or a choice); a question can be
 * copied to the client record only to a target that makes sense for its type. Returns the problem as text, for a 422.
 */
export function buildFields(inputs: FieldInput[]): { fields: FormFieldDef[] } | { error: string } {
  const out: FormFieldDef[] = [];
  const seen = new Map<string, FormFieldDef>();
  for (const [i, f] of inputs.entries()) {
    const where = `fields[${i}]`;
    const fid = f.id ?? `f_${Math.random().toString(36).slice(2, 8)}`;
    if (seen.has(fid)) return { error: `${where}: the id "${fid}" is used twice.` };
    const choice = f.type === "select" || f.type === "multiselect";
    if (choice && !f.options?.length) return { error: `${where}: a "${f.type}" question needs at least one option.` };
    if (!choice && f.options) return { error: `${where}: only select and multiselect questions take options.` };
    const def: FormFieldDef = { id: fid, type: f.type, label: f.label, required: DISPLAY_TYPES.includes(f.type) ? false : (f.required ?? false) };
    if (choice) def.options = f.options!;
    if (f.show_if) {
      const driver = seen.get(f.show_if.field_id);
      if (!driver) return { error: `${where}: show_if must name an earlier question (field_id "${f.show_if.field_id}" is not before it).` };
      if (!DRIVER_TYPES.includes(driver.type)) return { error: `${where}: show_if can only depend on a checkbox, yes/no, select or multiselect question.` };
      def.showIf = { fieldId: f.show_if.field_id, equals: f.show_if.equals };
    }
    if (f.map_to) {
      if (!mapTargetsFor(f.type).some((t) => t.value === f.map_to)) return { error: `${where}: a "${f.type}" question cannot be copied to the client's ${f.map_to}.` };
      def.mapTo = f.map_to;
      if (f.map_to === "tag") def.tag = f.tag || null;
    } else if (f.tag) return { error: `${where}: tag only applies when map_to is "tag".` };
    seen.set(fid, def);
    out.push(def);
  }
  return { fields: out };
}

export const serializeField = (f: FormFieldDef) => ({
  id: f.id, type: f.type, label: f.label, required: !!f.required, options: f.options ?? null,
  show_if: f.showIf ? { field_id: f.showIf.fieldId, equals: f.showIf.equals } : null, map_to: f.mapTo ?? null, tag: f.mapTo === "tag" ? (f.tag ?? null) : null,
});

// ---- Forms ----
export const formPatch = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["intake", "consent"]),
  description: z.string().trim().max(4000).nullable(),
  fields: z.array(fieldInput).max(100),
  require_signature: z.boolean(),
  apply_to_all: z.boolean(),
  service_ids: z.array(id).max(200),
  renew_days: z.number().int().min(1).max(3650).nullable(),
  location_ids: z.array(id).max(200),
  active: z.boolean(),
}).partial().strict();
export const formCreate = formPatch.required({ name: true, kind: true });
/** Create defaults, applied in the handler: signed copies are required unless the form says otherwise, and a form is live when created (like the staff app). */
export const FORM_DEFAULTS = { require_signature: true, apply_to_all: false, active: true } as const;

type FormRow = typeof schema.forms.$inferSelect;
export const serializeForm = (f: FormRow) => ({
  id: f.id, name: f.name, kind: f.kind, description: f.description, fields: f.fields.map(serializeField), require_signature: f.requireSignature,
  apply_to_all: f.applyToAll, service_ids: f.serviceIds, renew_days: f.renewDays, location_ids: f.locationIds, active: f.active,
  created_at: iso(f.createdAt), updated_at: iso(f.updatedAt),
});
/** The list leaves out the questions (a count instead); fetch one form for them. */
export const serializeFormSummary = (f: FormRow) => {
  const { fields: _fields, ...rest } = serializeForm(f);
  void _fields;
  return { ...rest, field_count: f.fields.length };
};

export async function findFormApi(businessId: string, formId: string) {
  return withTenant(businessId, (tx) => tx.query.forms.findFirst({ where: and(eq(schema.forms.id, formId), eq(schema.forms.businessId, businessId)) }));
}

/**
 * The service and location ids on a form are plain text arrays, so row-level security cannot vouch for them: prove each belongs to the business.
 * Locations are then stored the way the staff app does: naming none or all of them means "everywhere" (an empty list).
 */
export async function checkFormScope(tx: TenantDb, businessId: string, d: { service_ids?: string[]; location_ids?: string[] }): Promise<{ missing: string } | { locationIds?: string[]; serviceIds?: string[] }> {
  const serviceIds = d.service_ids ? [...new Set(d.service_ids)] : undefined;
  if (serviceIds?.length) {
    const rows = await tx.select({ id: schema.services.id }).from(schema.services).where(and(eq(schema.services.businessId, businessId), sql`${schema.services.id} in (${sql.join(serviceIds.map((s) => sql`${s}`), sql`, `)})`));
    if (rows.length !== serviceIds.length) return { missing: "service" };
  }
  if (!d.location_ids) return { serviceIds };
  const all = await tx.select({ id: schema.locations.id }).from(schema.locations).where(eq(schema.locations.businessId, businessId));
  const picked = [...new Set(d.location_ids)];
  if (picked.some((p) => !all.some((l) => l.id === p))) return { missing: "location" };
  return { serviceIds, locationIds: picked.length === 0 || picked.length >= all.length ? [] : picked };
}

// ---- Submissions ----
export const voidBody = z.object({ reason: z.string().trim().max(200).nullish() }).strict();
export const reassignBody = z.object({ client_id: id }).strict();

type SubmissionRow = typeof schema.formSubmissions.$inferSelect;
const signed = (s: SubmissionRow) => !!s.signatureName || !!s.signatureFileId;
const summary = (s: SubmissionRow, form: { id: string; name: string; kind: string }, client: { id: string; firstName: string; lastName: string }) => ({
  id: s.id, form_id: form.id, form_name: form.name, form_kind: form.kind, client_id: client.id, client_name: `${client.firstName} ${client.lastName}`.trim(), appointment_id: s.appointmentId,
  signed: signed(s), signature_name: s.signatureName, signed_at: iso(s.signedAt), assisted_by_staff: !!s.assistedByUserId, voided: !!s.voidedAt, created_at: iso(s.createdAt),
});

/** Newest first. `q` matches the client's name; `include_voided` defaults to true, like the staff app's list. */
export async function listSubmissionsApi(businessId: string, opts: { formId?: string; clientId?: string; q?: string; includeVoided: boolean; limit: number; offset: number }) {
  return withTenant(businessId, async (tx) => {
    const conds: (SQL | undefined)[] = [eq(schema.formSubmissions.businessId, businessId)];
    if (opts.formId) conds.push(eq(schema.formSubmissions.formId, opts.formId));
    if (opts.clientId) conds.push(eq(schema.formSubmissions.clientId, opts.clientId));
    if (!opts.includeVoided) conds.push(sql`${schema.formSubmissions.voidedAt} is null`);
    if (opts.q) {
      const like = `%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conds.push(or(ilike(schema.clients.firstName, like), ilike(schema.clients.lastName, like), ilike(sql`${schema.clients.firstName} || ' ' || ${schema.clients.lastName}`, like)));
    }
    const where = and(...conds);
    const base = tx.select({ s: schema.formSubmissions, form: { id: schema.forms.id, name: schema.forms.name, kind: schema.forms.kind }, client: { id: schema.clients.id, firstName: schema.clients.firstName, lastName: schema.clients.lastName } })
      .from(schema.formSubmissions)
      .innerJoin(schema.forms, eq(schema.forms.id, schema.formSubmissions.formId))
      .innerJoin(schema.clients, eq(schema.clients.id, schema.formSubmissions.clientId));
    const [rows, [n]] = await Promise.all([
      base.where(where).orderBy(desc(schema.formSubmissions.createdAt), desc(schema.formSubmissions.id)).limit(opts.limit).offset(opts.offset),
      tx.select({ n: sql<number>`count(*)` }).from(schema.formSubmissions).innerJoin(schema.clients, eq(schema.clients.id, schema.formSubmissions.clientId)).where(where),
    ]);
    return { rows: rows.map((r) => summary(r.s, r.form, r.client)), total: Number(n?.n ?? 0) };
  });
}

/** One submission with its answers, labelled from the form as it was when signed. Files and the drawn signature are never returned. */
export function serializeSubmission(row: { s: SubmissionRow; form: FormRow; client: typeof schema.clients.$inferSelect }) {
  const fields = (row.s.formSnapshot?.fields ?? row.form.fields).filter((f) => !DISPLAY_TYPES.includes(f.type));
  return {
    ...summary(row.s, row.form, row.client),
    void_reason: row.s.voidReason, voided_at: iso(row.s.voidedAt),
    answers: fields.map((f) => {
      const v = row.s.answers[f.id];
      return f.type === "file" ? { field_id: f.id, label: f.label, type: f.type, value: null, has_file: v !== undefined && v !== "" } : { field_id: f.id, label: f.label, type: f.type, value: v ?? null };
    }),
  };
}

/** The submission row, only when it belongs to the business. */
export async function findSubmissionApi(businessId: string, submissionId: string) {
  return withTenant(businessId, (tx) => tx.query.formSubmissions.findFirst({ where: and(eq(schema.formSubmissions.id, submissionId), eq(schema.formSubmissions.businessId, businessId)) }));
}
