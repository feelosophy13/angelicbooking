"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAction } from "@/lib/tenant";
import { f, formAction } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { LinkError, linkClients, unlinkClients } from "@/server/client-links";

// Linking people is editing clients: it changes who can book for whom online and where a child's reminders go.
export const linkClientAction = formAction(
  z.object({ slug: z.string(), clientId: f.id(), linkedClientId: z.string().min(1, "Pick a client to link"), relation: z.enum(["child", "parent", "partner", "other"]) }),
  async (d) => {
    const ctx = await requireAction(d.slug, "clients.write");
    await linkClients({ businessId: ctx.business.id, clientId: d.clientId, linkedClientId: d.linkedClientId, relation: d.relation, actorUserId: ctx.user.id });
    revalidatePath(`/app/${d.slug}/clients/${d.clientId}`);
    revalidatePath(`/app/${d.slug}/clients/${d.linkedClientId}`);
    return "Linked";
  },
  { knownErrors: [LinkError] },
);

export async function unlinkClientAction(formData: FormData) {
  const d = z.object({ slug: z.string(), clientId: z.string(), linkedClientId: z.string() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "clients.write");
  await unlinkClients({ businessId: ctx.business.id, clientId: d.clientId, linkedClientId: d.linkedClientId, actorUserId: ctx.user.id });
  await setFlash("Unlinked");
  revalidatePath(`/app/${d.slug}/clients/${d.clientId}`);
  revalidatePath(`/app/${d.slug}/clients/${d.linkedClientId}`);
}
