"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { disconnectConnectAccount, startConnectOnboarding, syncConnectAccount } from "@/server/stripe-connect";
import { f, formAction, FormError } from "@/lib/form";
import { connectHelcim, disconnectHelcim, HelcimAccountError, helcimTokenOf, saveHelcimVerifier } from "@/server/helcim/account";
import { helcim } from "@/server/helcim/client";
import { auditEvent, auditSettings } from "@/lib/audit";
import { setFlash } from "@/lib/flash";

/** `locationId` in the form means "this location's own account"; absent means the business's main account. */
async function locationFrom(businessId: string, formData: FormData) {
  const id = formData.get("locationId");
  if (typeof id !== "string" || !id) return null;
  return (await withTenant(businessId, (tx) => tx.query.locations.findFirst({ where: eq(schema.locations.id, id) }))) ?? null;
}

export async function connectStripe(formData: FormData) {
  const slug = String(formData.get("slug"));
  const { business } = await requireAction(slug, "billing.manage");
  const location = await locationFrom(business.id, formData);
  const url = await startConnectOnboarding(business, slug, location);
  redirect(url);
}

export async function refreshStripe(formData: FormData) {
  const slug = String(formData.get("slug"));
  const { business } = await requireAction(slug, "billing.manage");
  const location = await locationFrom(business.id, formData);
  const accountId = location ? location.stripeAccountId : business.stripeAccountId;
  if (accountId) await syncConnectAccount(business.id, accountId);
  await setFlash("Stripe status refreshed");
  revalidatePath(`/app/${slug}/settings/payments`);
}

export async function disconnectStripe(formData: FormData) {
  const slug = String(formData.get("slug"));
  const { business, user } = await requireAction(slug, "billing.manage");
  const location = await locationFrom(business.id, formData);
  await disconnectConnectAccount(business.id, location?.id);
  await auditEvent(business.id, user.id, "settings.stripe_disconnect", location ? "location" : "business", location?.id ?? business.id);
  await setFlash(location ? `${location.name} now uses the main Stripe account` : "Stripe account disconnected");
  revalidatePath(`/app/${slug}/settings/payments`);
}

export const saveTax = formAction(z.object({ slug: z.string(), taxPct: f.num(0, 30) }), async (d) => {
  const { business, user } = await requireAction(d.slug, "billing.manage");
  await db.update(schema.businesses).set({ taxRateBps: Math.round(d.taxPct * 100) }).where(eq(schema.businesses.id, business.id));
  await auditSettings(business, user.id, "tax", { taxRateBps: Math.round(d.taxPct * 100) });
  revalidatePath(`/app/${d.slug}/settings/payments`);
  return "Tax rate saved";
});

export const saveReceiptFooter = formAction(z.object({ slug: z.string(), footer: z.string().max(400).optional() }), async (d) => {
  const { business, user } = await requireAction(d.slug, "billing.manage");
  await db.update(schema.businesses).set({ receiptFooter: d.footer?.trim() || null }).where(eq(schema.businesses.id, business.id));
  await auditSettings(business, user.id, "receipt", { receiptFooter: d.footer?.trim() || null });
  revalidatePath(`/app/${d.slug}/settings/payments`);
  return "Receipt footer saved";
});

// --- Helcim (HELCIM-PLAN-2026-10-20.md) -------------------------------------

export const connectHelcimAction = formAction(z.object({ slug: z.string(), apiToken: z.string().trim().min(1, "Paste your Helcim API token"), verifierToken: z.string().trim().optional() }), async (d) => {
  const { business, user } = await requireAction(d.slug, "billing.manage");
  try {
    await connectHelcim(business.id, { apiToken: d.apiToken, verifierToken: d.verifierToken ?? null });
  } catch (e) {
    if (e instanceof HelcimAccountError) throw new FormError(e.message, "apiToken");
    throw e;
  }
  await auditEvent(business.id, user.id, "settings.helcim_connect", "business", business.id);
  revalidatePath(`/app/${d.slug}`, "layout");
  return "Helcim connected: card payments now go through Helcim";
});

export const saveHelcimVerifierAction = formAction(z.object({ slug: z.string(), verifierToken: z.string().trim().min(1, "Paste the verifier token") }), async (d) => {
  const { business, user } = await requireAction(d.slug, "billing.manage");
  await saveHelcimVerifier(business.id, d.verifierToken);
  await auditEvent(business.id, user.id, "settings.helcim_webhook", "business", business.id);
  revalidatePath(`/app/${d.slug}/settings/payments`);
  return "Webhook verifier saved";
});

export async function disconnectHelcimAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const { business, user } = await requireAction(slug, "billing.manage");
  await disconnectHelcim(business.id);
  await auditEvent(business.id, user.id, "settings.helcim_disconnect", "business", business.id);
  await setFlash("Helcim disconnected: card payments use Stripe again");
  revalidatePath(`/app/${slug}`, "layout");
}

export const addHelcimDevice = formAction(
  z.object({ slug: z.string(), code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4}$/, "The four-character code on the terminal's screen"), name: z.string().trim().min(1, "Name it, e.g. Front desk").max(60), locationId: z.string().optional() }),
  async (d) => {
    const { business, user } = await requireAction(d.slug, "billing.manage");
    const token = helcimTokenOf(business);
    if (!token) throw new FormError("Connect Helcim first.", "code");
    // The code must belong to this merchant's Helcim account: Helcim lists the account's registered devices.
    const devices = await helcim.listDevices(token).catch(() => null);
    if (devices && !devices.some((x) => x.code?.toUpperCase() === d.code)) throw new FormError("That code isn't registered to your Helcim account. Check the code on the terminal's screen.", "code");
    await withTenant(business.id, (tx) => tx.insert(schema.helcimDevices).values({ businessId: business.id, code: d.code, name: d.name, locationId: d.locationId || null }).onConflictDoUpdate({ target: [schema.helcimDevices.businessId, schema.helcimDevices.code], set: { name: d.name, locationId: d.locationId || null } }));
    await auditEvent(business.id, user.id, "settings.helcim_device_add", "business", business.id, { code: d.code, name: d.name });
    revalidatePath(`/app/${d.slug}/settings/payments`);
    return `${d.name} paired`;
  },
);

export async function removeHelcimDevice(formData: FormData) {
  const slug = String(formData.get("slug"));
  const id = String(formData.get("deviceId"));
  const { business, user } = await requireAction(slug, "billing.manage");
  await withTenant(business.id, (tx) => tx.delete(schema.helcimDevices).where(eq(schema.helcimDevices.id, id)));
  await auditEvent(business.id, user.id, "settings.helcim_device_remove", "business", business.id, { deviceId: id });
  await setFlash("Terminal removed");
  revalidatePath(`/app/${slug}/settings/payments`);
}

export async function pingHelcimDeviceAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const id = String(formData.get("deviceId"));
  const { business } = await requireAction(slug, "billing.manage");
  const token = helcimTokenOf(business);
  const device = await withTenant(business.id, (tx) => tx.query.helcimDevices.findFirst({ where: eq(schema.helcimDevices.id, id) }));
  if (!token || !device) return;
  try {
    await helcim.pingDevice(token, device.code);
    await setFlash(`Sent a test message to ${device.name}: check its screen`);
  } catch (e) {
    await setFlash(`${device.name} didn't answer: ${(e as Error).message}`, "error");
  }
  revalidatePath(`/app/${slug}/settings/payments`);
}
