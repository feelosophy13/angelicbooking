/**
 * Intake and consent forms. A form applies to every visit or to specific
 * services; a client must have a current submission (signed once, or within
 * `renewDays`) before the visit. Clients fill forms from the link in their
 * confirmation / the manage page; staff can see and open submissions.
 */
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { schema, withTenant, type FormFieldDef, type TenantDb } from "@angelic/db";

export type Form = typeof schema.forms.$inferSelect;
export type FormSubmission = typeof schema.formSubmissions.$inferSelect;

export const FIELD_TYPES: { type: FormFieldDef["type"]; label: string }[] = [
  { type: "text", label: "Short answer" },
  { type: "textarea", label: "Paragraph" },
  { type: "checkbox", label: "Checkbox (must tick)" },
  { type: "select", label: "Choose one" },
  { type: "date", label: "Date" },
  { type: "statement", label: "Statement (no answer)" },
];

export async function listForms(businessId: string) {
  return withTenant(businessId, (tx) => tx.select().from(schema.forms).orderBy(desc(schema.forms.active), asc(schema.forms.name)));
}

export async function getForm(businessId: string, formId: string) {
  return withTenant(businessId, (tx) => tx.query.forms.findFirst({ where: eq(schema.forms.id, formId) }));
}

/** Forms that must be on file for this appointment, with the client's current submission (if any). */
export async function formsForAppointment(tx: TenantDb, appointmentId: string) {
  const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, appointmentId) });
  if (!appt) return [];
  const items = await tx.select({ serviceId: schema.appointmentItems.serviceId }).from(schema.appointmentItems).where(and(eq(schema.appointmentItems.appointmentId, appointmentId), sql`${schema.appointmentItems.status} <> 'cancelled'`));
  const serviceIds = [...new Set(items.map((i) => i.serviceId).filter((x): x is string => !!x))];
  const all = await tx.select().from(schema.forms).where(eq(schema.forms.active, true)).orderBy(asc(schema.forms.name));
  const required = all.filter((f) => f.applyToAll || f.serviceIds.some((id) => serviceIds.includes(id)));
  if (!required.length) return [];
  const subs = appt.clientId
    ? await tx
        .select()
        .from(schema.formSubmissions)
        .where(and(eq(schema.formSubmissions.clientId, appt.clientId), inArray(schema.formSubmissions.formId, required.map((f) => f.id))))
        .orderBy(desc(schema.formSubmissions.createdAt))
    : [];
  const now = Date.now();
  return required.map((form) => {
    const latest = subs.find((s) => s.formId === form.id) ?? null;
    const current = !!latest && (!form.renewDays || now - latest.createdAt.getTime() < form.renewDays * 86_400_000);
    return { form, submission: latest, current };
  });
}

/** Same, by manage token, for the public page. */
export async function formsForManageToken(businessId: string, token: string) {
  return withTenant(businessId, async (tx) => {
    const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.manageToken, token) });
    if (!appt) return null;
    const client = appt.clientId ? await tx.query.clients.findFirst({ where: eq(schema.clients.id, appt.clientId) }) : null;
    return { appt, client, forms: await formsForAppointment(tx, appt.id) };
  });
}

export class FormSubmitError extends Error {}

/** Validate answers against the form definition and store the signed submission. */
export async function submitForm(input: { businessId: string; formId: string; clientId: string; appointmentId: string | null; answers: Record<string, string | boolean>; signatureName: string | null; ipAddress: string | null }) {
  return withTenant(input.businessId, async (tx) => {
    const form = await tx.query.forms.findFirst({ where: and(eq(schema.forms.id, input.formId), eq(schema.forms.active, true)) });
    if (!form) throw new FormSubmitError("This form is no longer available.");
    const clean: Record<string, string | boolean> = {};
    for (const f of form.fields) {
      if (f.type === "statement") continue;
      const v = input.answers[f.id];
      if (f.type === "checkbox") {
        if (f.required && v !== true) throw new FormSubmitError(`Please tick "${f.label}".`);
        clean[f.id] = v === true;
        continue;
      }
      const s = typeof v === "string" ? v.trim() : "";
      if (f.required && !s) throw new FormSubmitError(`"${f.label}" is required.`);
      if (f.type === "select" && s && !(f.options ?? []).includes(s)) throw new FormSubmitError(`Pick one of the options for "${f.label}".`);
      if (s.length > 2000) throw new FormSubmitError(`"${f.label}" is too long.`);
      clean[f.id] = s;
    }
    if (form.requireSignature && !input.signatureName) throw new FormSubmitError("Type your full name to sign.");
    const [row] = await tx
      .insert(schema.formSubmissions)
      .values({
        businessId: input.businessId,
        formId: form.id,
        clientId: input.clientId,
        appointmentId: input.appointmentId,
        answers: clean,
        signatureName: input.signatureName,
        signedAt: input.signatureName ? new Date() : null,
        ipAddress: input.ipAddress,
        formSnapshot: { name: form.name, fields: form.fields, description: form.description },
      })
      .returning();
    return row!;
  });
}

export async function listSubmissionsForClient(businessId: string, clientId: string) {
  return withTenant(businessId, (tx) =>
    tx
      .select({ s: schema.formSubmissions, formName: schema.forms.name, formKind: schema.forms.kind })
      .from(schema.formSubmissions)
      .innerJoin(schema.forms, eq(schema.forms.id, schema.formSubmissions.formId))
      .where(eq(schema.formSubmissions.clientId, clientId))
      .orderBy(desc(schema.formSubmissions.createdAt)),
  );
}

export async function getSubmission(businessId: string, submissionId: string) {
  return withTenant(businessId, async (tx) => {
    const row = await tx
      .select({ s: schema.formSubmissions, form: schema.forms, client: schema.clients })
      .from(schema.formSubmissions)
      .innerJoin(schema.forms, eq(schema.forms.id, schema.formSubmissions.formId))
      .innerJoin(schema.clients, eq(schema.clients.id, schema.formSubmissions.clientId))
      .where(eq(schema.formSubmissions.id, submissionId));
    return row[0] ?? null;
  });
}

/** Parse the builder's posted field rows into definitions (drops empty rows). */
export function parseFieldRows(raw: Record<string, string>): FormFieldDef[] {
  const out: FormFieldDef[] = [];
  for (let i = 0; i < 50; i++) {
    const label = (raw[`f${i}_label`] ?? "").trim();
    const type = raw[`f${i}_type`] as FormFieldDef["type"] | undefined;
    if (!label || !type || !FIELD_TYPES.some((t) => t.type === type)) continue;
    const id = (raw[`f${i}_id`] ?? "").trim() || `f_${Math.random().toString(36).slice(2, 8)}`;
    const def: FormFieldDef = { id, type, label: label.slice(0, 200), required: raw[`f${i}_required`] === "on" };
    if (type === "select") def.options = (raw[`f${i}_options`] ?? "").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 30);
    out.push(def);
  }
  return out;
}

// keep imports used
void isNull; void or;
