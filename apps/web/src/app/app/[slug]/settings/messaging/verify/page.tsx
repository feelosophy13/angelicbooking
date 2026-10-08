import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAction } from "@/lib/tenant";
import { appUrl } from "@/lib/stripe";
import { defaultVerificationForm, getActiveNumber, OPT_IN_IMAGE_PATH, type VerificationForm } from "@/server/messaging";
import { FormPage, Input, Notice, Select, Textarea } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { submitVerificationAction } from "../actions";

export const metadata: Metadata = { title: "Carrier verification" };

const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

export default async function VerifyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, user } = await requireAction(slug, "business.manage");
  const number = await getActiveNumber(business.id);
  if (!number) redirect(`/app/${slug}/settings/messaging/new`);
  if (number.status !== "unverified" && number.status !== "rejected") redirect(`/app/${slug}/settings/messaging`);
  const saved = (number.verification as unknown as Partial<VerificationForm> | null) ?? {};
  const v: VerificationForm = { ...defaultVerificationForm(business, user), ...saved };

  return (
    <FormPage title="Carrier verification" backHref={`/app/${slug}/settings/messaging`} backLabel="Text messaging">
      <p className="text-sm text-stone-600">
        US carriers review every toll-free number before it can send texts. We prefilled this from your profile; check it and submit.
        Approval usually takes 1 to 3 weeks and we will email you the result.
      </p>
      {number.status === "rejected" && number.rejectionReason ? <div className="mt-3"><Notice><span className="font-medium">Carrier feedback:</span> {number.rejectionReason}</Notice></div> : null}
      <ActionForm action={submitVerificationAction} className="mt-4">
        <input type="hidden" name="slug" value={slug} />

        <h3 className="mb-2 font-medium">Business</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Legal business name" name="businessName" required><Input name="businessName" defaultValue={v.businessName} required /></Field>
          <Field label="Website" name="businessWebsite" required hint="Your site, or your booking page if you don't have one."><Input name="businessWebsite" defaultValue={v.businessWebsite} required /></Field>
          <Field label="Business type" name="businessType">
            <Select name="businessType" defaultValue={v.businessType}>
              <option value="PRIVATE_PROFIT">Private company (LLC, Inc., partnership)</option>
              <option value="SOLE_PROPRIETOR">Sole proprietor (no EIN)</option>
              <option value="PUBLIC_PROFIT">Publicly traded company</option>
              <option value="NON_PROFIT">Non-profit</option>
              <option value="GOVERNMENT">Government</option>
            </Select>
          </Field>
          <Field label="EIN" name="businessRegistrationNumber" hint="9 digits, e.g. 12-3456789. Leave blank for sole proprietors."><Input name="businessRegistrationNumber" defaultValue={v.businessRegistrationNumber ?? ""} placeholder="12-3456789" /></Field>
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
        <Field label="Anything else for the reviewers" name="additionalInformation"><Textarea name="additionalInformation" rows={2} defaultValue={v.additionalInformation ?? ""} /></Field>

        <SubmitButton pendingText="Submitting…">Submit for verification</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
