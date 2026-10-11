/**
 * Intake and consent forms. A form applies to every visit or to specific
 * services; a client must have a current submission (signed once, or within
 * `renewDays`) before the visit. Clients fill forms from the link in their
 * confirmation / the manage page; staff can see and open submissions.
 */
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, schema, withJobs, withTenant, type FormAnswer, type FormFieldDef, type TenantDb } from "@angelic/db";
import { instantToISODate, normalizePhone, zonedToInstant } from "@angelic/core";
import { FileError, storeFormFile, storeSignaturePng } from "@/lib/files";
import { fieldVisible } from "@/lib/forms-logic";
import { shiftISODate } from "@/lib/utils";

export type Form = typeof schema.forms.$inferSelect;
export type FormSubmission = typeof schema.formSubmissions.$inferSelect;

export const FIELD_TYPES: { type: FormFieldDef["type"]; label: string }[] = [
  { type: "text", label: "Short answer" },
  { type: "textarea", label: "Paragraph" },
  { type: "number", label: "Number" },
  { type: "checkbox", label: "Checkbox (must tick)" },
  { type: "select", label: "Choose one" },
  { type: "multiselect", label: "Choose any" },
  { type: "date", label: "Date" },
  { type: "file", label: "Photo or PDF upload" },
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
  // Applies by service (or to every visit) and, when scoped, only at the visit's location.
  const required = all.filter((f) => (f.applyToAll || f.serviceIds.some((id) => serviceIds.includes(id))) && (!f.locationIds.length || (!!appt.locationId && f.locationIds.includes(appt.locationId))));
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

/** Pull answers out of a posted FormData (a_<fieldId> inputs, multiselect as repeated values, files as File). */
export function answersFromFormData(fields: FormFieldDef[], formData: FormData): { answers: Record<string, FormAnswer>; files: Record<string, File> } {
  const answers: Record<string, FormAnswer> = {};
  const files: Record<string, File> = {};
  for (const f of fields) {
    const name = `a_${f.id}`;
    if (f.type === "statement") continue;
    if (f.type === "checkbox") answers[f.id] = formData.get(name) === "on";
    else if (f.type === "multiselect") answers[f.id] = formData.getAll(name).map(String).filter(Boolean);
    else if (f.type === "file") {
      const v = formData.get(name);
      if (v instanceof File && v.size > 0) files[f.id] = v;
      const keep = formData.get(`${name}_keep`);
      if (typeof keep === "string" && keep) answers[f.id] = keep; // re-use the previous upload
    } else answers[f.id] = String(formData.get(name) ?? "");
  }
  return { answers, files };
}

/** Validate answers against the form definition and store the signed submission. */
export async function submitForm(input: {
  businessId: string;
  formId: string;
  clientId: string;
  appointmentId: string | null;
  answers: Record<string, FormAnswer>;
  files?: Record<string, File>;
  signatureName: string | null;
  /** PNG data URL from the signature pad. */
  signatureImage?: string | null;
  ipAddress: string | null;
  assistedByUserId?: string | null;
}) {
  return withTenant(input.businessId, async (tx) => {
    const form = await tx.query.forms.findFirst({ where: and(eq(schema.forms.id, input.formId), eq(schema.forms.active, true)) });
    if (!form) throw new FormSubmitError("This form is no longer available.");
    const clean: Record<string, FormAnswer> = {};
    for (const f of form.fields) {
      if (f.type === "statement") continue;
      // Hidden by a condition: ignore whatever was posted and don't require it.
      if (!fieldVisible(f, { ...input.answers, ...clean })) continue;
      const v = input.answers[f.id];
      if (f.type === "checkbox") {
        if (f.required && v !== true) throw new FormSubmitError(`Please tick "${f.label}".`);
        clean[f.id] = v === true;
        continue;
      }
      if (f.type === "multiselect") {
        const picked = (Array.isArray(v) ? v : []).filter((x) => (f.options ?? []).includes(x));
        if (f.required && !picked.length) throw new FormSubmitError(`Pick at least one option for "${f.label}".`);
        clean[f.id] = picked;
        continue;
      }
      if (f.type === "file") {
        const file = input.files?.[f.id];
        const kept = typeof v === "string" && /^[0-9a-f-]{36}$/.test(v) ? v : "";
        if (file) {
          try {
            clean[f.id] = await storeFormFile(input.businessId, file);
          } catch (e) {
            if (e instanceof FileError) throw new FormSubmitError(`${f.label}: ${e.message}`);
            throw e;
          }
        } else if (kept) clean[f.id] = kept;
        else if (f.required) throw new FormSubmitError(`Please attach a file for "${f.label}".`);
        else clean[f.id] = "";
        continue;
      }
      const s = typeof v === "string" ? v.trim() : "";
      if (f.required && !s) throw new FormSubmitError(`"${f.label}" is required.`);
      if (f.type === "select" && s && !(f.options ?? []).includes(s)) throw new FormSubmitError(`Pick one of the options for "${f.label}".`);
      if (f.type === "number" && s && !Number.isFinite(Number(s))) throw new FormSubmitError(`"${f.label}" must be a number.`);
      if (s.length > 2000) throw new FormSubmitError(`"${f.label}" is too long.`);
      clean[f.id] = s;
    }
    if (form.requireSignature && !input.signatureName) throw new FormSubmitError("Type your full name to sign.");
    let signatureFileId: string | null = null;
    if (form.requireSignature && input.signatureImage) {
      try {
        signatureFileId = await storeSignaturePng(input.businessId, input.signatureImage);
      } catch (e) {
        if (!(e instanceof FileError)) throw e; // a bad pad image never blocks a typed signature
      }
    }
    const [row] = await tx
      .insert(schema.formSubmissions)
      .values({
        businessId: input.businessId,
        formId: form.id,
        clientId: input.clientId,
        appointmentId: input.appointmentId,
        answers: clean,
        signatureName: input.signatureName,
        signatureFileId,
        signedAt: input.signatureName ? new Date() : null,
        ipAddress: input.ipAddress,
        assistedByUserId: input.assistedByUserId ?? null,
        formSnapshot: { name: form.name, fields: form.fields, description: form.description },
      })
      .returning();
    return row!;
  });
}

/** The client's most recent answers to a form (any age), used to prefill the next one. */
export async function latestAnswers(tx: TenantDb, clientId: string, formId: string): Promise<Record<string, FormAnswer> | null> {
  const row = await tx.query.formSubmissions.findFirst({ where: and(eq(schema.formSubmissions.clientId, clientId), eq(schema.formSubmissions.formId, formId)), orderBy: desc(schema.formSubmissions.createdAt) });
  return row?.answers ?? null;
}

/** Appointment ids (from the given set) that still have a required form outstanding. */
export async function appointmentsMissingForms(tx: TenantDb, appointmentIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!appointmentIds.length) return out;
  const all = await tx.select().from(schema.forms).where(eq(schema.forms.active, true));
  if (!all.length) return out;
  const appts = await tx.select({ id: schema.appointments.id, clientId: schema.appointments.clientId, locationId: schema.appointments.locationId, status: schema.appointments.status }).from(schema.appointments).where(inArray(schema.appointments.id, appointmentIds));
  const items = await tx.select({ appointmentId: schema.appointmentItems.appointmentId, serviceId: schema.appointmentItems.serviceId }).from(schema.appointmentItems).where(and(inArray(schema.appointmentItems.appointmentId, appointmentIds), sql`${schema.appointmentItems.status} <> 'cancelled'`));
  const clientIds = [...new Set(appts.map((a) => a.clientId).filter((x): x is string => !!x))];
  const subs = clientIds.length ? await tx.select({ clientId: schema.formSubmissions.clientId, formId: schema.formSubmissions.formId, createdAt: schema.formSubmissions.createdAt }).from(schema.formSubmissions).where(inArray(schema.formSubmissions.clientId, clientIds)).orderBy(desc(schema.formSubmissions.createdAt)) : [];
  const now = Date.now();
  for (const a of appts) {
    // Walk-ins without a client record have nobody to sign; they are handled at the desk.
    if (!a.clientId || a.status === "cancelled" || a.status === "no_show" || a.status === "completed") continue;
    const serviceIds = items.filter((i) => i.appointmentId === a.id).map((i) => i.serviceId);
    const required = all.filter((f) => (f.applyToAll || f.serviceIds.some((id) => serviceIds.includes(id))) && (!f.locationIds.length || (!!a.locationId && f.locationIds.includes(a.locationId))));
    for (const form of required) {
      const latest = a.clientId ? subs.find((s) => s.clientId === a.clientId && s.formId === form.id) : null;
      const current = !!latest && (!form.renewDays || now - latest.createdAt.getTime() < form.renewDays * 86_400_000);
      if (!current) {
        out.add(a.id);
        break;
      }
    }
  }
  return out;
}

