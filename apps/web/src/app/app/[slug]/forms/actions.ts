"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { requireAction } from "@/lib/tenant";
import { answersFromFormData, FormSubmitError, getForm, submitForm } from "@/server/forms";
import type { FillState } from "@/components/form-fill";
import { formIp } from "@/lib/rate-limit";

/** Front desk: a staff member completes a form with the client on the salon's device. */
export async function submitFormAsStaff(_prev: FillState, formData: FormData): Promise<FillState> {
  const d = z.object({ slug: z.string(), formId: z.string().min(1), clientId: z.string().min(1), appointmentId: z.string().optional(), signatureName: z.string().trim().max(120).optional(), signatureImage: z.string().optional() }).parse(Object.fromEntries([...formData.entries()].filter(([, v]) => typeof v === "string")));
  const ctx = await requireAction(d.slug, "clients.write");
  const form = await getForm(ctx.business.id, d.formId);
  if (!form || !form.active) return { error: "This form is no longer available." };
  const { answers, files } = answersFromFormData(form.fields, formData);
  const h = await headers();
  try {
    await submitForm({ businessId: ctx.business.id, formId: form.id, clientId: d.clientId, appointmentId: d.appointmentId || null, answers, files, signatureName: d.signatureName || null, signatureImage: d.signatureImage || null, ipAddress: formIp(h), assistedByUserId: ctx.user.id });
  } catch (e) {
    if (e instanceof FormSubmitError) return { error: e.message, field: e.field };
    throw e;
  }
  return { ok: true };
}
