"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";

const createSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().max(60),
  email: z.string().trim().email().or(z.literal("")).transform((v) => v || null),
  phone: z.string().trim().max(30).transform((v) => v || null),
  notes: z.string().trim().max(2000).transform((v) => v || null),
});

export async function createClient(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireAction(slug, "clients.write");
  const d = createSchema.parse(Object.fromEntries(formData));
  await withTenant(ctx.business.id, (tx) => tx.insert(schema.clients).values({ businessId: ctx.business.id, ...d }));
  revalidatePath(`/app/${slug}/clients`);
}
