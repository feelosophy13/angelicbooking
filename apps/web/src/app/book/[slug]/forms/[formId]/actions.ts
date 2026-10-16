"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { getBusinessForLinks, findOrCreateClient } from "@/server/public-booking";
import { currentClient } from "@/server/client-auth";
import { answersFromFormData, FormSubmitError, getForm, submitForm } from "@/server/forms";
import { rateLimit } from "@/lib/rate-limit";
import { formIp } from "@/lib/rate-limit";

export type SharedFormState = { error?: string; field?: string | null; ok?: boolean } | undefined;

/**
 * A form reached from its shareable link (QR code at the desk, link on the website) rather
 * than from an appointment. The person identifies themselves (or is signed in as a client);
 * the submission lands on their client record like any other.
 */
export async function submitSharedForm(_prev: SharedFormState, formData: FormData): Promise<SharedFormState> {
  const d = z
    .object({
      slug: z.string(),
      formId: z.string().min(1),
      firstName: z.string().trim().max(80).optional(),
      lastName: z.string().trim().max(80).optional(),
      phone: z.string().trim().max(30).optional(),
      email: z.string().trim().max(120).optional(),
      signatureName: z.string().trim().max(120).optional(),
      signatureImage: z.string().optional(),
    })
    .parse(Object.fromEntries([...formData.entries()].filter(([, v]) => typeof v === "string")));
  const business = await getBusinessForLinks(d.slug);
  if (!business) return { error: "Not available." };
  const h = await headers();
  const ip = formIp(h);
  if (!rateLimit(`shared-form:${ip ?? "unknown"}`, 20, 10 * 60_000).ok) return { error: "Too many submissions. Please try again in a few minutes." };
  const form = await getForm(business.id, d.formId);
  if (!form || !form.active) return { error: "This form is no longer available." };

  let clientId: string;
  const me = business.clientAccountsEnabled ? await currentClient(business) : null;
  if (me) clientId = me.id;
  else {
    const firstName = d.firstName ?? "";
    const email = d.email?.toLowerCase() || null;
    const phone = d.phone || null;
    if (!firstName) return { error: "Please enter your first name." };
    if (!email && !phone) return { error: "Please enter a mobile number or email so we can match the form to your record." };
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Please enter a valid email." };
    clientId = await findOrCreateClient(business.id, { serviceId: "", staffId: "", startAt: new Date(), firstName, lastName: d.lastName ?? "", email, phone, notes: null });
  }
  const { answers, files } = answersFromFormData(form.fields, formData);
  try {
    await submitForm({ businessId: business.id, formId: form.id, clientId, appointmentId: null, answers, files, signatureName: d.signatureName || null, signatureImage: d.signatureImage || null, ipAddress: ip, trustedContact: Boolean(me) });
  } catch (e) {
    if (e instanceof FormSubmitError) return { error: e.message, field: e.field };
    throw e;
  }
  return { ok: true };
}
