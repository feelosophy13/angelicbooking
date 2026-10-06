import Link from "next/link";
import { requireAction } from "@/lib/tenant";
import { TIMEZONES } from "@/lib/utils";
import { Button, Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { updateBusiness } from "./actions";

export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "business.manage");
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 font-medium">Business</h2>
          <form action={updateBusiness} className="space-y-3">
            <input type="hidden" name="slug" value={slug} />
            <Field label="Name"><Input name="name" defaultValue={business.name} required /></Field>
            <Field label="Timezone">
              <Select name="timezone" defaultValue={business.timezone}>
                {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </Select>
            </Field>
            <Field label="Booking grid" hint="Appointments start on these intervals.">
              <Select name="slotIntervalMin" defaultValue={String(business.slotIntervalMin)}>
                {[5, 10, 15, 20, 30, 60].map((n) => <option key={n} value={n}>{n} minutes</option>)}
              </Select>
            </Field>
            <Field label="Phone"><Input name="phone" defaultValue={business.phone ?? ""} /></Field>
            <Field label="Email"><Input name="email" type="email" defaultValue={business.email ?? ""} /></Field>
            <Button type="submit">Save</Button>
          </form>
        </Card>
        <Card className="p-4">
          <h2 className="mb-1 font-medium">Payments</h2>
          <p className="text-sm text-stone-600">
            Stripe Connect onboarding arrives in Phase 2. Each business will connect its own Stripe account here; payments go
            directly to it.
          </p>
          <p className="mt-3 text-xs text-stone-500">Booking URL (Phase 3): /book/{business.slug}</p>
        </Card>
        <Card className="p-4">
          <h2 className="mb-1 font-medium">Activity log</h2>
          <p className="mb-3 text-sm text-stone-600">Every booking, reschedule and status change, with who did it.</p>
          <Link href={`/app/${slug}/settings/audit`} className="text-sm text-brand-700 underline">View activity log →</Link>
        </Card>
      </div>
    </>
  );
}