/**
 * Morning-of nudge: for every business with forms, find today's visits (local
 * date) still missing a form and queue one text/email per appointment. Runs
 * from the jobs route; idempotent via the forms_nudge template per appointment.
 */
export async function queueFormsNudges(now = new Date()): Promise<{ businesses: number; queued: number }> {
  const { appointmentContext } = await import("@/lib/notify");
  const { templates } = await import("@/lib/notify/templates");
  const { smsBody, smsWithStopNotice } = await import("@/lib/notify/sms");
  const withForms = await withJobs((tx) => tx.selectDistinct({ businessId: schema.forms.businessId }).from(schema.forms).where(eq(schema.forms.active, true)));
  let queued = 0;
  for (const { businessId } of withForms) {
    const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, businessId) });
    if (!business) continue;
    const today = instantToISODate(now, business.timezone);
    // Only between 08:00 local and the end of the day, for visits at least an hour away.
    if (now < zonedToInstant(today, "08:00", business.timezone)) continue;
    const dayEnd = zonedToInstant(shiftISODate(today, 1), "00:00", business.timezone);
    const soon = new Date(now.getTime() + 60 * 60_000);
    const targets = await withTenant(businessId, async (tx) => {
      const rows = await tx
        .select({ id: schema.appointments.id })
        .from(schema.appointments)
        .innerJoin(schema.appointmentItems, and(eq(schema.appointmentItems.appointmentId, schema.appointments.id), eq(schema.appointmentItems.sortOrder, 0)))
        .where(and(gte(schema.appointmentItems.startAt, soon), lt(schema.appointmentItems.startAt, dayEnd), inArray(schema.appointments.status, ["booked", "confirmed"])));
      const ids = rows.map((r) => r.id);
      if (!ids.length) return [];
      const missing = await appointmentsMissingForms(tx, ids);
      if (!missing.size) return [];
      const already = await tx.select({ appointmentId: schema.notifications.appointmentId }).from(schema.notifications).where(and(inArray(schema.notifications.appointmentId, [...missing]), eq(schema.notifications.template, "forms_nudge")));
      const done = new Set(already.map((a) => a.appointmentId));
      const out: { id: string }[] = [];
      for (const id of missing) {
        if (done.has(id)) continue;
        const built = await appointmentContext(tx, business, id);
        if (!built?.client || !built.ctx.formsUrl) continue;
        const { client, ctx } = built;
        const phone = normalizePhone(client.phone);
        const t = templates.formsNudge(ctx);
        // Queued, not sent here: the jobs run delivers due rows right after this step.
        const base = { businessId, clientId: client.id, appointmentId: id, locationId: built.appt.locationId, template: "forms_nudge" as const };
        if (client.emailOptIn && client.email) {
          await tx.insert(schema.notifications).values({ ...base, channel: "email", recipient: client.email, subject: t.subject, body: t.html });
          out.push({ id });
        }
        if (client.smsOptIn && phone) {
          await tx.insert(schema.notifications).values({ ...base, channel: "sms", recipient: phone, body: await smsWithStopNotice(tx, client, smsBody(business, "forms_nudge", ctx)) });
          out.push({ id });
        }
      }
      return out;
    });
    queued += targets.length;
  }
  return { businesses: withForms.length, queued };
}

