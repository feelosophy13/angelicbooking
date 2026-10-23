import { and, asc, eq, gt, isNotNull } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import type { ServiceGroup } from "@/components/service-picker";
import { productLabel } from "@/lib/inventory";
import { formatMoney } from "@/lib/utils";
import { listLocations } from "@/server/locations";
import { serviceGroups } from "@/server/service-groups";
import type { InvoiceFieldsProps } from "./invoice-fields";

type Business = typeof schema.businesses.$inferSelect;

/** What the invoice editor offers: the menu, retail products, staff, locations and the prices to preview the total with. */
export async function invoiceEditorData(business: Business): Promise<Omit<InvoiceFieldsProps, "slug" | "canCreateClient" | "initial" | "defaultClient" | "defaultDueOn">> {
  const [groups, rows, locations] = await Promise.all([
    serviceGroups(business, { meta: "price" }),
    withTenant(business.id, async (tx) => {
      const [services, products, staff, overrides] = await Promise.all([
        tx.select({ id: schema.services.id, priceCents: schema.services.priceCents }).from(schema.services).where(eq(schema.services.active, true)),
        tx
          .select({ p: schema.products, category: schema.productCategories.name })
          .from(schema.products)
          .leftJoin(schema.productCategories, eq(schema.productCategories.id, schema.products.categoryId))
          .where(and(eq(schema.products.active, true), eq(schema.products.kind, "retail"), gt(schema.products.priceCents, 0)))
          .orderBy(asc(schema.productCategories.sortOrder), asc(schema.products.name)),
        tx.select({ id: schema.staff.id, name: schema.staff.displayName }).from(schema.staff).where(eq(schema.staff.active, true)).orderBy(asc(schema.staff.displayName)),
        tx.select({ staffId: schema.staffServices.staffId, serviceId: schema.staffServices.serviceId, cents: schema.staffServices.priceCentsOverride }).from(schema.staffServices).where(isNotNull(schema.staffServices.priceCentsOverride)),
      ]);
      return { services, products, staff, overrides };
    }),
    listLocations(business.id),
  ]);
  const byCat = new Map<string, ServiceGroup>();
  for (const { p, category } of rows.products) {
    const name = category ?? "Products";
    if (!byCat.has(name)) byCat.set(name, { id: name, name, services: [] });
    byCat.get(name)!.services.push({ id: p.id, name: productLabel(p), meta: formatMoney(p.priceCents, business.currency) });
  }
  return {
    currency: business.currency,
    serviceGroups: groups,
    servicePrices: Object.fromEntries(rows.services.map((s) => [s.id, s.priceCents])),
    staffPrices: Object.fromEntries(rows.overrides.map((o) => [`${o.staffId}:${o.serviceId}`, o.cents!])),
    productGroups: [...byCat.values()],
    products: Object.fromEntries(rows.products.map(({ p }) => [p.id, { priceCents: p.priceCents, taxable: p.taxable }])),
    staff: rows.staff,
    // The main site first: a new invoice starts there.
    locations: [...locations].sort((a, b) => Number(b.isDefault) - Number(a.isDefault)).map((l) => ({ id: l.id, name: l.name, taxRateBps: l.taxRateBps ?? business.taxRateBps })),
    defaultTaxRateBps: business.taxRateBps,
  };
}
