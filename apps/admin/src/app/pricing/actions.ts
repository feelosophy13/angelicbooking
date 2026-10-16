"use server";

import { revalidatePath } from "next/cache";
import { PRICE_FIELDS, type PriceBook } from "@angelic/core/platform-pricing";
import { requireAdmin } from "@/lib/admin";
import { readPrices } from "@/lib/price-form";
import { saveDefaultPriceBook, saveOverrides } from "@/lib/pricing";

export type FormState = { ok?: boolean; errors?: string[] } | null;

export async function saveDefaults(_prev: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const { values, errors } = readPrices(form, false);
  if (errors.length) return { errors };
  await saveDefaultPriceBook(values as PriceBook, admin.email);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function saveBusinessOverrides(businessId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const { values, errors } = readPrices(form, true);
  if (errors.length) return { errors };
  const note = String(form.get("note") ?? "").trim().slice(0, 500) || null;
  await saveOverrides(businessId, Object.fromEntries(PRICE_FIELDS.map((k) => [k, values[k] ?? null])), note, admin.email);
  revalidatePath("/", "layout");
  return { ok: true };
}
