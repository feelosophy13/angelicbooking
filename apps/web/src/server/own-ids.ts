import { eq } from "drizzle-orm";
import { schema, type TenantDb } from "@angelic/db";

/**
 * Ids picked in a form must be this business's own. A foreign key alone would accept another business's category, supplier or
 * location (Postgres checks foreign keys without row-level security), so each is looked up under the tenant first.
 */
export async function ownIds(tx: TenantDb, ids: { serviceCategoryId?: string | null; productCategoryId?: string | null; supplierId?: string | null; locationId?: string | null }): Promise<string | null> {
  if (ids.serviceCategoryId && !(await tx.query.serviceCategories.findFirst({ where: eq(schema.serviceCategories.id, ids.serviceCategoryId), columns: { id: true } }))) return "categoryId";
  if (ids.productCategoryId && !(await tx.query.productCategories.findFirst({ where: eq(schema.productCategories.id, ids.productCategoryId), columns: { id: true } }))) return "categoryId";
  if (ids.supplierId && !(await tx.query.suppliers.findFirst({ where: eq(schema.suppliers.id, ids.supplierId), columns: { id: true } }))) return "supplierId";
  if (ids.locationId && !(await tx.query.locations.findFirst({ where: eq(schema.locations.id, ids.locationId), columns: { id: true } }))) return "locationId";
  return null;
}
