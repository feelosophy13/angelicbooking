import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { requireAction } from "@/lib/tenant";
import { listSuppliers } from "@/server/inventory";
import { Button, Card, Empty, LinkButton } from "@/components/ui";
import { rowClass, rowControl, RowLink } from "@/components/row";
import { toggleSupplier } from "../actions";

export const metadata: Metadata = { title: "Suppliers · Inventory" };

export default async function SuppliersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "inventory.manage");
  const suppliers = await listSuppliers(business.id, { includeInactive: true });
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><LinkButton href={`/app/${slug}/inventory/suppliers/new`} variant="primary" size="sm"><Plus className="h-4 w-4" /> New supplier</LinkButton></div>
      {suppliers.length === 0 ? (
        <Empty title="No suppliers yet" body="Add who you buy from, then set a usual supplier on each product so reorders group by supplier." action={{ href: `/app/${slug}/inventory/suppliers/new`, label: "Add a supplier" }} />
      ) : (
        <Card>
          <ul className="divide-y divide-stone-100">
            {suppliers.map((s) => (
              <li key={s.id} className={`${rowClass} flex items-center gap-3 px-4 py-3`}>
                <div className="min-w-0 flex-1">
                  <RowLink href={`/app/${slug}/inventory/suppliers/${s.id}`} className={`font-medium ${s.active ? "" : "text-stone-400 line-through"}`}>{s.name}</RowLink>
                  <p className="truncate text-xs text-stone-500">{[s.contactName, s.email, s.phone].filter(Boolean).join(" · ") || "No contact details"} · {s.products} product{s.products === 1 ? "" : "s"}</p>
                </div>
                <form action={toggleSupplier} className={rowControl}>
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="supplierId" value={s.id} />
                  <input type="hidden" name="active" value={s.active ? "false" : "true"} />
                  <Button size="sm" variant="ghost" type="submit">{s.active ? "Hide" : "Show"}</Button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
