import { asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { Card, Checkbox } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { saveStaffServices } from "../../actions";

export default async function StaffServicesPage({ params }: { params: Promise<{ slug: string; staffId: string }> }) {
  const { slug, staffId } = await params;
  const { business } = await requireAction(slug, "staff.manage");
  const { services, mapped } = await withTenant(business.id, async (tx) => ({
    services: await tx.select().from(schema.services).where(eq(schema.services.active, true)).orderBy(asc(schema.services.name)),
    mapped: new Set((await tx.select({ serviceId: schema.staffServices.serviceId }).from(schema.staffServices).where(eq(schema.staffServices.staffId, staffId))).map((m) => m.serviceId)),
  }));
  return (
    <Card className="max-w-lg p-4">
      <p className="mb-3 text-xs text-stone-500">If none are selected, this person can be booked for every service.</p>
      <form action={saveStaffServices} className="space-y-2">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="staffId" value={staffId} />
        {services.length === 0 ? <p className="text-sm text-stone-500">No services yet.</p> : null}
        {services.map((s) => (
          <Checkbox key={s.id} name="serviceIds" value={s.id} defaultChecked={mapped.has(s.id)} label={<>{s.name} <span className="text-stone-400">· {s.durationMin} min</span></>} />
        ))}
        <SubmitButton className="mt-2" pendingText="Saving…">Save services</SubmitButton>
      </form>
    </Card>
  );
}
