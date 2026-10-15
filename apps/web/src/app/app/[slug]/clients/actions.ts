"use server";
import { triggerWorkflows } from "@/server/workflows";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { normalizePhone } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { deleteFileByUrl, FileError, uploadedImageFrom } from "@/lib/files";

const fields = z.object({
  slug: z.string(),
  clientId: z.string().optional(),
  firstName: f.text(1, 60),
  lastName: z.string().trim().max(60).default(""),
  email: f.email(),
  phone: z.string().trim().max(30).transform((v) => (v ? (normalizePhone(v) ?? v) : null)),
  notes: f.optional(2000),
  birthday: z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/, "Pick a date").transform((v) => v || null).optional(),
  smsOptIn: f.checkbox(),
  emailOptIn: f.checkbox(),
  removePhoto: f.checkbox(),
});

async function photoOrFieldError(businessId: string, raw: FormData) {
  try {
    return await uploadedImageFrom(businessId, "client", raw, "photo");
  } catch (e) {
    if (e instanceof FileError) throw new FormError(e.message, "photo");
    throw e;
  }
}

export const createClient = formAction(fields, async (d, raw) => {
  const ctx = await requireAction(d.slug, "clients.write");
  if (d.phone && !normalizePhone(d.phone)) throw new FormError("Enter a valid mobile number", "phone");
  const photoUrl = await photoOrFieldError(ctx.business.id, raw);
  const [row] = await withTenant(ctx.business.id, (tx) =>
    tx
      .insert(schema.clients)
      .values({ businessId: ctx.business.id, firstName: d.firstName, lastName: d.lastName, email: d.email, phone: d.phone, notes: d.notes, birthday: d.birthday ?? null, photoUrl, smsOptIn: true, emailOptIn: true })
      .returning({ id: schema.clients.id }),
  );
  await triggerWorkflows(ctx.business, "client_created", { clientId: row!.id, dedupeKey: row!.id, facts: { firstVisit: true, clientTags: [] }, context: { reason: "New client (desk)" } });
  await setFlash(`${d.firstName} ${d.lastName}`.trim() + " added");
  revalidatePath(`/app/${d.slug}/clients`);
  redirect(`/app/${d.slug}/clients/${row!.id}`);
});

export const updateClient = formAction(fields, async (d, raw) => {
  const ctx = await requireAction(d.slug, "clients.write");
  if (d.phone && !normalizePhone(d.phone)) throw new FormError("Enter a valid mobile number", "phone");
  const uploaded = await photoOrFieldError(ctx.business.id, raw);
  const before = await withTenant(ctx.business.id, (tx) => tx.query.clients.findFirst({ where: eq(schema.clients.id, d.clientId ?? ""), columns: { photoUrl: true } }));
  const photo = uploaded ? { photoUrl: uploaded } : d.removePhoto ? { photoUrl: null } : {};
  await withTenant(ctx.business.id, (tx) =>
    tx
      .update(schema.clients)
      .set({ ...photo, firstName: d.firstName, lastName: d.lastName, email: d.email, phone: d.phone, notes: d.notes, birthday: d.birthday ?? null, smsOptIn: d.smsOptIn, emailOptIn: d.emailOptIn })
      .where(eq(schema.clients.id, d.clientId ?? "")),
  );
  if (before?.photoUrl && "photoUrl" in photo && before.photoUrl !== photo.photoUrl) await deleteFileByUrl(before.photoUrl);
  revalidatePath(`/app/${d.slug}/clients`);
  revalidatePath(`/app/${d.slug}/clients/${d.clientId}`);
  return "Client saved";
});

export type QuickClientResult = { id: string; name: string } | { error: string };

/** Inline "new client" from a picker (new appointment, sale): minimal fields, returns the row to select. */
export async function quickCreateClient(input: { slug: string; firstName: string; lastName: string; phone: string; email: string }): Promise<QuickClientResult> {
  const d = z
    .object({ slug: z.string(), firstName: z.string().trim().min(1, "First name is required").max(60), lastName: z.string().trim().max(60).default(""), phone: z.string().trim().max(30).default(""), email: z.string().trim().max(120).default("") })
    .safeParse(input);
  if (!d.success) return { error: d.error.issues[0]?.message ?? "Check the details" };
  const ctx = await requireAction(d.data.slug, "clients.write");
  const phone = d.data.phone ? normalizePhone(d.data.phone) : null;
  if (d.data.phone && !phone) return { error: "Enter a valid mobile number" };
  const email = d.data.email ? d.data.email.toLowerCase() : null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email" };
  const [row] = await withTenant(ctx.business.id, (tx) =>
    tx.insert(schema.clients).values({ businessId: ctx.business.id, firstName: d.data.firstName, lastName: d.data.lastName, phone, email, smsOptIn: true, emailOptIn: true }).returning({ id: schema.clients.id }),
  );
  await triggerWorkflows(ctx.business, "client_created", { clientId: row!.id, dedupeKey: row!.id, facts: { firstVisit: true, clientTags: [] }, context: { reason: "New client (desk)" } });
  revalidatePath(`/app/${d.data.slug}/clients`);
  return { id: row!.id, name: `${d.data.firstName} ${d.data.lastName}`.trim() };
}
