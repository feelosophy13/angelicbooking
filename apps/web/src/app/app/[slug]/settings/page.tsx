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
          <p className="mb-3 text-sm text-stone-600">
            Connect your own Stripe account to take card payments, save cards on file and charge no-show fees. Payments go
            directly to you.
          </p>
          <Link href={`/app/${slug}/settings/payments`} className="text-sm text-brand-700 underline">
            {business.stripeChargesEnabled ? "Stripe connected · manage →" : "Set up payments →"}
          </Link>
          
        </Card>
        <Card className="p-4">
          <h2 className="mb-1 font-medium">Online booking</h2>
          <p className="mb-3 text-sm text-stone-600">Your public booking link, notice and cancellation rules, reminders and no-show fee.</p>
          <Link href={`/app/${slug}/settings/booking`} className="text-sm text-brand-700 underline">Booking settings →</Link>
        </Card>
        <Card className="p-4">
          <h2 className="mb-1 font-medium">Messages</h2>
          <p className="mb-3 text-sm text-stone-600">Every confirmation, reminder and cancellation sent to clients, with delivery status.</p>
          <Link href={`/app/${slug}/settings/notifications`} className="text-sm text-brand-700 underline">Message log →</Link>
        </Card>
        <Card className="p-4">
          <h2 className="mb-1 font-medium">Locations &amp; domain</h2>
          <p className="mb-3 text-sm text-stone-600">Add locations, pick the default, and serve booking from your own hostname.</p>
          <Link href={`/app/${slug}/settings/locations`} className="text-sm text-brand-700 underline">Locations &amp; domain →</Link>
        </Card>
        <Card className="p-4">
          <h2 className="mb-1 font-medium">Import from Vagaro</h2>
          <p className="mb-3 text-sm text-stone-600">Bring over clients, services and upcoming appointments from CSV or Excel exports.</p>
          <Link href={`/app/${slug}/settings/import`} className="text-sm text-brand-700 underline">Import data →</Link>
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
