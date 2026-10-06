"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { schema } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { setAppointmentStatus } from "@/server/booking";

const statusSchema = z.enum(schema.appointmentStatus.enumValues);

export async function updateAppointmentStatus(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireAction(slug, "appointments.write.any");
  const appointmentId = String(formData.get("appointmentId"));
  const status = statusSchema.parse(formData.get("status"));
  await setAppointmentStatus(ctx.business.id, appointmentId, status, ctx.user.id);
  revalidatePath(`/app/${slug}`);
}
