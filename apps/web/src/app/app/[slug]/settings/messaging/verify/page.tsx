import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAction } from "@/lib/tenant";
import { appUrl } from "@/lib/stripe";
import { defaultVerificationForm, getActiveNumber, getNumberById, OPT_IN_IMAGE_PATH, type VerificationForm } from "@/server/messaging";
import { schema, withTenant } from "@angelic/db";
import { eq } from "drizzle-orm";
import { normalizePhone } from "@angelic/core";
import { FormPage, Input, Notice, Select, Textarea } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { submitVerificationAction } from "../actions";
import { BusinessTypeFields } from "./business-type";

export const metadata: Metadata = { title: "Carrier verification" };

const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

export default async function VerifyPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ number?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, user } = await requireAction(slug, "business.manage");
  const number = sp.number ? await getNumberById(business.id, sp.number) : await getActiveNumber(business.id);
  if (!number) redirect(`/app/${slug}/settings/messaging/new`);
  if (number.status !== "unverified" && number.status !== "rejected") redirect(`/app/${slug}/settings/messaging`);
  // A location's own number is verified under that location's name and address.
  const location = number.locationId ? await withTenant(business.id, (tx) => tx.query.locations.findFirst({ where: eq(schema.locations.id, number.locationId!) })) : null;
  const saved = (number.verification as unknown as Partial<VerificationForm> | null) ?? {};
  const prefill = defaultVerificationForm(business, user);
  if (location) Object.assign(prefill, { businessName: location.name, businessStreetAddress: location.addressLine1 ?? prefill.businessStreetAddress, businessCity: location.city, businessStateProvinceRegion: location.state, businessPostalCode: location.postalCode, contactPhone: location.phone ? normalizePhone(location.phone) : prefill.contactPhone });
  const v: VerificationForm = { ...prefill, ...saved };

  return (
    <FormPage title="Carrier verification" backHref={`/app/${slug}/settings/messaging`} backLabel="Text messaging">
      <p className="text-sm text-stone-600">
        US carriers review every toll-free number before it can send texts. We prefilled this from your profile; check it and submit.
        Approval usually takes 1 to 3 weeks and we will email you the result.
      </p>
      {number.status === "rejected" && number.rejectionReason ? <div className="mt-3"><Notice><span className="font-medium">Carrier feedback:</span> {number.rejectionReason}</Notice></div> : null}
      <ActionForm action={submitVerificationAction} className="mt-4">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="numberId" value={number.id} />

        <h3 className="mb-2 font-medium">Business</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Legal business name" name="businessName" required><Input name="businessName" defaultValue={v.businessName} required /></Field>
          <Field label="Website" name="businessWebsite" required hint="Your site, or your booking page if you don't have one."><Input name="businessWebsite" defaultValue={v.businessWebsite} required /></Field>
          <BusinessTypeFields type={v.businessType} ein={v.businessRegistrationNumber ?? ""} />
          <Field label="Street address" name="businessStreetAddress" className="sm:col-span-2"><Input name="businessStreetAddress" defaultValue={v.businessStreetAddress ?? ""} /></Field>
          <Field label="City" name="businessCity"><Input name="businessCity" defaultValue={v.businessCity ?? ""} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="State" name="businessStateProvinceRegion">
              <Select name="businessStateProvinceRegion" defaultValue={v.businessStateProvinceRegion ?? ""}>
                <option value="">—</option>
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="ZIP" name="businessPostalCode"><Input name="businessPostalCode" defaultValue={v.businessPostalCode ?? ""} /></Field>
          </div>
        </div>

        <h3 className="mb-2 mt-5 font-medium">Contact</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name" name="contactFirstName" required><Input name="contactFirstName" defaultValue={v.contactFirstName} required /></Field>
          <Field label="Last name" name="contactLastName" required><Input name="contactLastName" defaultValue={v.contactLastName} required /></Field>
          <Field label="Email" name="contactEmail" required hint="The carriers' decision is emailed here."><Input name="contactEmail" type="email" defaultValue={v.contactEmail} required /></Field>
          <Field label="Phone" name="contactPhone"><Input name="contactPhone" type="tel" defaultValue={v.contactPhone ?? ""} /></Field>
        </div>

        <h3 className="mb-2 mt-5 font-medium">Messaging</h3>
        <Field label="Estimated texts per month" name="messageVolume">
          <Select name="messageVolume" defaultValue={v.messageVolume}>
            <option value="100">Up to 100</option>
            <option value="1,000">Up to 1,000</option>
            <option value="10,000">Up to 10,000</option>
            <option value="100,000">Up to 100,000</option>
          </Select>
        </Field>
        <Field label="How you use texting" name="useCaseSummary" required hint="Plain language. Reviewers look for: who opts in, how, and what they receive.">
          <Textarea name="useCaseSummary" rows={5} defaultValue={v.useCaseSummary} required />
        </Field>
        <Field label="Sample messages" name="productionMessageSample" required hint="Examples of real texts clients will receive.">
          <Textarea name="productionMessageSample" rows={4} defaultValue={v.productionMessageSample} required />
        </Field>
        <Field label="Extra opt-in screenshot URL" name="extraOptInImageUrl" hint={`We already attach a screenshot of the booking page consent box (${appUrl(OPT_IN_IMAGE_PATH)}). Add another if you collect consent elsewhere, e.g. an in-store form.`}>
          <Input name="extraOptInImageUrl" defaultValue={v.extraOptInImageUrl ?? ""} placeholder="https://…/opt-in.png" />
        </Field>
        <Field label="Anything else for the reviewers" name="additionalInformation"><Textarea name="additionalInformation" rows={4} defaultValue={v.additionalInformation ?? ""} /></Field>

        <SubmitButton pendingText="Submitting…">Submit for verification</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
