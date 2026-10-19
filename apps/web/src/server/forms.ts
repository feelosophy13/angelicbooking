/**
 * Intake and consent forms. A form applies to every visit or to specific
 * services; a client must have a current submission (signed once, or within
 * `renewDays`) before the visit. Clients fill forms from the link in their
 * confirmation / the manage page; staff can see and open submissions.
 */
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema, withJobs, withTenant, type FormAnswer, type FormFieldDef, type TenantDb } from "@angelic/db";
import { instantToISODate, normalizePhone, zonedToInstant } from "@angelic/core";
import { FileError, storeFormFile, storeSignaturePng } from "@/lib/files";
import { DISPLAY_TYPES, FIELD_TYPES, answerText, fieldVisible } from "@/lib/forms-logic";
import { appUrl } from "@/lib/stripe";
export { FIELD_TYPES };
import { shiftISODate } from "@/lib/utils";
import { appointmentFacts, triggerWorkflows } from "@/server/workflows";

export type Form = typeof schema.forms.$inferSelect;
export type FormSubmission = typeof schema.formSubmissions.$inferSelect;

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
        .where(and(eq(schema.formSubmissions.clientId, appt.clientId), inArray(schema.formSubmissions.formId, required.map((f) => f.id)), isNull(schema.formSubmissions.voidedAt)))
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

export class FormSubmitError extends Error {
  /** The question the message is about, so the fill page can show it under that field. */
  field: string | null;
  constructor(message: string, field: string | null = null) {
    super(message);
    this.field = field;
  }
}

/** Pull answers out of a posted FormData (a_<fieldId> inputs, multiselect as repeated values, files as File). */
export function answersFromFormData(fields: FormFieldDef[], formData: FormData): { answers: Record<string, FormAnswer>; files: Record<string, File> } {
  const answers: Record<string, FormAnswer> = {};
  const files: Record<string, File> = {};
  for (const f of fields) {
    const name = `a_${f.id}`;
    if (DISPLAY_TYPES.includes(f.type)) continue;
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
export async function submitForm(input: Parameters<typeof submitFormTx>[0]) {
  const row = await submitFormTx(input);
  const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, input.businessId) });
  if (business) {
    const client = await withTenant(business.id, (tx) => tx.query.clients.findFirst({ where: eq(schema.clients.id, input.clientId), columns: { tags: true } }));
    const facts = input.appointmentId ? await withTenant(business.id, (tx) => appointmentFacts(tx, input.appointmentId!)) : null;
    await triggerWorkflows(business, "form_submitted", { clientId: input.clientId, appointmentId: input.appointmentId, dedupeKey: row.id, facts: { ...(facts ?? {}), clientTags: client?.tags ?? [] }, context: { formId: input.formId, appointmentId: input.appointmentId, reason: "Form submitted" } }).catch((e) => console.error("[workflows] form_submitted failed", (e as Error).message));
  }
  return row;
}

