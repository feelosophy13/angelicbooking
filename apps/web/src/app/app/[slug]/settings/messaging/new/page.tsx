import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { money } from "@/lib/format";
import { listNumbers, numberMonthlyFeeCents, searchTollFree, twilioConfigured } from "@/server/messaging";
import { schema, withTenant } from "@angelic/db";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { billingState } from "@/server/billing";
import { Button, FormPage, Input, Notice } from "@/components/ui";
import { ActionForm, ConfirmSubmit } from "@/components/form";
import { buyNumberAction } from "../actions";

export const metadata: Metadata = { title: "Choose a number" };

export default async function NewNumberPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ contains?: string; location?: string }> }) {
  const { slug } = await params;
  const { contains = "", location: locationId = "" } = await searchParams;
  const { business } = await requireAction(slug, "integrations.manage");
  const location = locationId ? await withTenant(business.id, (tx) => tx.query.locations.findFirst({ where: eq(schema.locations.id, locationId) })) : null;
  const existing = await withTenant(business.id, listNumbers);
  if (existing.some((n) => (n.locationId ?? null) === (location?.id ?? null))) redirect(`/app/${slug}/settings/messaging`);
  if (!(await billingState(business)).canBuyNumber) redirect(`/app/${slug}/settings/billing`);
  const fee = await numberMonthlyFeeCents(business.id);
  let numbers: { phoneNumber: string; friendlyName: string }[] = [];
  let error: string | null = null;
  if (twilioConfigured()) {
    try {
      numbers = await searchTollFree({ contains: contains || undefined, limit: 12 });
    } catch (e) {
      error = (e as Error).message;
    }
  } else {
    error = "Text messaging is not available on this platform yet.";
  }

  return (
    <FormPage title={location ? `Choose a toll-free number for ${location.name}` : "Choose a toll-free number"} backHref={`/app/${slug}/settings/messaging`} backLabel="Text messaging">
      <p className="text-sm text-stone-600">
        Pick any available number. {fee > 0 ? `${money(fee)} per month on your invoice.` : "Included in your plan."}
      </p>
      <form method="get" className="mt-3 flex gap-2">
        <Input name="contains" defaultValue={contains} placeholder="Digits or letters to include, e.g. 555 or CUTS (optional)" />
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      {error ? <div className="mt-4"><Notice>{error}</Notice></div> : null}
      {!error && numbers.length === 0 ? <p className="mt-4 text-sm text-stone-600">No numbers matched. Try fewer digits.</p> : null}
      {numbers.length ? (
        <ul className="mt-4 divide-y divide-stone-200 rounded-lg border border-stone-200">
          {numbers.map((n) => (
            <li key={n.phoneNumber} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="font-medium tabular-nums">{n.friendlyName}</span>
              <ActionForm action={buyNumberAction} className="inline">
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="phoneNumber" value={n.phoneNumber} />
                {location ? <input type="hidden" name="locationId" value={location.id} /> : null}
                <ConfirmSubmit
                  title={`Get ${n.friendlyName}?`}
                  body={`${fee > 0 ? `${money(fee)} per month. ` : ""}You can release it at any time. Next you'll submit carrier verification so it can send texts.`}
                  confirmLabel="Get this number"
                  variant="primary"
                >
                  Choose
                </ConfirmSubmit>
              </ActionForm>
            </li>
          ))}
        </ul>
      ) : null}
    </FormPage>
  );
}
