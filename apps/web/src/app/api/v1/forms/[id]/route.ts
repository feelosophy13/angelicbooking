import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, readBody, route } from "@/lib/api";
import { buildFields, checkFormScope, findFormApi, formPatch, serializeForm } from "@/server/api-v1-forms";

export const GET = route<{ id: string }>("forms:read", async (ctx, _req, { id }) => {
  const f = await findFormApi(ctx.business.id, id);
  return f ? NextResponse.json({ data: serializeForm(f) }) : ApiErrors.notFound("form");
});

/** PATCH /api/v1/forms/:id: send only what changes. Sending `fields` replaces the whole list of questions (keep a question's id to keep its meaning in old submissions). */
export const PATCH = route<{ id: string }>("forms:write", async (ctx, req, { id }) => {
  const body = await readBody(req, formPatch);
  if ("error" in body) return body.error;
  const d = body.data;
  const b = ctx.business.id;
  const existing = await findFormApi(b, id);
  if (!existing) return ApiErrors.notFound("form");
  let fields = existing.fields;
  if (d.fields) {
    const built = buildFields(d.fields);
    if ("error" in built) return ApiErrors.invalid(built.error);
    fields = built.fields;
  }
  const description = d.description === undefined ? existing.description : d.description || null;
  if (fields.length === 0 && !description) return ApiErrors.invalid("Add at least one question or some text to sign.");
  const out = await withTenant(b, async (tx) => {
    const scope = await checkFormScope(tx, b, { service_ids: d.service_ids, location_ids: d.location_ids });
    if ("missing" in scope) return scope;
    const [row] = await tx
      .update(schema.forms)
      .set({
        updatedAt: new Date(),
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.kind !== undefined ? { kind: d.kind } : {}),
        ...(d.description !== undefined ? { description } : {}),
        ...(d.fields !== undefined ? { fields } : {}),
        ...(d.require_signature !== undefined ? { requireSignature: d.require_signature } : {}),
        ...(d.apply_to_all !== undefined ? { applyToAll: d.apply_to_all } : {}),
        ...(scope.serviceIds !== undefined ? { serviceIds: scope.serviceIds } : {}),
        ...(d.renew_days !== undefined ? { renewDays: d.renew_days } : {}),
        ...(scope.locationIds !== undefined ? { locationIds: scope.locationIds } : {}),
        ...(d.active !== undefined ? { active: d.active } : {}),
      })
      .where(and(eq(schema.forms.id, id), eq(schema.forms.businessId, b)))
      .returning();
    return { row: row! };
  });
  if ("missing" in out) return ApiErrors.notFound(out.missing);
  await apiAudit(ctx, "api.form.update", "form", id, { fields: Object.keys(d) });
  return NextResponse.json({ data: serializeForm(out.row) });
});

/**
 * DELETE /api/v1/forms/:id: like the staff app, a form that clients have already submitted is archived (active=false) so the signed copies stay;
 * one nobody has submitted is deleted. The response says which (`deleted` or `archived`).
 */
export const DELETE = route<{ id: string }>("forms:write", async (ctx, _req, { id }) => {
  const b = ctx.business.id;
  const outcome = await withTenant(b, async (tx) => {
    const form = await tx.query.forms.findFirst({ where: and(eq(schema.forms.id, id), eq(schema.forms.businessId, b)), columns: { id: true } });
    if (!form) return null;
    const used = await tx.query.formSubmissions.findFirst({ where: and(eq(schema.formSubmissions.formId, id), eq(schema.formSubmissions.businessId, b)), columns: { id: true } });
    if (used) await tx.update(schema.forms).set({ active: false, updatedAt: new Date() }).where(and(eq(schema.forms.id, id), eq(schema.forms.businessId, b)));
    else await tx.delete(schema.forms).where(and(eq(schema.forms.id, id), eq(schema.forms.businessId, b)));
    return used ? ("archived" as const) : ("deleted" as const);
  });
  if (!outcome) return ApiErrors.notFound("form");
  await apiAudit(ctx, outcome === "archived" ? "api.form.archive" : "api.form.delete", "form", id);
  return NextResponse.json({ data: { id, deleted: outcome === "deleted", archived: outcome === "archived" } });
});
