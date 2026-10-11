import { asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { Card } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { listCategories, pathTo } from "@/server/categories";
import { saveStaffServices } from "../../actions";
import { StaffServicesPicker, type PickerGroup } from "./picker";

export default async function StaffServicesPage({ params }: { params: Promise<{ slug: string; staffId: string }> }) {
  const { slug, staffId } = await params;
  const { business } = await requireAction(slug, "staff.manage");
  const [{ services, mapped }, categories] = await Promise.all([
    withTenant(business.id, async (tx) => ({
      services: await tx.select({ id: schema.services.id, name: schema.services.name, durationMin: schema.services.durationMin, categoryId: schema.services.categoryId }).from(schema.services).where(eq(schema.services.active, true)).orderBy(asc(schema.services.sortOrder), asc(schema.services.name)),
      mapped: (await tx.select({ serviceId: schema.staffServices.serviceId }).from(schema.staffServices).where(eq(schema.staffServices.staffId, staffId))).map((m) => m.serviceId),
    })),
    listCategories(business.id, "service"),
  ]);
  // One group per category, labelled with its path ("Lashes › Classic"); uncategorised last.
  const groups = new Map<string, PickerGroup>();
  for (const s of services) {
    const key = s.categoryId ?? "none";
    if (!groups.has(key)) groups.set(key, { id: key, name: s.categoryId ? pathTo(categories, s.categoryId).map((c) => c.name).join(" › ") || "Services" : "Uncategorised", services: [] });
    groups.get(key)!.services.push({ id: s.id, name: s.name, durationMin: s.durationMin });
  }
  const ordered = [...groups.values()].sort((a, b) => (a.id === "none" ? 1 : b.id === "none" ? -1 : a.name.localeCompare(b.name)));
  return (
    <Card className="p-4">
      <p className="mb-3 text-sm text-stone-600">Tick what this person performs. Leave everything unticked and they can be booked for any service.</p>
      <form action={saveStaffServices} className="space-y-3">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="staffId" value={staffId} />
        {services.length === 0 ? <p className="text-sm text-stone-500">No services yet.</p> : <StaffServicesPicker groups={ordered} initial={mapped} />}
        <SubmitButton pendingText="Saving…">Save services</SubmitButton>
      </form>
    </Card>
  );
}
