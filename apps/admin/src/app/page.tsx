import Link from "next/link";
import { Shell, StatusPill, date } from "@/components";
import { money } from "@/lib/price-form";
import { listTenantsWithBills } from "@/lib/tenants";

export const dynamic = "force-dynamic";

export default async function TenantsPage() {
  const { tenants } = await listTenantsWithBills();
  const paying = tenants.filter((t) => t.subscriptionStatus === "active").length;
  const trialing = tenants.filter((t) => t.subscriptionStatus === "trialing" || (t.plan === "trial" && t.subscriptionStatus === "none")).length;
  const attention = tenants.filter((t) => ["past_due", "unpaid"].includes(t.subscriptionStatus)).length;
  const estimated = tenants.reduce((s, t) => s + t.bill.totalCents, 0);

  return (
    <Shell>
      <h1 className="text-xl font-semibold">Tenants</h1>
      <p className="mt-1 text-sm text-stone-600">
        {tenants.length} total · {paying} paying · {trialing} on trial{attention > 0 && <> · <span className="font-medium text-amber-700">{attention} need attention</span></>}
        {" · "}{money(estimated)}/mo if everyone paid the <Link href="/pricing" className="underline">price book</Link>
      </p>
      <div className="mt-4 overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-3 py-2">Business</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Plan</th>
              <th className="px-3 py-2 text-right">Locations</th>
              <th className="px-3 py-2 text-right">Staff</th>
              <th className="px-3 py-2 text-right">Clients</th>
              <th className="px-3 py-2 text-right">Texts 30d</th>
              <th className="px-3 py-2 text-right">Est. / month</th>
              <th className="px-3 py-2">Signed up</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                <td className="p-0">
                  <Link href={`/tenants/${t.id}`} className="block px-3 py-2">
                    <span className="font-medium">{t.name}</span>
                    <span className="block text-xs text-stone-500">{t.slug}</span>
                  </Link>
                </td>
                <td className="px-3 py-2">{t.ownerEmail ?? "—"}</td>
                <td className="px-3 py-2"><span className="mr-2 capitalize">{t.plan}</span><StatusPill status={t.subscriptionStatus} /></td>
                <td className="px-3 py-2 text-right tabular-nums">{t.locations}</td>
                <td className="px-3 py-2 text-right tabular-nums">{t.activeStaff}</td>
                <td className="px-3 py-2 text-right tabular-nums">{t.clients}</td>
                <td className="px-3 py-2 text-right tabular-nums">{t.sms30d}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {money(t.bill.totalCents)}
                  {t.hasOverrides && <span title="Custom pricing" className="ml-1 rounded bg-violet-100 px-1 text-xs text-violet-800">custom</span>}
                </td>
                <td className="px-3 py-2">{date(t.createdAt)}</td>
              </tr>
            ))}
            {tenants.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-stone-500">No tenants yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
