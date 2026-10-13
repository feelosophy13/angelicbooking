import { asc, eq, inArray } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import type { ServiceGroup } from "@/components/service-picker";
import { formatMoney } from "@/lib/utils";
import { duration } from "@/lib/format";
import { buildTree, listCategories, pathTo, subtreeIds, type AnyCategory, type CategoryNode } from "./categories";

type GroupOpts = { meta?: "duration-price" | "price" | "none"; note?: (serviceId: string) => string | null; include?: (serviceId: string) => boolean; /** Add an "All of <category>" row to each category that contains an included service, at any depth. */ categories?: boolean };
type ServiceRow = { id: string; name: string; categoryId: string | null; durationMin: number; priceCents: number };

/** The pure part of `serviceGroups`: group services by category path, optionally with whole-category rows (value `c:<id>`). */
export function groupServices(services: ServiceRow[], categories: AnyCategory[], currency: string, opts: GroupOpts = {}): ServiceGroup[] {
  const meta = (s: ServiceRow) =>
    opts.meta === "none" ? "" : opts.meta === "price" ? formatMoney(s.priceCents, currency) : `${duration(s.durationMin)} · ${formatMoney(s.priceCents, currency)}`;
  const nameOf = (categoryId: string) => pathTo(categories, categoryId).map((c) => c.name).join(" › ") || "Services";
  const groups = new Map<string, ServiceGroup>();
  const ensure = (key: string, name: string) => { if (!groups.has(key)) groups.set(key, { id: key, name, services: [] }); return groups.get(key)!; };
  for (const s of services) {
    if (opts.include && !opts.include(s.id)) continue;
    ensure(s.categoryId ?? "none", s.categoryId ? nameOf(s.categoryId) : "Other").services.push({ id: s.id, name: s.name, meta: meta(s), note: opts.note?.(s.id) ?? null });
    if (opts.categories && s.categoryId) {
      // Every category above the service gets a "whole category" row, even one that only holds sub-categories.
      for (const c of pathTo(categories, s.categoryId)) {
        const g = ensure(c.id, nameOf(c.id));
        g.whole ??= { id: `c:${c.id}`, name: `All of ${c.name}`, meta: "" };
      }
    }
  }
  return [...groups.values()].sort((a, b) => (a.id === "none" ? 1 : b.id === "none" ? -1 : a.name.localeCompare(b.name)));
}

/**
 * Active services grouped by category path ("Lashes › Volume"), ready for the ServicePicker.
 * Pass `note` to flag individual services (e.g. "no one here"); `meta` defaults to duration · price.
 */
export async function serviceGroups(business: { id: string; currency: string }, opts: GroupOpts = {}): Promise<ServiceGroup[]> {
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
  return groupServices(services, categories, business.currency, opts);
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

/**
 * The service ids a filter value covers: one service, or every service in a category and its sub-categories
 * (retired services included, since old visits and sales still point at them). null means "no filter".
 */
export async function serviceIdsInScope(businessId: string, value: string | null | undefined): Promise<string[] | null> {
  if (!value) return null;
  if (!value.startsWith("c:")) return [value];
  const ids = subtreeIds(await listCategories(businessId, "service"), value.slice(2));
  if (ids.length === 0) return [];
  const rows = await withTenant(businessId, (tx) => tx.select({ id: schema.services.id }).from(schema.services).where(inArray(schema.services.categoryId, ids)));
  return rows.map((r) => r.id);
}
