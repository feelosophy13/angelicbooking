import { asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import type { ServiceGroup } from "@/components/service-picker";
import { formatMoney } from "@/lib/utils";
import { duration } from "@/lib/format";
import { buildTree, listCategories, pathTo, type AnyCategory, type CategoryNode } from "./categories";

/**
 * Active services grouped by category path ("Lashes › Volume"), ready for the ServicePicker.
 * Pass `note` to flag individual services (e.g. "no one here"); `meta` defaults to duration · price.
 */
export async function serviceGroups(
  business: { id: string; currency: string },
  opts: { meta?: "duration-price" | "price" | "none"; note?: (serviceId: string) => string | null; include?: (serviceId: string) => boolean } = {},
): Promise<ServiceGroup[]> {
  const [services, categories] = await Promise.all([
    withTenant(business.id, (tx) =>
      tx
        .select({ id: schema.services.id, name: schema.services.name, categoryId: schema.services.categoryId, durationMin: schema.services.durationMin, priceCents: schema.services.priceCents })
        .from(schema.services)
        .where(eq(schema.services.active, true))
        .orderBy(asc(schema.services.sortOrder), asc(schema.services.name)),
    ),
    listCategories(business.id, "service"),
  ]);
  const meta = (s: (typeof services)[number]) =>
    opts.meta === "none" ? "" : opts.meta === "price" ? formatMoney(s.priceCents, business.currency) : `${duration(s.durationMin)} · ${formatMoney(s.priceCents, business.currency)}`;
  const groups = new Map<string, ServiceGroup>();
  for (const s of services) {
    if (opts.include && !opts.include(s.id)) continue;
    const key = s.categoryId ?? "none";
    if (!groups.has(key)) groups.set(key, { id: key, name: s.categoryId ? pathTo(categories, s.categoryId).map((c) => c.name).join(" › ") || "Services" : "Other", services: [] });
    groups.get(key)!.services.push({ id: s.id, name: s.name, meta: meta(s), note: opts.note?.(s.id) ?? null });
  }
  return [...groups.values()].sort((a, b) => (a.id === "none" ? 1 : b.id === "none" ? -1 : a.name.localeCompare(b.name)));
}

/** A category subtree with the services at each level; empty branches are pruned. */
export type ServiceTreeNode = { id: string; name: string; services: { id: string; name: string }[]; children: ServiceTreeNode[] };

/** The service menu as a category tree (parents, children, uncategorised last) for multi-service pickers. */
export async function serviceTree(business: { id: string }): Promise<ServiceTreeNode[]> {
  const [services, categories] = await Promise.all([
    withTenant(business.id, (tx) =>
      tx.select({ id: schema.services.id, name: schema.services.name, categoryId: schema.services.categoryId }).from(schema.services).where(eq(schema.services.active, true)).orderBy(asc(schema.services.sortOrder), asc(schema.services.name)),
    ),
    listCategories(business.id, "service"),
  ]);
  const byCat = new Map<string | null, { id: string; name: string }[]>();
  for (const s of services) byCat.set(s.categoryId, [...(byCat.get(s.categoryId) ?? []), { id: s.id, name: s.name }]);
  const ids = new Set(categories.map((c) => c.id));
  const convert = (nodes: CategoryNode<AnyCategory>[]): ServiceTreeNode[] =>
    nodes
      .map((n) => ({ id: n.id, name: n.name, services: byCat.get(n.id) ?? [], children: convert(n.children) }))
      .filter((n) => n.services.length || n.children.length);
  const tree = convert(buildTree(categories));
  // Services whose category is missing or null.
  const loose = services.filter((s) => !s.categoryId || !ids.has(s.categoryId)).map((s) => ({ id: s.id, name: s.name }));
  if (loose.length) tree.push({ id: "none", name: "Other", services: loose, children: [] });
  return tree;
}
