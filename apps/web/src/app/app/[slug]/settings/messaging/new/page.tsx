import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { money } from "@/lib/format";
import { getActiveNumber, numberMonthlyFeeCents, searchTollFree, twilioConfigured } from "@/server/messaging";
import { redirect } from "next/navigation";
import { Button, FormPage, Input, Notice } from "@/components/ui";
import { ActionForm, ConfirmSubmit } from "@/components/form";
import { buyNumberAction } from "../actions";

export const metadata: Metadata = { title: "Choose a number" };

export default async function NewNumberPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ contains?: string }> }) {
  const { slug } = await params;
  const { contains = "" } = await searchParams;
  const { business } = await requireAction(slug, "business.manage");
  if (await getActiveNumber(business.id)) redirect(`/app/${slug}/settings/messaging`);
  const fee = numberMonthlyFeeCents();
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
    <FormPage title="Choose a toll-free number" backHref={`/app/${slug}/settings/messaging`} backLabel="Text messaging" width="max-w-2xl">
      <p className="text-sm text-stone-600">
        Pick any available number. {fee > 0 ? `${money(fee)} per month, billed with your subscription once payments are enabled.` : "Included in your plan."}
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
