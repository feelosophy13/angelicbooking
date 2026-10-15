import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";

/**
 * Client extras for the public REST API: pinning and deleting notes, the referral code, and a client's submitted forms.
 * Same rules as api-v1.ts: the business id comes from the key, every query runs inside withTenant and names business_id explicitly, and the
 * serializers are allow-lists. Money-like client changes (store credit, loyalty points) and anything that calls Stripe are not here.
 */
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Pin or unpin. No `.default()`: the only field is required, so there is nothing to re-apply. */
export const notePatch = z.object({ pinned: z.boolean() }).strict();

/** A client's form submissions as a summary. The answers (which can be health details) are only on GET /form-submissions/{id}, behind forms:read. */
export const serializeClientSubmission = (s: typeof schema.formSubmissions.$inferSelect, form: { name: string; kind: string }) => ({
  id: s.id, form_id: s.formId, form_name: form.name, form_kind: form.kind, appointment_id: s.appointmentId, signed: !!s.signatureName || !!s.signatureFileId,
  signed_at: iso(s.signedAt), voided: !!s.voidedAt, voided_at: iso(s.voidedAt), created_at: iso(s.createdAt),
});

export async function listClientSubmissionsApi(businessId: string, clientId: string, opts: { limit: number; offset: number }) {
  return withTenant(businessId, (tx) =>
    tx
      .select({ s: schema.formSubmissions, formName: schema.forms.name, formKind: schema.forms.kind })
      .from(schema.formSubmissions)
      .innerJoin(schema.forms, eq(schema.forms.id, schema.formSubmissions.formId))
      .where(and(eq(schema.formSubmissions.clientId, clientId), eq(schema.formSubmissions.businessId, businessId)))
      .orderBy(desc(schema.formSubmissions.createdAt), desc(schema.formSubmissions.id))
      .limit(opts.limit)
      .offset(opts.offset),
  );
}

/** One note, addressed through its client: a note id that belongs to another client (or business) is simply not found. */
export async function findNoteApi(businessId: string, clientId: string, noteId: string) {
  return withTenant(businessId, (tx) =>
    tx.query.clientNotes.findFirst({ where: and(eq(schema.clientNotes.id, noteId), eq(schema.clientNotes.clientId, clientId), eq(schema.clientNotes.businessId, businessId)) }),
  );
}
