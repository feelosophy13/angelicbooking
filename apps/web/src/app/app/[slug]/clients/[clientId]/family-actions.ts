"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAction } from "@/lib/tenant";
import { f, formAction } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { LinkError, linkClients, linkClientsTx, unlinkClients } from "@/server/client-links";
import { schema, withTenant } from "@angelic/db";
import { normalizePhone } from "@angelic/core";
import { FormError } from "@/lib/form";
import { isSmsSuppressed } from "@/server/consent";
import { likelyDuplicates } from "@/server/client-duplicates";
import { triggerWorkflows } from "@/server/workflows";

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

/**
 * Add a new client and link them in one step ("Add a family member"): a child or partner who isn't a client yet. Phone and email are
 * optional; a child without either gets their messages through this client. A same-name client already on file is offered first.
 */
export const addFamilyMemberAction = formAction(
  z.object({
    slug: z.string(),
    clientId: f.id(),
    firstName: z.string().trim().min(1, "First name is required").max(60),
    lastName: z.string().trim().max(60).default(""),
    relation: z.enum(["child", "parent", "partner", "other"]),
    phone: z.string().trim().max(30).default(""),
    email: z.string().trim().max(120).default(""),
    birthday: z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/, "Pick a date").default(""),
    addAnyway: z.string().optional(),
  }),
  async (d) => {
    const ctx = await requireAction(d.slug, "clients.write");
    const phone = d.phone ? normalizePhone(d.phone) : null;
    if (d.phone && !phone) throw new FormError("Enter a valid mobile number", "phone");
    const email = d.email ? d.email.toLowerCase() : null;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new FormError("Enter a valid email", "email");
    // Family often share a phone, so only a same-name match counts as "already a client".
    if (d.addAnyway !== "on") {
      const dupes = (await withTenant(ctx.business.id, (tx) => likelyDuplicates(tx, { firstName: d.firstName, lastName: d.lastName, phone, email }))).filter((m) => m.reasons.includes("name") && m.id !== d.clientId);
      if (dupes.length) throw new FormError(`${dupes.map((m) => `${m.firstName} ${m.lastName}`.trim()).join(", ")} is already a client. Use "Link someone" instead, or tick "Add as a new client anyway".`, "firstName");
    }
    const newId = await withTenant(ctx.business.id, async (tx) => {
      const [row] = await tx
        .insert(schema.clients)
        .values({ businessId: ctx.business.id, firstName: d.firstName, lastName: d.lastName, phone, email, birthday: d.birthday || null, smsOptIn: !!phone && !(await isSmsSuppressed(tx, phone)), emailOptIn: !!email })
        .returning({ id: schema.clients.id });
      await linkClientsTx(tx, ctx.business.id, d.clientId, row!.id, d.relation);
      await tx.insert(schema.auditLog).values({ businessId: ctx.business.id, actorUserId: ctx.user.id, action: "client.link", entity: "client", entityId: d.clientId, diff: JSON.stringify({ linkedClientId: row!.id, relation: d.relation, created: true }) });
      return row!.id;
    });
    await triggerWorkflows(ctx.business, "client_created", { clientId: newId, dedupeKey: newId, facts: { firstVisit: true, clientTags: [] }, context: { reason: "New client (family member)" } }).catch((e) => console.error("[workflows] client_created failed", (e as Error).message));
    revalidatePath(`/app/${d.slug}/clients/${d.clientId}`);
    revalidatePath(`/app/${d.slug}/clients`);
    return `${d.firstName} added and linked`;
  },
  { knownErrors: [LinkError] },
);
