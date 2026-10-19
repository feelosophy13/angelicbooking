"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAction } from "@/lib/tenant";
import { FormError, formAction } from "@/lib/form";
import { auditEvent, auditSettings } from "@/lib/audit";
import { checkDomain, connectDomain, DomainError, removeDomain } from "@/server/custom-domain";

const base = z.object({ slug: z.string() });

/** Save the address (replacing any old one) and register it with the hosting provider. */
export const saveDomain = formAction(base.extend({ customDomain: z.string().trim() }), async (d) => {
  const ctx = await requireAction(d.slug, "settings.business");
  if (!d.customDomain) throw new FormError("Enter an address, or use Remove to go back to the standard one.", "customDomain");
  try {
    const status = await connectDomain(ctx.business, d.customDomain);
    await auditEvent(ctx.business.id, ctx.user.id, "settings.domain_add", "business", ctx.business.id, { from: ctx.business.customDomain, to: d.customDomain, status });
    revalidatePath(`/app/${d.slug}/settings/domain`);
    return status === "active" ? "Your address is active" : "Address saved. Now add the DNS record below.";
  } catch (e) {
    if (e instanceof DomainError) throw new FormError(e.message, "customDomain");
    throw e;
  }
});

/** "Check now": ask the hosting provider whether the DNS record is in place yet. */
export const recheckDomain = formAction(base, async (d) => {
  const ctx = await requireAction(d.slug, "settings.business");
  const status = await checkDomain(ctx.business);
  revalidatePath(`/app/${d.slug}/settings/domain`);
  return status === "active" ? "Your address is active" : "Not active yet. See what's missing below.";
});

export const deleteDomain = formAction(base, async (d) => {
  const ctx = await requireAction(d.slug, "settings.business");
  await removeDomain(ctx.business);
  await auditEvent(ctx.business.id, ctx.user.id, "settings.domain_remove", "business", ctx.business.id, { domain: ctx.business.customDomain });
  revalidatePath(`/app/${d.slug}/settings/domain`);
  return "Custom address removed";
});
