"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { getPublicBusiness } from "@/server/public-booking";
import { answersFromFormData, formsForManageToken, FormSubmitError, submitForm } from "@/server/forms";

export type FormState = { error?: string; field?: string | null; ok?: boolean } | undefined;

export async function submitPublicForm(_prev: FormState, formData: FormData): Promise<FormState> {
  const d = z.object({ slug: z.string(), token: z.string().min(10), formId: z.string().min(1), signatureName: z.string().trim().max(120).optional(), signatureImage: z.string().optional() }).parse(Object.fromEntries([...formData.entries()].filter(([, v]) => typeof v === "string")));
  const business = await getPublicBusiness(d.slug);
  if (!business) return { error: "Not available." };
  const m = await formsForManageToken(business.id, d.token);
  if (!m || !m.client) return { error: "Appointment not found." };
  const due = m.forms.find((f) => f.form.id === d.formId);
  if (!due) return { error: "This form isn't needed for your visit." };
  const { answers, files } = answersFromFormData(due.form.fields, formData);
  const h = await headers();
  try {
    await submitForm({ businessId: business.id, formId: d.formId, clientId: m.client.id, appointmentId: m.appt.id, answers, files, signatureName: d.signatureName || null, signatureImage: d.signatureImage || null, ipAddress: (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || null });
  } catch (e) {
    if (e instanceof FormSubmitError) return { error: e.message, field: e.field };
    throw e;
  }
  return { ok: true };
}
