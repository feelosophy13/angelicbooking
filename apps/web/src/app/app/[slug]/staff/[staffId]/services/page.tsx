import { asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { Button, Card } from "@/components/ui";
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
          <label key={s.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="serviceIds" value={s.id} defaultChecked={mapped.has(s.id)} className="h-4 w-4 accent-brand-600" />
            {s.name} <span className="text-stone-400">· {s.durationMin} min</span>
          </label>
        ))}
        <Button type="submit" className="mt-2">Save services</Button>
      </form>
    </Card>
  );
}
