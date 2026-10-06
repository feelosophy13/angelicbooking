"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAction } from "@/lib/tenant";
import { setWaitlistStatus } from "@/server/public-booking";

export async function updateWaitlist(formData: FormData) {
  const d = z.object({ slug: z.string(), id: z.string().min(1), status: z.enum(["booked", "closed"]) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "appointments.write.any");
  await setWaitlistStatus(ctx.business.id, d.id, d.status);
  revalidatePath(`/app/${d.slug}/waitlist`);
}
