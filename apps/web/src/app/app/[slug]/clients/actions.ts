"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { normalizePhone } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";

const fields = z.object({
  slug: z.string(),
  clientId: z.string().optional(),
  firstName: f.text(1, 60),
  lastName: z.string().trim().max(60).default(""),
  email: f.email(),
  phone: z.string().trim().max(30).transform((v) => (v ? (normalizePhone(v) ?? v) : null)),
  notes: f.optional(2000),
  smsOptIn: f.checkbox(),
  emailOptIn: f.checkbox(),
});

export const createClient = formAction(fields, async (d) => {
  const ctx = await requireAction(d.slug, "clients.write");
  if (d.phone && !normalizePhone(d.phone)) throw new FormError("Enter a valid mobile number", "phone");
  const [row] = await withTenant(ctx.business.id, (tx) =>
    tx
      .insert(schema.clients)
      .values({ businessId: ctx.business.id, firstName: d.firstName, lastName: d.lastName, email: d.email, phone: d.phone, notes: d.notes, smsOptIn: true, emailOptIn: true })
      .returning({ id: schema.clients.id }),
  );
  await setFlash(`${d.firstName} ${d.lastName}`.trim() + " added");
  revalidatePath(`/app/${d.slug}/clients`);
  redirect(`/app/${d.slug}/clients/${row!.id}`);
});

export const updateClient = formAction(fields, async (d) => {
  const ctx = await requireAction(d.slug, "clients.write");
  if (d.phone && !normalizePhone(d.phone)) throw new FormError("Enter a valid mobile number", "phone");
  await withTenant(ctx.business.id, (tx) =>
    tx
      .update(schema.clients)
      .set({ firstName: d.firstName, lastName: d.lastName, email: d.email, phone: d.phone, notes: d.notes, smsOptIn: d.smsOptIn, emailOptIn: d.emailOptIn })
      .where(eq(schema.clients.id, d.clientId ?? "")),
  );
  revalidatePath(`/app/${d.slug}/clients`);
  revalidatePath(`/app/${d.slug}/clients/${d.clientId}`);
  return "Client saved";
});
