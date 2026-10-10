"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { parseFieldRows } from "@/server/forms";

const fields = z.object({
  slug: z.string(),
  formId: z.string().optional(),
  name: f.text(1, 120),
  kind: z.enum(["intake", "consent"]),
  description: f.optional(4000),
  requireSignature: f.checkbox(),
  applyToAll: f.checkbox(),
  renewDays: z.string().trim().optional(),
  active: f.checkbox(),
});

function parse(d: z.infer<typeof fields>, raw: FormData) {
  const rawObj: Record<string, string> = {};
  for (const [k, v] of raw.entries()) if (typeof v === "string") rawObj[k] = v;
  const defs = parseFieldRows(rawObj);
  if (defs.length === 0 && !d.description) throw new FormError("Add at least one question or some text to sign.");
  const serviceIds = raw.getAll("serviceIds").map(String).filter(Boolean);
  const renewDays = d.renewDays ? Number(d.renewDays) : null;
  if (d.renewDays && (!Number.isInteger(renewDays) || renewDays! < 1)) throw new FormError("Enter a whole number of days", "renewDays");
  return { defs, serviceIds, renewDays };
}

export const createForm = formAction(fields, async (d, raw) => {
  const ctx = await requireAction(d.slug, "business.manage");
  const { defs, serviceIds, renewDays } = parse(d, raw);
  const [row] = await withTenant(ctx.business.id, (tx) =>
    tx.insert(schema.forms).values({ businessId: ctx.business.id, name: d.name, kind: d.kind, description: d.description, fields: defs, requireSignature: d.requireSignature, applyToAll: d.applyToAll, serviceIds, renewDays, active: true }).returning({ id: schema.forms.id }),
  );
  await setFlash(`${d.name} created`);
  revalidatePath(`/app/${d.slug}/settings/forms`);
  redirect(`/app/${d.slug}/settings/forms/${row!.id}`);
});

export const updateForm = formAction(fields, async (d, raw) => {
  const ctx = await requireAction(d.slug, "business.manage");
  const { defs, serviceIds, renewDays } = parse(d, raw);
  await withTenant(ctx.business.id, (tx) =>
    tx.update(schema.forms).set({ name: d.name, kind: d.kind, description: d.description, fields: defs, requireSignature: d.requireSignature, applyToAll: d.applyToAll, serviceIds, renewDays, active: d.active }).where(eq(schema.forms.id, d.formId ?? "")),
  );
  revalidatePath(`/app/${d.slug}/settings/forms`);
  revalidatePath(`/app/${d.slug}/settings/forms/${d.formId}`);
  return "Form saved";
});

export async function deleteForm(formData: FormData) {
  const d = z.object({ slug: z.string(), formId: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "business.manage");
  // Submissions reference the form; keep them by deactivating instead of deleting when any exist.
  const used = await withTenant(ctx.business.id, (tx) => tx.query.formSubmissions.findFirst({ where: eq(schema.formSubmissions.formId, d.formId) }));
  await withTenant(ctx.business.id, (tx) => (used ? tx.update(schema.forms).set({ active: false }).where(eq(schema.forms.id, d.formId)) : tx.delete(schema.forms).where(eq(schema.forms.id, d.formId))));
  await setFlash(used ? "Form archived (signed copies are kept)" : "Form deleted");
  revalidatePath(`/app/${d.slug}/settings/forms`);
  redirect(`/app/${d.slug}/settings/forms`);
}
