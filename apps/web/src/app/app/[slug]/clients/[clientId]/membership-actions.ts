"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAction } from "@/lib/tenant";
import { setFlash } from "@/lib/flash";
import { disableAutoRenew, enableAutoRenew, freezeMembership, MembershipBillingError, resumeMembership } from "@/server/membership-billing";
import { zonedToInstant } from "@angelic/core";

export async function turnOnAutoRenew(formData: FormData) {
  const d = z.object({ slug: z.string(), clientId: z.string(), membershipId: z.string().min(1), paymentMethodId: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "checkout.take");
  try {
    await enableAutoRenew(ctx.business, d.membershipId, d.paymentMethodId, ctx.user.id);
    await setFlash("Auto-renew is on. The card is charged at the end of each period.");
  } catch (e) {
    if (e instanceof MembershipBillingError) await setFlash(e.message, "error");
    else await setFlash(`Stripe: ${(e as Error).message}`, "error");
  }
  revalidatePath(`/app/${d.slug}/clients/${d.clientId}`);
}

export async function turnOffAutoRenew(formData: FormData) {
  const d = z.object({ slug: z.string(), clientId: z.string(), membershipId: z.string().min(1), cancel: z.string().optional() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "checkout.take");
  try {
    await disableAutoRenew(ctx.business, d.membershipId, ctx.user.id, d.cancel === "1");
    await setFlash(d.cancel === "1" ? "Membership cancelled" : "Auto-renew turned off");
  } catch (e) {
    if (e instanceof MembershipBillingError) await setFlash(e.message, "error");
    else throw e;
  }
  revalidatePath(`/app/${d.slug}/clients/${d.clientId}`);
}

export async function freezeMembershipAction(formData: FormData) {
  const d = z.object({ slug: z.string(), clientId: z.string(), membershipId: z.string().min(1), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date") }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "checkout.take");
  try {
    // The freeze lifts at the start of that day, salon time.
    await freezeMembership(ctx.business, d.membershipId, zonedToInstant(d.until, "00:00", ctx.business.timezone), ctx.user.id);
    await setFlash("Membership frozen. No charges or credits until then; it resumes on its own.");
  } catch (e) {
    if (e instanceof MembershipBillingError) await setFlash(e.message, "error");
    else await setFlash(`Stripe: ${(e as Error).message}`, "error");
  }
  revalidatePath(`/app/${d.slug}/clients/${d.clientId}`);
}

export async function resumeMembershipAction(formData: FormData) {
  const d = z.object({ slug: z.string(), clientId: z.string(), membershipId: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "checkout.take");
  try {
    await resumeMembership(ctx.business, d.membershipId, ctx.user.id);
    await setFlash("Membership resumed");
  } catch (e) {
    if (e instanceof MembershipBillingError) await setFlash(e.message, "error");
    else await setFlash(`Stripe: ${(e as Error).message}`, "error");
  }
  revalidatePath(`/app/${d.slug}/clients/${d.clientId}`);
}
