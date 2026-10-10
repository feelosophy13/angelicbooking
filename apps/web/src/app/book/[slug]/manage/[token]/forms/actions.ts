"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { getPublicBusiness } from "@/server/public-booking";
import { formsForManageToken, FormSubmitError, submitForm } from "@/server/forms";

export type FormState = { error?: string; ok?: boolean } | undefined;

export async function submitPublicForm(_prev: FormState, formData: FormData): Promise<FormState> {
  const d = z.object({ slug: z.string(), token: z.string().min(10), formId: z.string().min(1), signatureName: z.string().trim().max(120).optional() }).parse(Object.fromEntries(formData));
  const business = await getPublicBusiness(d.slug);
  if (!business) return { error: "Not available." };
  const m = await formsForManageToken(business.id, d.token);
  if (!m || !m.client) return { error: "Appointment not found." };
  const due = m.forms.find((f) => f.form.id === d.formId);
  if (!due) return { error: "This form isn't needed for your visit." };
  const answers: Record<string, string | boolean> = {};
  for (const f of due.form.fields) {
    if (f.type === "checkbox") answers[f.id] = formData.get(`a_${f.id}`) === "on";
    else if (f.type !== "statement") answers[f.id] = String(formData.get(`a_${f.id}`) ?? "");
  }
  const h = await headers();
  try {
    await submitForm({ businessId: business.id, formId: d.formId, clientId: m.client.id, appointmentId: m.appt.id, answers, signatureName: d.signatureName || null, ipAddress: (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || null });
  } catch (e) {
    if (e instanceof FormSubmitError) return { error: e.message };
    throw e;
  }
  return { ok: true };
}
