"use server";
import { z } from "zod";
import { getPublicBusiness } from "@/server/public-booking";
import { applyUnsubscribe } from "@/server/marketing";

export type UnsubscribeState = { ok?: boolean; error?: string } | undefined;

/** Applied only on an explicit confirm (POST): mail scanners and link previews fetch the GET. */
export async function unsubscribeAction(_prev: UnsubscribeState, formData: FormData): Promise<UnsubscribeState> {
  const d = z.object({ slug: z.string(), token: z.string().min(10) }).safeParse(Object.fromEntries(formData));
  if (!d.success) return { error: "That link isn't valid." };
  const business = await getPublicBusiness(d.data.slug);
  if (!business) return { error: "That link isn't valid." };
  const ok = await applyUnsubscribe(business, d.data.token);
  return ok ? { ok: true } : { error: "That link isn't valid." };
}