async function submitFormTx(input: {
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
  /**
   * Whoever filled it is known to be this client (staff at the desk, or a signed-in client), so mapped email/phone answers may replace
   * the record's. Otherwise (a manage link or an anonymous shared form) they only fill blanks: a form must never be a way to point
   * someone else's record at your own email and then sign in as them.
   */
  trustedContact?: boolean;
}) {
  return withTenant(input.businessId, async (tx) => {
    const form = await tx.query.forms.findFirst({ where: and(eq(schema.forms.id, input.formId), eq(schema.forms.active, true)) });
    if (!form) throw new FormSubmitError("This form is no longer available.");
    const clean: Record<string, FormAnswer> = {};
    for (const f of form.fields) {
      if (DISPLAY_TYPES.includes(f.type)) continue;
      // Hidden by a condition: ignore whatever was posted and don't require it.
      if (!fieldVisible(f, { ...input.answers, ...clean })) continue;
      const v = input.answers[f.id];
      if (f.type === "checkbox") {
        if (f.required && v !== true) throw new FormSubmitError("Please tick this box to continue.", f.id);
        clean[f.id] = v === true;
        continue;
      }
      if (f.type === "multiselect") {
        const picked = (Array.isArray(v) ? v : []).filter((x) => (f.options ?? []).includes(x));
        if (f.required && !picked.length) throw new FormSubmitError("Pick at least one.", f.id);
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
            if (e instanceof FileError) throw new FormSubmitError(e.message, f.id);
            throw e;
          }
        } else if (kept) clean[f.id] = kept;
        else if (f.required) throw new FormSubmitError("Please attach a file.", f.id);
        else clean[f.id] = "";
        continue;
      }
      const s = typeof v === "string" ? v.trim() : "";
      if (f.required && !s) throw new FormSubmitError(f.type === "initials" ? "Please initial here." : "This one is required.", f.id);
      if (f.type === "select" && s && !(f.options ?? []).includes(s)) throw new FormSubmitError("Pick one of the options.", f.id);
      if (f.type === "yesno" && s && s !== "Yes" && s !== "No") throw new FormSubmitError("Choose Yes or No.", f.id);
      if (f.type === "number" && s && !Number.isFinite(Number(s))) throw new FormSubmitError("Enter a number.", f.id);
      if (f.type === "email" && s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new FormSubmitError("Enter a valid email address.", f.id);
      if (f.type === "phone" && s && s.replace(/\D/g, "").length < 7) throw new FormSubmitError("Enter a valid phone number.", f.id);
      if (f.type === "initials" && s && !/^[A-Za-z.]{1,5}$/.test(s)) throw new FormSubmitError("Just your initials, e.g. JS.", f.id);
      if (s.length > 2000) throw new FormSubmitError("That answer is too long.", f.id);
      clean[f.id] = f.type === "initials" ? s.toUpperCase() : s;
    }
    if (form.requireSignature && !input.signatureName) throw new FormSubmitError("Type your full name to sign.", "signatureName");
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
    await applyAnswersToClient(tx, input.clientId, form, clean, Boolean(input.trustedContact || input.assistedByUserId));
    return row!;
  });
}

/** Copy mapped answers onto the client record: contact fields, notes and tags. */
async function applyAnswersToClient(tx: TenantDb, clientId: string, form: { name: string; fields: FormFieldDef[] }, answers: Record<string, FormAnswer>, trustedContact: boolean) {
  const mapped = form.fields.filter((f) => f.mapTo);
  if (!mapped.length) return;
  const client = await tx.query.clients.findFirst({ where: eq(schema.clients.id, clientId) });
  if (!client) return;
  const patch: Partial<typeof schema.clients.$inferInsert> = {};
  let tags = [...client.tags];
  const noteLines: string[] = [];
  for (const f of mapped) {
    const v = answers[f.id];
    if (v === undefined) continue;
    const text = answerText(f, v);
    if (f.mapTo === "email" && typeof v === "string" && v) {
      if (trustedContact || !client.email) patch.email = v.toLowerCase();
    } else if (f.mapTo === "phone" && typeof v === "string" && v) {
      if (trustedContact || !client.phone) patch.phone = normalizePhone(v) ?? v;
    }
    else if (f.mapTo === "birthday" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) patch.birthday = v;
    else if (f.mapTo === "tag") {
      const tag = (f.tag || f.label).trim().slice(0, 40);
      const on = v === true || v === "Yes";
      tags = on ? (tags.includes(tag) ? tags : [...tags, tag]) : tags.filter((t) => t !== tag);
    } else if (f.mapTo === "notes" && text) noteLines.push(`${f.label}: ${text}`);
  }
  if (tags.length !== client.tags.length || tags.some((t, i) => t !== client.tags[i])) patch.tags = tags;
  if (noteLines.length) {
    const stamp = new Date().toISOString().slice(0, 10);
    const block = `From ${form.name} (${stamp})\n${noteLines.join("\n")}`;
    // Replace an earlier block from the same form so repeat submissions don't pile up.
    const prior = (client.notes ?? "").split(/\n{2,}/).filter((b) => !b.startsWith(`From ${form.name} (`));
    patch.notes = [...prior, block].filter(Boolean).join("\n\n").slice(0, 8000);
  }
  if (Object.keys(patch).length) await tx.update(schema.clients).set(patch).where(eq(schema.clients.id, clientId));
}

/** The client's most recent answers to a form (any age), used to prefill the next one. */
export async function latestAnswers(tx: TenantDb, clientId: string, formId: string): Promise<Record<string, FormAnswer> | null> {
  const row = await tx.query.formSubmissions.findFirst({ where: and(eq(schema.formSubmissions.clientId, clientId), eq(schema.formSubmissions.formId, formId), isNull(schema.formSubmissions.voidedAt)), orderBy: desc(schema.formSubmissions.createdAt) });
  return row?.answers ?? null;
}

