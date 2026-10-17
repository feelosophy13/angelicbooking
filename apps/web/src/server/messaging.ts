/**
 * Per-business SMS sender numbers: buy a toll-free number from the platform's
 * Twilio account, submit carrier (toll-free) verification, poll its status and
 * release the number. All rows are tenant-scoped; the cron-side status poll uses
 * the cross-tenant jobs read and writes back per tenant.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { schema, withJobs, withTenant, type TenantDb } from "@angelic/db";
import { normalizePhone } from "@angelic/core";
import { appUrl } from "@/lib/stripe";
import { attachNumberItem, billingState, detachNumberItem } from "@/server/billing";
import { priceBookFor } from "@/server/price-book";
import { siteUrl } from "@/lib/site-url";
import {
  createTollfreeVerification,
  fetchTollfreeVerification,
  purchaseNumber,
  releaseNumber,
  searchTollFree,
  twilioConfigured,
  updateTollfreeVerification,
  TwilioError,
  type TollfreeStatus,
  type TollfreeVerificationInput,
} from "@/lib/twilio";

export type MessagingNumber = typeof schema.messagingNumbers.$inferSelect;
type Business = typeof schema.businesses.$inferSelect;

export class MessagingError extends Error {}

/** What a text number costs this business per month: its price book (the platform default, or its own deal). */
export async function numberMonthlyFeeCents(businessId: string): Promise<number> {
  return (await priceBookFor(businessId)).numberCents;
}

/** Public image of the booking form's SMS consent checkbox, shown to carrier reviewers. */
export const OPT_IN_IMAGE_PATH = "/tollfree/opt-in.png";

/** Every number the business still holds (business-wide first, then per location). */
export async function listNumbers(tx: TenantDb): Promise<MessagingNumber[]> {
  const rows = await tx.select().from(schema.messagingNumbers).where(isNull(schema.messagingNumbers.releasedAt)).orderBy(schema.messagingNumbers.purchasedAt);
  return rows.sort((a, b) => Number(!!a.locationId) - Number(!!b.locationId));
}

/**
 * The number that serves a location: the location's own if it has one, else the
 * business-wide number (location null). Without a location: the business-wide one.
 */
export async function activeNumber(tx: TenantDb, locationId?: string | null): Promise<MessagingNumber | null> {
  const rows = await listNumbers(tx);
  return (locationId ? rows.find((r) => r.locationId === locationId) : undefined) ?? rows.find((r) => !r.locationId) ?? null;
}

export async function getActiveNumber(businessId: string, locationId?: string | null): Promise<MessagingNumber | null> {
  return withTenant(businessId, (tx) => activeNumber(tx, locationId));
}

export async function getNumberById(businessId: string, id: string): Promise<MessagingNumber | null> {
  return withTenant(businessId, async (tx) => (await tx.query.messagingNumbers.findFirst({ where: and(eq(schema.messagingNumbers.id, id), isNull(schema.messagingNumbers.releasedAt)) })) ?? null);
}

/** Whether this business can send texts right now: a verified number of its own, or a platform fallback sender. */
export async function smsAvailableFor(businessId: string): Promise<boolean> {
  const own = await withTenant(businessId, listNumbers);
  if (own.some((n) => n.status === "verified")) return true;
  return !!(process.env.TWILIO_FROM || process.env.TWILIO_MESSAGING_SERVICE_SID) && twilioConfigured();
}

export { searchTollFree, twilioConfigured };

/** Buy `phoneNumber` for the business (or for one location). Refuses if that scope already has an active number. */
export async function buyNumber(business: Business, phoneNumber: string, locationId: string | null = null): Promise<MessagingNumber> {
  if (!twilioConfigured()) throw new MessagingError("Text messaging is not set up on this platform yet.");
  const existing = (await withTenant(business.id, listNumbers)).find((n) => (n.locationId ?? null) === locationId);
  if (existing) throw new MessagingError(`You already have a number (${existing.phoneNumber}) for this. Release it first to pick a different one.`);
  const location = locationId ? await withTenant(business.id, (tx) => tx.query.locations.findFirst({ where: eq(schema.locations.id, locationId) })) : null;
  if (locationId && !location) throw new MessagingError("Location not found.");
  if (!(await billingState(business)).canBuyNumber) throw new MessagingError("Add a card under Settings → Billing first; the number is billed monthly.");
  let bought: { sid: string; phoneNumber: string };
  try {
    bought = await purchaseNumber(phoneNumber, { friendlyName: `${location ? location.name : business.name} (${business.slug})`, smsUrl: appUrl("/api/twilio/inbound") });
  } catch (e) {
    if (e instanceof TwilioError) throw new MessagingError(e.code === 21422 ? "That number was just taken. Pick another one." : `Twilio: ${e.message}`);
    throw e;
  }
  const monthlyFeeCents = await numberMonthlyFeeCents(business.id);
  try {
    const [row] = await withTenant(business.id, (tx) =>
      tx
        .insert(schema.messagingNumbers)
        .values({ businessId: business.id, phoneNumber: bought.phoneNumber, providerSid: bought.sid, locationId, monthlyFeeCents, billingStartsAt: new Date() })
        .returning(),
    );
    await attachNumberItem(business, row!.id).catch((e) => console.error("[messaging] could not add number to subscription", (e as Error).message));
    return row!;
  } catch (e) {
    // Don't leave a paid number dangling if the row could not be written.
    await releaseNumber(bought.sid).catch(() => {});
    throw e;
  }
}

