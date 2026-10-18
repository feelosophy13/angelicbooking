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
import { isSmsSuppressed, smsMarketingConsent } from "@/server/consent";
import { likelyDuplicates, maskEmail, maskPhone } from "@/server/client-duplicates";

const fields = z.object({
  slug: z.string(),
  clientId: z.string().optional(),
  firstName: f.text(1, 60),
  lastName: z.string().trim().max(60).default(""),
  email: f.email(),
  phone: z.string().trim().max(30).transform((v) => (v ? (normalizePhone(v) ?? v) : null)),
  // Left out of the form (not sent at all) when the person may edit clients but not read notes: the stored notes then stay as they are.
  notes: z.string().trim().max(2000, "At most 2000 characters").optional().transform((v) => (v === undefined ? undefined : v || null)),
  birthday: z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/, "Pick a date").transform((v) => v || null).optional(),
  smsOptIn: f.checkbox(),
  emailOptIn: f.checkbox(),
  smsMarketingOptIn: f.checkbox(),
  emailMarketingOptIn: f.checkbox(),
  removePhoto: f.checkbox(),
  confirmDuplicate: z.string().optional(),
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
  // Someone already on file with the same phone, email or full name: show them first, and add a second record only when staff say so.
  if (d.confirmDuplicate !== "1") {
    const dupes = await withTenant(ctx.business.id, (tx) => likelyDuplicates(tx, { firstName: d.firstName, lastName: d.lastName, phone: d.phone, email: d.email }));
    if (dupes.length) {
      const why = { phone: "Same phone", email: "Same email", name: "Same name" } as const;
      throw new FormError(
        "This client may already be on file.",
        undefined,
        dupes.map((m) => ({
          href: `/app/${d.slug}/clients/${m.id}`,
          name: `${m.firstName} ${m.lastName}`.trim(),
          detail: [m.reasons.map((r) => why[r]).join(", "), maskPhone(m.phone), maskEmail(m.email)].filter(Boolean).join(" · "),
        })),
      );
    }
  }
  const photoUrl = await photoOrFieldError(ctx.business.id, raw);
  // Appointment texts and emails are on (they gave the number for their bookings) unless the number replied STOP; marketing texts need
  // their written consent, recorded on the client's page.
  const [row] = await withTenant(ctx.business.id, async (tx) =>
    tx
      .insert(schema.clients)
      .values({ businessId: ctx.business.id, firstName: d.firstName, lastName: d.lastName, email: d.email, phone: d.phone, notes: d.notes, birthday: d.birthday ?? null, photoUrl, smsOptIn: !(await isSmsSuppressed(tx, d.phone)), emailOptIn: true })
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
  await withTenant(ctx.business.id, async (tx) => {
    const cur = await tx.query.clients.findFirst({ where: eq(schema.clients.id, d.clientId ?? "") });
    if (!cur) throw new FormError("Client not found.");
    // A number that replied STOP stays off: only the person texting START turns it back on.
    const stopped = await isSmsSuppressed(tx, d.phone);
    const smsOptIn = stopped ? false : d.smsOptIn;
    const smsMarketing = stopped ? false : d.smsMarketingOptIn;
    const consent = smsMarketing === cur.smsMarketingOptIn ? {} : smsMarketingConsent(smsMarketing, `staff (${ctx.user.name || ctx.user.email})`);
    await tx
      .update(schema.clients)
      .set({ ...photo, firstName: d.firstName, lastName: d.lastName, email: d.email, phone: d.phone, ...(d.notes === undefined ? {} : { notes: d.notes }), birthday: d.birthday ?? null, smsOptIn, emailOptIn: d.emailOptIn, emailMarketingOptIn: d.emailMarketingOptIn, ...consent })
      .where(eq(schema.clients.id, cur.id));
    // Consent changes are evidence: who changed what, when.
    const changed = Object.fromEntries(
      (["smsOptIn", "emailOptIn", "smsMarketingOptIn", "emailMarketingOptIn"] as const)
        .map((k) => [k, cur[k], k === "smsOptIn" ? smsOptIn : k === "smsMarketingOptIn" ? smsMarketing : d[k]] as const)
        .filter(([, a, b]) => a !== b)
        .map(([k, a, b]) => [k, { from: a, to: b }]),
    );
    if (Object.keys(changed).length) await tx.insert(schema.auditLog).values({ businessId: ctx.business.id, actorUserId: ctx.user.id, action: "client.consent", entity: "client", entityId: cur.id, diff: JSON.stringify(changed) });
  });
  if (before?.photoUrl && "photoUrl" in photo && before.photoUrl !== photo.photoUrl) await deleteFileByUrl(before.photoUrl);
  revalidatePath(`/app/${d.slug}/clients`);
  revalidatePath(`/app/${d.slug}/clients/${d.clientId}`);
  return "Client saved";
});

export type QuickClientResult = { id: string; name: string } | { error: string } | { matches: { id: string; name: string; detail: string }[] };

/** Inline "new client" from a picker (new appointment, sale): minimal fields, returns the row to select. */
export async function quickCreateClient(input: { slug: string; firstName: string; lastName: string; phone: string; email: string; /** Staff saw the likely duplicates and want a new record anyway. */ confirmDuplicate?: boolean }): Promise<QuickClientResult> {
  const d = z
    .object({ slug: z.string(), firstName: z.string().trim().min(1, "First name is required").max(60), lastName: z.string().trim().max(60).default(""), phone: z.string().trim().max(30).default(""), email: z.string().trim().max(120).default("") })
    .safeParse(input);
  if (!d.success) return { error: d.error.issues[0]?.message ?? "Check the details" };
  const ctx = await requireAction(d.data.slug, "clients.write");
  const phone = d.data.phone ? normalizePhone(d.data.phone) : null;
  if (d.data.phone && !phone) return { error: "Enter a valid mobile number" };
  const email = d.data.email ? d.data.email.toLowerCase() : null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email" };
  // Same check as the New client page: offer the people already on file before adding another record.
  if (!input.confirmDuplicate) {
    const dupes = await withTenant(ctx.business.id, (tx) => likelyDuplicates(tx, { firstName: d.data.firstName, lastName: d.data.lastName, phone, email }));
    const why = { phone: "Same phone", email: "Same email", name: "Same name" } as const;
    if (dupes.length) return { matches: dupes.map((m) => ({ id: m.id, name: `${m.firstName} ${m.lastName}`.trim(), detail: [m.reasons.map((r) => why[r]).join(", "), maskPhone(m.phone), maskEmail(m.email)].filter(Boolean).join(" · ") })) };
  }
  const [row] = await withTenant(ctx.business.id, async (tx) =>
    tx.insert(schema.clients).values({ businessId: ctx.business.id, firstName: d.data.firstName, lastName: d.data.lastName, phone, email, smsOptIn: !(await isSmsSuppressed(tx, phone)), emailOptIn: true }).returning({ id: schema.clients.id }),
  );
  await triggerWorkflows(ctx.business, "client_created", { clientId: row!.id, dedupeKey: row!.id, facts: { firstVisit: true, clientTags: [] }, context: { reason: "New client (desk)" } });
  revalidatePath(`/app/${d.data.slug}/clients`);
  return { id: row!.id, name: `${d.data.firstName} ${d.data.lastName}`.trim() };
}