/** One CSV row per submission with a column per question (by the form's current field list). */
export async function submissionsCsv(businessId: string, formId: string): Promise<{ form: Form; headers: string[]; rows: (string | number | null)[][] } | null> {
  return withTenant(businessId, async (tx) => {
    const form = await tx.query.forms.findFirst({ where: eq(schema.forms.id, formId) });
    if (!form) return null;
    const subs = await tx
      .select({ s: schema.formSubmissions, first: schema.clients.firstName, last: schema.clients.lastName, email: schema.clients.email, phone: schema.clients.phone })
      .from(schema.formSubmissions)
      .innerJoin(schema.clients, eq(schema.clients.id, schema.formSubmissions.clientId))
      .where(eq(schema.formSubmissions.formId, formId))
      .orderBy(desc(schema.formSubmissions.createdAt));
    const qs = form.fields.filter((f) => f.type !== "statement");
    const headers = ["Submitted", "Client", "Email", "Phone", "Signed as", "Assisted", ...qs.map((q) => q.label)];
    const rows = subs.map(({ s: sub, first, last, email, phone }) => [
      sub.createdAt.toISOString(),
      `${first} ${last}`.trim(),
      email,
      phone,
      sub.signatureName,
      sub.assistedByUserId ? "staff" : "",
      ...qs.map((q) => {
        const v = sub.answers[q.id];
        if (q.type === "checkbox") return v === true ? "yes" : "no";
        if (Array.isArray(v)) return v.join("; ");
        return typeof v === "string" ? v : "";
      }),
    ]);
    return { form, headers, rows };
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
    const hit = row[0];
    if (!hit) return null;
    // The same client's previous copy of this form, so staff can see what changed.
    const previous = await tx.query.formSubmissions.findFirst({
      where: and(eq(schema.formSubmissions.clientId, hit.s.clientId), eq(schema.formSubmissions.formId, hit.s.formId), lt(schema.formSubmissions.createdAt, hit.s.createdAt)),
      orderBy: desc(schema.formSubmissions.createdAt),
    });
    const assistedBy = hit.s.assistedByUserId ? await db.query.user.findFirst({ where: eq(schema.user.id, hit.s.assistedByUserId), columns: { name: true } }) : null;
    return { ...hit, previous: previous ?? null, assistedByName: assistedBy?.name ?? null };
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
    if (type === "select" || type === "multiselect") def.options = (raw[`f${i}_options`] ?? "").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 30);
    const dep = (raw[`f${i}_showif_field`] ?? "").trim();
    const val = (raw[`f${i}_showif_value`] ?? "").trim();
    if (dep && val) def.showIf = { fieldId: dep, equals: val.slice(0, 200) };
    out.push(def);
  }
  // A condition may only point at an earlier question that exists.
  const seen = new Set<string>();
  for (const f of out) {
    if (f.showIf && !seen.has(f.showIf.fieldId)) delete f.showIf;
    seen.add(f.id);
  }
  return out;
}
