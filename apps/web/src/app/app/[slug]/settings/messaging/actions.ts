"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { normalizePhone } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { f, formAction, FormError } from "@/lib/form";
import { buyNumber, MessagingError, refreshVerification, releaseBusinessNumber, submitVerification, type VerificationForm } from "@/server/messaging";

const known = { knownErrors: [MessagingError] };

export const buyNumberAction = formAction(
  z.object({ slug: z.string(), phoneNumber: z.string().regex(/^\+1\d{10}$/, "Pick a number from the list"), locationId: z.string().optional() }),
  async (d) => {
    const { business } = await requireAction(d.slug, "integrations.manage");
    const row = await buyNumber(business, d.phoneNumber, d.locationId || null);
    revalidatePath(`/app/${d.slug}`, "layout");
    redirect(`/app/${d.slug}/settings/messaging?bought=${row.id}`);
  },
  known,
);

export const releaseNumberAction = formAction(
  z.object({ slug: z.string(), numberId: z.string().optional() }),
  async (d) => {
    const { business } = await requireAction(d.slug, "integrations.manage");
    await releaseBusinessNumber(business, d.numberId || null);
    revalidatePath(`/app/${d.slug}`, "layout");
    return "Number released. Texts are paused until you get a new one.";
  },
  known,
);

export const refreshVerificationAction = formAction(
  z.object({ slug: z.string(), numberId: z.string().optional() }),
  async (d) => {
    const { business } = await requireAction(d.slug, "integrations.manage");
    const row = await refreshVerification(business, d.numberId || null);
    revalidatePath(`/app/${d.slug}/settings/messaging`);
    return row?.status === "verified" ? "Verified. Texts now go out from your number." : "Status refreshed";
  },
  known,
);

const businessTypes = ["PRIVATE_PROFIT", "PUBLIC_PROFIT", "SOLE_PROPRIETOR", "NON_PROFIT", "GOVERNMENT"] as const;

export const submitVerificationAction = formAction(
  z.object({
    slug: z.string(),
    numberId: z.string().optional(),
    businessName: f.text(2, 100),
    businessWebsite: z.string().trim().url("Enter a full URL starting with https://"),
    businessType: z.enum(businessTypes),
    businessRegistrationNumber: f.optional(20),
    businessStreetAddress: f.optional(120),
    businessCity: f.optional(60),
    businessStateProvinceRegion: f.optional(2),
    businessPostalCode: f.optional(10),
    contactFirstName: f.text(1, 60),
    contactLastName: f.text(1, 60),
    contactEmail: z.string().trim().email("Enter a valid email"),
    contactPhone: f.optional(30),
    messageVolume: z.enum(["100", "1,000", "10,000", "100,000"]),
    useCaseSummary: f.text(40, 1500),
    productionMessageSample: f.text(20, 1500),
    additionalInformation: f.optional(1500),
    extraOptInImageUrl: z.string().trim().url("Enter a full image URL").or(z.literal("")).transform((v) => v || null),
  }),
  async (d) => {
    const { business } = await requireAction(d.slug, "integrations.manage");
    if (d.businessType !== "SOLE_PROPRIETOR" && !/^\d{2}-?\d{7}$/.test(d.businessRegistrationNumber ?? "")) {
      throw new FormError("Enter your 9-digit EIN (or choose Sole proprietor).", "businessRegistrationNumber");
    }
    const contactPhone = d.contactPhone ? normalizePhone(d.contactPhone) : null;
    if (d.contactPhone && !contactPhone) throw new FormError("Enter a valid US phone number", "contactPhone");
    const { numberId, ...rest } = d;
    const form: VerificationForm = { ...rest, businessRegistrationNumber: d.businessRegistrationNumber?.replace("-", "") ?? null, contactPhone };
    await submitVerification(business, form, numberId || null);
    revalidatePath(`/app/${d.slug}/settings/messaging`);
    redirect(`/app/${d.slug}/settings/messaging?submitted=1`);
  },
  known,
);
