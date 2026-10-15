import { NextResponse } from "next/server";
import { asc, desc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, list, pageParams, probe, readBody, route } from "@/lib/api";
import { buildFields, checkFormScope, formCreate, FORM_DEFAULTS, serializeForm, serializeFormSummary } from "@/server/api-v1-forms";

/** GET /api/v1/forms: your intake and consent forms, live ones first (with a field_count; GET /forms/:id has the questions). */
export const GET = route("forms:read", async (ctx, req) => {
  const p = pageParams(new URL(req.url));
  const take = probe(p);
  const b = ctx.business.id;
  const rows = await withTenant(b, (tx) => tx.select().from(schema.forms).where(eq(schema.forms.businessId, b)).orderBy(desc(schema.forms.active), asc(schema.forms.name), asc(schema.forms.id)).limit(take.limit).offset(take.offset));
  return list(rows.map(serializeFormSummary), p);
});

/**
 * POST /api/v1/forms: create a form. Required: name, kind (intake or consent). Needs at least one question or some description text. Questions are
 * checked with the form builder's rules (see the docs). service_ids and location_ids must be yours; naming none or every location means everywhere.
 */
export const POST = route("forms:write", async (ctx, req) => {
  const body = await readBody(req, formCreate);
  if ("error" in body) return body.error;
  const d = { ...FORM_DEFAULTS, ...body.data };
  const built = buildFields(d.fields ?? []);
  if ("error" in built) return ApiErrors.invalid(built.error);
  const description = d.description || null;
  if (built.fields.length === 0 && !description) return ApiErrors.invalid("Add at least one question or some text to sign.");
  const b = ctx.business.id;
  const out = await withTenant(b, async (tx) => {
    const scope = await checkFormScope(tx, b, { service_ids: d.service_ids ?? [], location_ids: d.location_ids ?? [] });
    if ("missing" in scope) return scope;
    const [row] = await tx
      .insert(schema.forms)
      .values({ businessId: b, name: d.name, kind: d.kind, description, fields: built.fields, requireSignature: d.require_signature, applyToAll: d.apply_to_all, serviceIds: scope.serviceIds ?? [], renewDays: d.renew_days ?? null, locationIds: scope.locationIds ?? [], active: d.active })
      .returning();
    return { row: row! };
  });
  if ("missing" in out) return ApiErrors.notFound(out.missing);
  await apiAudit(ctx, "api.form.create", "form", out.row.id);
  return NextResponse.json({ data: serializeForm(out.row) }, { status: 201 });
});
