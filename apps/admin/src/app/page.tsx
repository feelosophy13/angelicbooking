import Link from "next/link";
import { Shell, StatusPill, date } from "@/components";
import { listTenants } from "@/lib/tenants";

export const dynamic = "force-dynamic";

export default async function TenantsPage() {
  const tenants = await listTenants();
  const paying = tenants.filter((t) => t.subscriptionStatus === "active").length;
  const trialing = tenants.filter((t) => t.subscriptionStatus === "trialing" || (t.plan === "trial" && t.subscriptionStatus === "none")).length;
  const attention = tenants.filter((t) => ["past_due", "unpaid"].includes(t.subscriptionStatus)).length;

  return (
    <Shell>
      <h1 className="text-xl font-semibold">Tenants</h1>
      <p className="mt-1 text-sm text-stone-600">
        {tenants.length} total · {paying} paying · {trialing} on trial{attention > 0 && <> · <span className="font-medium text-amber-700">{attention} need attention</span></>}
      </p>
      <div className="mt-4 overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-3 py-2">Business</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Plan</th>
              <th className="px-3 py-2 text-right">Clients</th>
              <th className="px-3 py-2 text-right">Appts</th>
              <th className="px-3 py-2">Last booking</th>
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
                <td className="px-3 py-2 text-right tabular-nums">{t.clients}</td>
                <td className="px-3 py-2 text-right tabular-nums">{t.appointments}</td>
                <td className="px-3 py-2">{date(t.lastAppointmentAt)}</td>
                <td className="px-3 py-2">{date(t.createdAt)}</td>
              </tr>
            ))}
            {tenants.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-stone-500">No tenants yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
