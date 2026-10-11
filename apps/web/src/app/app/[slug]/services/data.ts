import { asc } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { listCategories, type AnyCategory } from "@/server/categories";

/** Everything the services admin pages need in one round trip. */
export async function loadServicesAdmin(businessId: string) {
  const [services, categories, locations, offered] = await Promise.all([
    withTenant(businessId, (tx) => tx.select().from(schema.services).orderBy(asc(schema.services.sortOrder), asc(schema.services.name))),
    listCategories(businessId, "service"),
    withTenant(businessId, (tx) => tx.select({ id: schema.locations.id, name: schema.locations.name }).from(schema.locations)),
    withTenant(businessId, (tx) => tx.select({ serviceId: schema.serviceLocations.serviceId, locationId: schema.serviceLocations.locationId }).from(schema.serviceLocations)),
  ]);
  const onlyAt = (serviceId: string) => {
    if (locations.length < 2) return "";
    const ids = offered.filter((o) => o.serviceId === serviceId).map((o) => o.locationId);
    if (!ids.length || ids.length >= locations.length) return "";
    return ` · ${ids.map((id) => locations.find((l) => l.id === id)?.name.replace(/^.*? - /, "") ?? "?").join(", ")} only`;
  };
  return { services, categories: categories as (AnyCategory & { parentId: string | null; description: string | null; imageUrl: string | null })[], locations, onlyAt };
}

/** "3 services · 2 sub-categories", counting the whole subtree. */
export function categoryMeta(count: number, subs: number) {
  const parts = [`${count} service${count === 1 ? "" : "s"}`];
  if (subs) parts.push(`${subs} sub-categor${subs === 1 ? "y" : "ies"}`);
  return parts.join(" · ");
}