/** Defaults for a fill: the client's last answers, plus contact fields mapped from the client record when unanswered. */
export function prefillFor(form: { fields: FormFieldDef[] }, client: { email: string | null; phone: string | null; birthday: string | null } | null, latest: Record<string, FormAnswer> | null): Record<string, FormAnswer> | null {
  const out: Record<string, FormAnswer> = { ...(latest ?? {}) };
  for (const f of form.fields) {
    if (!f.mapTo || !client || (out[f.id] !== undefined && out[f.id] !== "")) continue;
    const v = f.mapTo === "email" ? client.email : f.mapTo === "phone" ? client.phone : f.mapTo === "birthday" ? client.birthday : null;
    if (v) out[f.id] = v;
  }
  return Object.keys(out).length ? out : null;
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
  const subs = clientIds.length ? await tx.select({ clientId: schema.formSubmissions.clientId, formId: schema.formSubmissions.formId, createdAt: schema.formSubmissions.createdAt }).from(schema.formSubmissions).where(and(inArray(schema.formSubmissions.clientId, clientIds), isNull(schema.formSubmissions.voidedAt))).orderBy(desc(schema.formSubmissions.createdAt)) : [];
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
    // Columns: the form's current questions, plus any question that only exists in an older signed copy.
    const qs: FormFieldDef[] = form.fields.filter((f) => !DISPLAY_TYPES.includes(f.type));
    for (const { s: sub } of subs) for (const f of sub.formSnapshot?.fields ?? []) if (!DISPLAY_TYPES.includes(f.type) && !qs.some((q) => q.id === f.id)) qs.push(f);
    const biz = await tx.query.businesses.findFirst({ where: eq(schema.businesses.id, businessId), columns: { timezone: true } });
    const fmt = new Intl.DateTimeFormat("en-CA", { dateStyle: "short", timeStyle: "short", timeZone: biz?.timezone ?? "UTC", hour12: false });
    const headers = ["Submitted", "Client", "Email", "Phone", "Signed as", "Assisted", "Voided", ...qs.map((q) => q.label)];
    const rows = subs.map(({ s: sub, first, last, email, phone }) => [
      fmt.format(sub.createdAt),
      `${first} ${last}`.trim(),
      email,
      phone,
      sub.signatureName,
      sub.assistedByUserId ? "staff" : "",
      sub.voidedAt ? `voided${sub.voidReason ? `: ${sub.voidReason}` : ""}` : "",
      ...qs.map((q) => {
        const v = sub.answers[q.id];
        if (q.type === "checkbox") return v === true ? "yes" : "no";
        if (q.type === "file") return typeof v === "string" && v ? appUrl(`/api/files/${v}`) : "";
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
    const assistedBy = hit.s.assistedByUserId ? await tx.query.user.findFirst({ where: eq(schema.user.id, hit.s.assistedByUserId), columns: { name: true } }) : null;
    return { ...hit, previous: previous ?? null, assistedByName: assistedBy?.name ?? null };
  });
}

/** Parse the builder's posted field rows into definitions (drops empty rows). */
export function parseFieldRows(raw: Record<string, string>): FormFieldDef[] {
  const out: FormFieldDef[] = [];
  for (let i = 0; i < 100; i++) {
    const label = (raw[`f${i}_label`] ?? "").trim();
    const type = raw[`f${i}_type`] as FormFieldDef["type"] | undefined;
    if (!label || !type || !FIELD_TYPES.some((t) => t.type === type)) continue;
    const id = (raw[`f${i}_id`] ?? "").trim() || `f_${Math.random().toString(36).slice(2, 8)}`;
    const def: FormFieldDef = { id, type, label: label.slice(0, 1000), required: DISPLAY_TYPES.includes(type) ? false : raw[`f${i}_required`] === "on" };
    if (type === "select" || type === "multiselect") def.options = (raw[`f${i}_options`] ?? "").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 30);
    const dep = (raw[`f${i}_showif_field`] ?? "").trim();
    const val = (raw[`f${i}_showif_value`] ?? "").trim();
    if (dep && val) def.showIf = { fieldId: dep, equals: val.slice(0, 200) };
    const mapTo = (raw[`f${i}_mapto`] ?? "").trim();
    if (mapTo === "email" || mapTo === "phone" || mapTo === "birthday" || mapTo === "notes" || mapTo === "tag") {
      def.mapTo = mapTo;
      if (mapTo === "tag") def.tag = (raw[`f${i}_tag`] ?? "").trim().slice(0, 40) || null;
    }
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

/** Make a copy of a form (inactive, so nothing is sent until it is reviewed). */
export async function duplicateForm(businessId: string, formId: string): Promise<string | null> {
  return withTenant(businessId, async (tx) => {
    const src = await tx.query.forms.findFirst({ where: eq(schema.forms.id, formId) });
    if (!src) return null;
    const [row] = await tx
      .insert(schema.forms)
      .values({ businessId, name: `Copy of ${src.name}`.slice(0, 120), kind: src.kind, description: src.description, fields: src.fields, requireSignature: src.requireSignature, applyToAll: src.applyToAll, serviceIds: src.serviceIds, renewDays: src.renewDays, locationIds: src.locationIds, active: false })
      .returning({ id: schema.forms.id });
    return row!.id;
  });
}

/** Void a submission: it stays on file, struck through, and no longer counts as signed. */
export async function voidSubmission(businessId: string, submissionId: string, reason: string | null, actorUserId: string) {
  await withTenant(businessId, async (tx) => {
    await tx.update(schema.formSubmissions).set({ voidedAt: new Date(), voidedByUserId: actorUserId, voidReason: reason }).where(and(eq(schema.formSubmissions.id, submissionId), isNull(schema.formSubmissions.voidedAt)));
    await tx.insert(schema.auditLog).values({ businessId, actorUserId, action: "form.void", entity: "form_submission", entityId: submissionId, diff: JSON.stringify({ reason }) });
  });
}

/** Move a submission filed under the wrong person to the right client. */
export async function reassignSubmission(businessId: string, submissionId: string, clientId: string, actorUserId: string) {
  await withTenant(businessId, async (tx) => {
    const target = await tx.query.clients.findFirst({ where: eq(schema.clients.id, clientId), columns: { id: true } });
    if (!target) throw new FormSubmitError("Client not found.");
    const before = await tx.query.formSubmissions.findFirst({ where: eq(schema.formSubmissions.id, submissionId), columns: { clientId: true } });
    await tx.update(schema.formSubmissions).set({ clientId, appointmentId: null }).where(eq(schema.formSubmissions.id, submissionId));
    await tx.insert(schema.auditLog).values({ businessId, actorUserId, action: "form.reassign", entity: "form_submission", entityId: submissionId, diff: JSON.stringify({ from: before?.clientId ?? null, to: clientId }) });
  });
}

/** Email the client a copy of their signed form. Returns false when they have no email. */
export async function emailSubmissionCopy(business: typeof schema.businesses.$inferSelect, submissionId: string): Promise<boolean> {
  const { queueOneOff } = await import("@/lib/notify");
  const row = await getSubmission(business.id, submissionId);
  if (!row || !row.client.email) return false;
  const form = row.s.formSnapshot ?? { name: row.form.name, fields: row.form.fields, description: row.form.description };
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "short", timeZone: business.timezone });
  const lines = form.fields
    .filter((f) => !DISPLAY_TYPES.includes(f.type))
    .map((f) => `<tr><td style="padding:4px 12px 4px 0;color:#57534e;vertical-align:top">${esc(f.label)}</td><td style="padding:4px 0"><b>${esc(f.type === "file" ? (row.s.answers[f.id] ? "attachment on file" : "") : answerText(f, row.s.answers[f.id]) || "—")}</b></td></tr>`)
    .join("");
  const signed = row.s.signatureName ? `<p>Signed <i>${esc(row.s.signatureName)}</i> on ${fmt.format(row.s.signedAt ?? row.s.createdAt)}.</p>` : `<p>Submitted ${fmt.format(row.s.createdAt)}.</p>`;
  const html = `<p>Hi ${esc(row.client.firstName)},</p><p>Here is your copy of <b>${esc(form.name)}</b> from ${esc(business.name)}.</p>${form.description ? `<p style="white-space:pre-line;color:#57534e">${esc(form.description)}</p>` : ""}<table>${lines}</table>${signed}`;
  await queueOneOff(business.id, { channel: "email", template: "form_copy", recipient: row.client.email, subject: `Your copy of ${form.name}`, body: html, clientId: row.client.id });
  return true;
}

/** Every submission in the business, newest first, with optional form and name filters. */
export async function listSubmissions(businessId: string, opts: { formId?: string | null; q?: string | null; limit?: number; offset?: number } = {}) {
  return withTenant(businessId, async (tx) => {
    const where = and(
      opts.formId ? eq(schema.formSubmissions.formId, opts.formId) : undefined,
      opts.q ? or(ilike(schema.clients.firstName, `%${opts.q}%`), ilike(schema.clients.lastName, `%${opts.q}%`), ilike(sql`${schema.clients.firstName} || ' ' || ${schema.clients.lastName}`, `%${opts.q}%`)) : undefined,
    );
    const rows = await tx
      .select({ id: schema.formSubmissions.id, createdAt: schema.formSubmissions.createdAt, signatureName: schema.formSubmissions.signatureName, assistedByUserId: schema.formSubmissions.assistedByUserId, voidedAt: schema.formSubmissions.voidedAt, formName: schema.forms.name, formId: schema.forms.id, clientId: schema.clients.id, firstName: schema.clients.firstName, lastName: schema.clients.lastName })
      .from(schema.formSubmissions)
      .innerJoin(schema.forms, eq(schema.forms.id, schema.formSubmissions.formId))
      .innerJoin(schema.clients, eq(schema.clients.id, schema.formSubmissions.clientId))
      .where(where)
      .orderBy(desc(schema.formSubmissions.createdAt))
      .limit(opts.limit ?? 50)
      .offset(opts.offset ?? 0);
    const [n] = await tx.select({ n: sql<number>`count(*)` }).from(schema.formSubmissions).innerJoin(schema.clients, eq(schema.clients.id, schema.formSubmissions.clientId)).where(where);
    return { rows, total: Number(n?.n ?? 0) };
  });
}

/** Upcoming visits (next `days`) whose client still owes a form, oldest visit first. */
/**
 * Upcoming visits still missing a required form. `scope.staffId` keeps only the visits that person is booked on (an own-calendar role's
 * view); `null` there means a login not linked to a staff member, which has none.
 */
export async function outstandingForms(business: typeof schema.businesses.$inferSelect, days = 7, scope?: { staffId: string | null }) {
  return withTenant(business.id, async (tx) => {
    const now = new Date();
    const until = new Date(now.getTime() + days * 86_400_000);
    const mine = scope ? (scope.staffId ? sql`exists (select 1 from appointment_items ai where ai.appointment_id = ${schema.appointments.id} and ai.staff_id = ${scope.staffId})` : sql`false`) : undefined;
    const rows = await tx
      .select({ id: schema.appointments.id, clientId: schema.appointments.clientId, startAt: schema.appointmentItems.startAt, serviceName: schema.appointmentItems.serviceName, firstName: schema.clients.firstName, lastName: schema.clients.lastName })
      .from(schema.appointments)
      .innerJoin(schema.appointmentItems, and(eq(schema.appointmentItems.appointmentId, schema.appointments.id), eq(schema.appointmentItems.sortOrder, 0)))
      .innerJoin(schema.clients, eq(schema.clients.id, schema.appointments.clientId))
      .where(and(gte(schema.appointmentItems.startAt, now), lt(schema.appointmentItems.startAt, until), inArray(schema.appointments.status, ["booked", "confirmed"]), mine))
      .orderBy(asc(schema.appointmentItems.startAt));
    if (!rows.length) return [];
    const missing = await appointmentsMissingForms(tx, rows.map((r) => r.id));
    const out: { appointmentId: string; clientId: string; clientName: string; startAt: Date; serviceName: string; forms: { id: string; name: string }[] }[] = [];
    for (const r of rows) {
      if (!missing.has(r.id)) continue;
      const due = (await formsForAppointment(tx, r.id)).filter((f) => !f.current).map((f) => ({ id: f.form.id, name: f.form.name }));
      if (due.length) out.push({ appointmentId: r.id, clientId: r.clientId!, clientName: `${r.firstName} ${r.lastName}`.trim(), startAt: r.startAt, serviceName: r.serviceName, forms: due });
    }
    return out;
  });
}