export async function releaseBusinessNumber(business: Business, numberId?: string | null): Promise<void> {
  const row = numberId ? await getNumberById(business.id, numberId) : await getActiveNumber(business.id);
  if (!row) return;
  try {
    await releaseNumber(row.providerSid);
  } catch (e) {
    if (e instanceof TwilioError) throw new MessagingError(`Twilio: ${e.message}`);
    throw e;
  }
  await withTenant(business.id, (tx) =>
    tx.update(schema.messagingNumbers).set({ status: "released", releasedAt: new Date() }).where(eq(schema.messagingNumbers.id, row.id)),
  );
  await detachNumberItem(business, row).catch((e) => console.error("[messaging] could not remove number from subscription", (e as Error).message));
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export const VERIFICATION_USE_CASES = ["ACCOUNT_NOTIFICATIONS", "CUSTOMER_CARE"];

/** Form fields collected from the business (stored as the `verification` snapshot). */
export interface VerificationForm {
  businessName: string;
  businessWebsite: string;
  businessType: TollfreeVerificationInput["businessType"];
  businessRegistrationNumber: string | null;
  businessStreetAddress: string | null;
  businessCity: string | null;
  businessStateProvinceRegion: string | null;
  businessPostalCode: string | null;
  contactFirstName: string;
  contactLastName: string;
  contactEmail: string;
  contactPhone: string | null;
  messageVolume: string;
  useCaseSummary: string;
  productionMessageSample: string;
  additionalInformation: string | null;
  extraOptInImageUrl: string | null;
}

/** Sensible prefill from the business profile and the signed-in user. */
export function defaultVerificationForm(business: Business, user: { name: string; email: string }): VerificationForm {
  const [first = "", ...rest] = user.name.trim().split(/\s+/);
  const bookingUrl = siteUrl(business);
  return {
    businessName: business.name,
    businessWebsite: business.website || bookingUrl,
    businessType: "PRIVATE_PROFIT",
    businessRegistrationNumber: null,
    businessStreetAddress: business.addressLine,
    businessCity: null,
    businessStateProvinceRegion: null,
    businessPostalCode: null,
    contactFirstName: first,
    contactLastName: rest.join(" "),
    contactEmail: business.email || user.email,
    contactPhone: normalizePhone(business.phone),
    messageVolume: "1,000",
    useCaseSummary:
      `${business.name} is a beauty salon. Clients who book an appointment online at ${bookingUrl} (or in person) and tick the SMS consent box ` +
      `receive transactional text messages only: appointment confirmations, reminders before their visit, and notices when an appointment is ` +
      `rescheduled or cancelled. Every message identifies the salon and clients can reply STOP at any time. No marketing or promotional content is sent.`,
    productionMessageSample:
      `${business.name}: you're booked for Haircut with Jamie on Tue, Oct 14 at 2:00 PM. Manage: ${bookingUrl}/manage/abc123. Reply STOP to opt out.\n` +
      `${business.name} reminder: Haircut with Jamie tomorrow at 2:00 PM. Manage: ${bookingUrl}/manage/abc123`,
    additionalInformation: null,
    extraOptInImageUrl: null,
  };
}

function toTwilioInput(row: MessagingNumber, business: Business, form: VerificationForm): TollfreeVerificationInput {
  const images = [appUrl(OPT_IN_IMAGE_PATH)];
  if (form.extraOptInImageUrl) images.push(form.extraOptInImageUrl);
  return {
    tollfreePhoneNumberSid: row.providerSid,
    businessName: form.businessName,
    businessWebsite: form.businessWebsite,
    notificationEmail: form.contactEmail,
    businessType: form.businessType,
    businessRegistrationNumber: form.businessRegistrationNumber,
    businessStreetAddress: form.businessStreetAddress,
    businessCity: form.businessCity,
    businessStateProvinceRegion: form.businessStateProvinceRegion,
    businessPostalCode: form.businessPostalCode,
    businessCountry: "US",
    businessContactFirstName: form.contactFirstName,
    businessContactLastName: form.contactLastName,
    businessContactEmail: form.contactEmail,
    businessContactPhone: form.contactPhone,
    useCaseCategories: VERIFICATION_USE_CASES,
    useCaseSummary: form.useCaseSummary,
    productionMessageSample: form.productionMessageSample,
    optInImageUrls: images,
    optInType: "WEB_FORM",
    messageVolume: form.messageVolume,
    additionalInformation: form.additionalInformation,
    privacyPolicyUrl: appUrl("/privacy"),
    termsAndConditionsUrl: appUrl("/terms"),
    optInConfirmationMessage: `${form.businessName}: you're signed up for appointment texts. Msg & data rates may apply. Reply HELP for help, STOP to opt out.`,
    helpMessageSample: `${form.businessName}: appointment texts. Call ${form.contactPhone ?? "the salon"} for help. Reply STOP to opt out.`,
    externalReferenceId: business.id,
  };
}

export function localStatus(s: TollfreeStatus): MessagingNumber["status"] {
  switch (s) {
    case "PENDING_REVIEW":
      return "pending_review";
    case "IN_REVIEW":
      return "in_review";
    case "TWILIO_APPROVED":
      return "verified";
    case "TWILIO_REJECTED":
      return "rejected";
  }
}

/** Submit (or, after an editable rejection, resubmit) toll-free verification for the business's number. */
export async function submitVerification(business: Business, form: VerificationForm, numberId?: string | null): Promise<MessagingNumber> {
  const row = numberId ? await getNumberById(business.id, numberId) : await getActiveNumber(business.id);
  if (!row) throw new MessagingError("Get a number first.");
  if (row.status === "verified") throw new MessagingError("This number is already verified.");
  if (row.status === "pending_review" || row.status === "in_review") throw new MessagingError("Verification is already under review.");
  const input = toTwilioInput(row, business, form);
  let v;
  try {
    v = row.verificationSid && row.status === "rejected" && row.editAllowed ? await updateTollfreeVerification(row.verificationSid, input) : await createTollfreeVerification(input);
  } catch (e) {
    if (e instanceof TwilioError) throw new MessagingError(`Twilio: ${e.message}`);
    throw e;
  }
  const [updated] = await withTenant(business.id, (tx) =>
    tx
      .update(schema.messagingNumbers)
      .set({
        verificationSid: v.sid,
        status: localStatus(v.status),
        verificationSubmittedAt: new Date(),
        verification: form as unknown as Record<string, string>,
        rejectionReason: null,
        rejectionDetails: null,
        editAllowed: false,
      })
      .where(eq(schema.messagingNumbers.id, row.id))
      .returning(),
  );
  return updated!;
}

async function applyVerification(businessId: string, rowId: string, verificationSid: string): Promise<MessagingNumber["status"]> {
  const v = await fetchTollfreeVerification(verificationSid);
  const status = localStatus(v.status);
  await withTenant(businessId, (tx) =>
    tx
      .update(schema.messagingNumbers)
      .set({
        status,
        verifiedAt: status === "verified" ? new Date() : null,
        rejectionReason: v.rejectionReason,
        rejectionDetails: v.rejectionReasons,
        editAllowed: v.editAllowed,
      })
      .where(and(eq(schema.messagingNumbers.id, rowId), inArray(schema.messagingNumbers.status, ["pending_review", "in_review", "rejected", "verified"]))),
  );
  return status;
}

/** Re-check the business's verification with Twilio now. */
export async function refreshVerification(business: Business, numberId?: string | null): Promise<MessagingNumber | null> {
  const row = numberId ? await getNumberById(business.id, numberId) : await getActiveNumber(business.id);
  if (!row?.verificationSid) return row;
  try {
    await applyVerification(business.id, row.id, row.verificationSid);
  } catch (e) {
    if (e instanceof TwilioError) throw new MessagingError(`Twilio: ${e.message}`);
    throw e;
  }
  return getNumberById(business.id, row.id);
}

/** Cron: poll every verification still under review. Twilio has no status webhook for toll-free verification. */
export async function refreshPendingVerifications(): Promise<{ checked: number; changed: number }> {
  if (!twilioConfigured()) return { checked: 0, changed: 0 };
  const pending = await withJobs((tx) =>
    tx
      .select({ id: schema.messagingNumbers.id, businessId: schema.messagingNumbers.businessId, verificationSid: schema.messagingNumbers.verificationSid, status: schema.messagingNumbers.status })
      .from(schema.messagingNumbers)
      .where(and(inArray(schema.messagingNumbers.status, ["pending_review", "in_review"]), isNull(schema.messagingNumbers.releasedAt)))
      .limit(100),
  );
  let changed = 0;
  for (const p of pending) {
    if (!p.verificationSid) continue;
    try {
      const next = await applyVerification(p.businessId, p.id, p.verificationSid);
      if (next !== p.status) changed++;
    } catch (e) {
      console.error("[messaging] verification poll failed", p.id, (e as Error).message);
    }
  }
  return { checked: pending.length, changed };
}
