"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAction } from "@/lib/tenant";
import { f, formAction, FormError } from "@/lib/form";
import { sendStaffText } from "@/server/inbound";

export const replyToClient = formAction(z.object({ slug: z.string(), clientId: f.id(), body: f.text(1, 1000) }), async (d) => {
  const ctx = await requireAction(d.slug, "clients.write");
  try {
    await sendStaffText(ctx.business, d.clientId, d.body);
  } catch (e) {
    throw new FormError((e as Error).message, "body");
  }
  revalidatePath(`/app/${d.slug}/clients/${d.clientId}`);
  return "Text queued";
});
