import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { can, isMembershipInterval, periodNoun } from "@angelic/core";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { ticketCatalog } from "@/server/sales";
import { listLocations } from "@/server/locations";
import { getOffersCatalog } from "@/server/offers";
import { serviceGroups } from "@/server/service-groups";
import { saleStockLocation, stockLevels } from "@/server/inventory";
import { productLabel } from "@/lib/inventory";
import { formatMoney } from "@/lib/utils";
import { Card, PageHeader, Select } from "@/components/ui";
import { Field } from "@/components/form";
import { Disclosure } from "@/components/disclosure";
import { ClientPicker } from "@/components/client-picker";
import { AutoSubmitForm } from "@/components/auto-submit-form";
import { quickCreateClient } from "../../clients/actions";
import { AddToTicket } from "../[saleId]/add-and-pay";
import { addOffer, addProduct, addProductByCode, addServiceToSale } from "../[saleId]/actions";

export const metadata: Metadata = { title: "New sale" };

/**
 * A blank checkout: pick the client and what is being sold. Nothing is saved until the first item goes on; that add opens the ticket
 * (with its number) and moves on to it. Leaving this page leaves nothing behind.
 */
export default async function NewSalePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ clientId?: string; locationId?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, permissions } = await requireAction(slug, "checkout.take");
  const money = (c: number) => formatMoney(c, business.currency);
  const locations = await listLocations(business.id);
  const location = locations.find((l) => l.id === sp.locationId) ?? locations.find((l) => l.isDefault) ?? locations[0] ?? null;
  const client = sp.clientId ? await withTenant(business.id, (tx) => tx.query.clients.findFirst({ where: eq(schema.clients.id, sp.clientId!), columns: { id: true, firstName: true, lastName: true } })) : null;
  const [{ staff, products }, catalog, groups] = await Promise.all([ticketCatalog(business.id), getOffersCatalog(business.id), serviceGroups(business, { meta: "price" })]);
  const tracked = products.filter((p) => p.trackStock).map((p) => p.id);
  const stockHere = tracked.length ? await withTenant(business.id, async (tx) => stockLevels(tx, await saleStockLocation(tx, { locationId: location?.id ?? null }), tracked)) : new Map<string, number>();

  return (
    <>
      <PageHeader title="New sale" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div className="min-w-0 space-y-6">
          <Card className="p-4">
            <p className="font-medium">{client ? `${client.firstName} ${client.lastName}`.trim() : "Walk-in"}</p>
            <p className="mt-2 text-sm text-stone-500">Nothing on the ticket yet. The sale is saved, with its number, when the first item goes on.</p>
          </Card>
          <Disclosure title="Add to this ticket" defaultOpen>
            <AddToTicket
              slug={slug}
              saleId="new"
              start={{ clientId: client?.id ?? null, locationId: location?.id ?? null }}
              staff={staff.map((s) => ({ id: s.id, name: s.displayName }))}
              products={products.map((p) => ({ id: p.id, label: productLabel(p), category: p.category ?? "Other", priceLabel: money(p.priceCents), stock: p.trackStock ? ((stockHere.get(p.id) ?? 0) <= 0 ? "none in stock" : `${stockHere.get(p.id)} in stock`) : null, out: !!p.trackStock && (stockHere.get(p.id) ?? 0) <= 0, imageUrl: p.imageUrl }))}
              productsHref={`/app/${slug}/products`}
              autoFocus
              groups={groups}
              packages={catalog.packages.filter((p) => p.active).map((p) => ({ id: p.id, label: `${p.name} · ${money(p.priceCents)}` }))}
              plans={client ? catalog.plans.filter((p) => p.active).map((p) => ({ id: p.id, label: `${p.name} · ${money(p.priceCents)} / ${periodNoun(isMembershipInterval(p.interval) ? p.interval : "month", p.intervalCount)}` })) : []}
              actions={{ addProduct, addProductByCode, addService: addServiceToSale, addOffer }}
            />
          </Disclosure>
        </div>

        <div className="min-w-0 space-y-6">
          <Card className="p-4 text-sm">
            <h2 className="mb-1 font-medium">Client</h2>
            <p className="mb-2 text-xs text-stone-500">A client gets loyalty points, saved cards, memberships and an emailed receipt.</p>
            {/* Choosing a client or location only changes the address; still nothing is saved. */}
            <AutoSubmitForm className="space-y-2">
              <ClientPicker key={client?.id ?? "walk-in"} slug={slug} initial={client ? { id: client.id, name: `${client.firstName} ${client.lastName}`.trim() } : null} canCreate={can(permissions, "clients.write")} createClient={quickCreateClient} placeholder="Find or add a client" />
              {locations.length > 1 ? (
                <Field label="Location" name="locationId">
                  <Select name="locationId" defaultValue={location?.id ?? ""}>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </Select>
                </Field>
              ) : null}
            </AutoSubmitForm>
          </Card>
        </div>
      </div>
    </>
  );
}
