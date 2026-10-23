"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { CheckinError, kioskCheckIn, kioskSubmitForm, kioskWalkIn, lookupCheckin, type CheckedIn, type Lookup } from "@/server/checkin-kiosk";
import { FormSubmitError } from "@/server/forms";
import { formIp } from "@/lib/rate-limit";
import type { FillState } from "@/components/form-fill";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof CheckinError) return { ok: false, error: e.message };
    throw e;
  }
}

const token = z.string().min(16).max(64);
const digits = z.string().max(20);

export async function findMyVisit(input: { token: string; phone: string }): Promise<Result<Lookup>> {
  const d = z.object({ token, phone: digits }).safeParse(input);
  if (!d.success) return { ok: false, error: "Please start again." };
  return run(() => lookupCheckin(d.data.token, d.data.phone));
}

export async function checkMeIn(input: { token: string; phone: string; appointmentId: string; skipForms?: boolean }): Promise<Result<CheckedIn>> {
  const d = z.object({ token, phone: digits, appointmentId: z.string().min(1).max(64), skipForms: z.boolean().optional() }).safeParse(input);
  if (!d.success) return { ok: false, error: "Please start again." };
  return run(() => kioskCheckIn(d.data.token, d.data.phone, d.data.appointmentId, { skipForms: d.data.skipForms }));
}

export async function joinAsWalkIn(input: { token: string; firstName: string; lastName: string; phone: string }): Promise<Result<{ firstName: string }>> {
  const d = z.object({ token, firstName: z.string().max(60), lastName: z.string().max(60), phone: digits }).safeParse(input);
  if (!d.success) return { ok: false, error: "Please check your name and number." };
  return run(() => kioskWalkIn(d.data.token, d.data));
}

/** One of the visit's due forms, posted by the shared form filler (hidden token, phone, appointment and form ids). */
export async function submitKioskForm(_prev: FillState, formData: FormData): Promise<FillState> {
  const str = (k: string) => (typeof formData.get(k) === "string" ? String(formData.get(k)) : "");
  try {
    await kioskSubmitForm(str("token"), str("phone"), str("appointmentId"), str("formId"), formData, formIp(await headers()));
  } catch (e) {
    if (e instanceof FormSubmitError) return { error: e.message, field: e.field };
    if (e instanceof CheckinError) return { error: e.message };
    throw e;
  }
  return { ok: true };
}
