import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { Card, Input, MoneyInput } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { formatMoney } from "@/lib/utils";
import { saveServiceStylistTerms } from "../actions";

/**
 * Every stylist who performs this service with their own price and minutes, in one table.
 * Blank means the service's own; the placeholder shows what that is.
 */
export async function PricesByStylist({ slug, businessId, currency, service }: { slug: string; businessId: string; currency: string; service: { id: string; priceCents: number; durationMin: number } }) {
  const rows = await withTenant(businessId, (tx) =>
    tx
      .select({ staffId: schema.staff.id, name: schema.staff.displayName, active: schema.staff.active, price: schema.staffServices.priceCentsOverride, duration: schema.staffServices.durationMinOverride })
      .from(schema.staffServices)
      .innerJoin(schema.staff, eq(schema.staff.id, schema.staffServices.staffId))
      .where(and(eq(schema.staffServices.serviceId, service.id), eq(schema.staff.active, true)))
      .orderBy(schema.staff.sortOrder, schema.staff.displayName),
  );
  return (
    <Card className="mt-6 max-w-2xl p-5">
      <h2 className="font-medium">Prices by stylist</h2>
      <p className="mb-3 text-sm text-stone-600">The service is {formatMoney(service.priceCents, currency)} and {service.durationMin} min. Give a stylist their own price or time here; blank means the standard one. Existing appointments keep the price they were booked at.</p>
      {rows.length === 0 ? (
        <p className="text-sm text-stone-500">No one is assigned to this service, so anyone can be booked for it at the standard price. To give a stylist their own price, tick this service under their <Link href={`/app/${slug}/staff`} className="underline">Services tab</Link>.</p>
      ) : (
        <form action={saveServiceStylistTerms} className="space-y-3">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="serviceId" value={service.id} />
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500"><tr><th className="py-1 pr-3">Stylist</th><th className="px-3 py-1">Price</th><th className="px-3 py-1">Minutes</th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => (
                <tr key={r.staffId}>
                  <td className="py-2 pr-3 font-medium"><input type="hidden" name="staffIds" value={r.staffId} />{r.name}</td>
                  <td className="px-3 py-2"><div className="w-32"><MoneyInput currency={currency} name={`price_${r.staffId}`} defaultValue={r.price != null ? (r.price / 100).toFixed(2) : ""} placeholder={(service.priceCents / 100).toFixed(2)} className="h-9" aria-label={`${r.name} price`} /></div></td>
                  <td className="px-3 py-2"><Input name={`duration_${r.staffId}`} type="number" min={5} max={600} step={5} defaultValue={r.duration ?? ""} placeholder={String(service.durationMin)} className="h-9 w-20" aria-label={`${r.name} minutes`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <SubmitButton pendingText="Saving…">Save prices by stylist</SubmitButton>
        </form>
      )}
    </Card>
  );
}
