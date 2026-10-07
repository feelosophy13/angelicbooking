"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { normalizePhone } from "@angelic/core";
import { requireAction } from "@/lib/tenant";

const fields = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().max(60),
  email: z.string().trim().email().or(z.literal("")).transform((v) => v || null),
  phone: z.string().trim().max(30).transform((v) => (v ? (normalizePhone(v) ?? v) : null)),
  notes: z.string().trim().max(2000).transform((v) => v || null),
  smsOptIn: z.string().optional(),
  emailOptIn: z.string().optional(),
});

export async function createClient(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireAction(slug, "clients.write");
  const d = fields.parse(Object.fromEntries(formData));
  const [row] = await withTenant(ctx.business.id, (tx) =>
    tx
      .insert(schema.clients)
      .values({ businessId: ctx.business.id, firstName: d.firstName, lastName: d.lastName, email: d.email, phone: d.phone, notes: d.notes, smsOptIn: d.smsOptIn !== "off", emailOptIn: d.emailOptIn !== "off" })
      .returning({ id: schema.clients.id }),
  );
  revalidatePath(`/app/${slug}/clients`);
  redirect(`/app/${slug}/clients/${row!.id}`);
}

export async function updateClient(formData: FormData) {
  const slug = String(formData.get("slug"));
  const clientId = String(formData.get("clientId"));
  const ctx = await requireAction(slug, "clients.write");
  const d = fields.parse(Object.fromEntries(formData));
  await withTenant(ctx.business.id, (tx) =>
    tx
      .update(schema.clients)
      .set({ firstName: d.firstName, lastName: d.lastName, email: d.email, phone: d.phone, notes: d.notes, smsOptIn: d.smsOptIn === "on", emailOptIn: d.emailOptIn === "on" })
      .where(eq(schema.clients.id, clientId)),
  );
  revalidatePath(`/app/${slug}/clients`);
  revalidatePath(`/app/${slug}/clients/${clientId}`);
}
