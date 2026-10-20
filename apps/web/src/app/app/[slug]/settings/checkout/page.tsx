import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { BackLink, Card, Input, PageHeader } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { saveTipChoices } from "./actions";

export const metadata: Metadata = { title: "Checkout & tips" };

export default async function CheckoutSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "settings.booking");
  const tips = business.tipPercents;
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Checkout & tips" />
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <Card className="p-5">
          <h2 className="mb-1 font-medium">Tip choices</h2>
          <p className="mb-4 text-sm text-stone-600">The percentages offered when the client picks a tip on the checkout screen, and in the staff tip form. Worked out on the services and products after any discount, before tax.</p>
          <ActionForm action={saveTipChoices}>
            <input type="hidden" name="slug" value={slug} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Field key={i} label={`Choice ${i + 1}`} name={`tip${i + 1}`}>
                  <Input name={`tip${i + 1}`} type="number" min={1} max={100} inputMode="numeric" defaultValue={tips[i] ?? ""} placeholder={i === 3 ? "Optional" : undefined} />
                </Field>
              ))}
            </div>
            <SubmitButton pendingText="Saving…">Save tip choices</SubmitButton>
          </ActionForm>
        </Card>
        <Card className="p-4 text-sm">
          <h2 className="mb-1 font-medium">Where clients see these</h2>
          <p className="text-stone-600">On a ticket, tap <b>Ask the client</b> under Tips and turn the screen around: the client picks one of these, types an amount, or skips. &ldquo;Other amount&rdquo; and &ldquo;No tip&rdquo; are always there.</p>
        </Card>
      </div>
    </>
  );
}
