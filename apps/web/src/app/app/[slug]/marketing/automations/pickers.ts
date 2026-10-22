import { asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { listCategories } from "@/server/categories";
import { listLocations } from "@/server/locations";
import { listSavedDesigns } from "@/server/email-designs";
import type { Pickers } from "./workflow-form";

export async function loadPickers(businessId: string): Promise<Pickers> {
  const [services, categories, locations, staff, designs] = await Promise.all([
    withTenant(businessId, (tx) => tx.select({ id: schema.services.id, name: schema.services.name }).from(schema.services).where(eq(schema.services.active, true)).orderBy(asc(schema.services.name))),
    listCategories(businessId, "service"),
    listLocations(businessId),
    withTenant(businessId, (tx) => tx.select({ id: schema.staff.id, name: schema.staff.displayName }).from(schema.staff).where(eq(schema.staff.takesAppointments, true)).orderBy(asc(schema.staff.displayName))),
    listSavedDesigns(businessId),
  ]);
  return { services, categories, locations: locations.map((l) => ({ id: l.id, name: l.name })), staff, designs: designs.map((d) => ({ id: d.id, name: d.name })) };
}
