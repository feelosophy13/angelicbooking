"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAction } from "@/lib/tenant";
import { resendNotification } from "@/lib/notify";
import { setFlash } from "@/lib/flash";

export async function resendMessage(formData: FormData) {
  const d = z.object({ slug: z.string(), id: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "business.manage");
  const r = await resendNotification(ctx.business.id, d.id);
  await setFlash(r.sent ? "Sent" : r.failed ? "Still failing; see the error on the row" : r.skipped ? "Skipped: see the reason on the row" : "Nothing to send", r.sent ? "success" : "error");
  revalidatePath(`/app/${d.slug}/messages`);
}
