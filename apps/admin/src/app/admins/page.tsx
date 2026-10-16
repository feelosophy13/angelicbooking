import type { Metadata } from "next";
import { Shell, dateTime } from "@/components";
import { requireAdmin } from "@/lib/admin";
import { listAdmins } from "@/lib/credentials";
import { Badge, Card, PageHeader } from "@/ui/kit";
import { InviteForm, ToggleDisabled } from "./admin-controls";

export const metadata: Metadata = { title: "Admins" };
export const dynamic = "force-dynamic";

export default async function AdminsPage() {
  const me = await requireAdmin();
  const admins = await listAdmins();
  return (
    <Shell>
      <PageHeader title="Admins" subtitle="Who can sign in to this app. Everything they change is recorded under their email in Activity." />
      <div className="space-y-6">
        <Card title="Add an admin">
          <InviteForm />
          <p className="mt-2 text-xs text-ink-3">They get an emailed link to choose a password, or can sign in with Google using the same email.</p>
        </Card>
        <Card pad={false}>
          <ul className="divide-y divide-line text-sm">
            {admins.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
                <span className="min-w-0">
                  <span className="font-medium">{a.name || a.email}</span>
                  {a.name ? <span className="ml-2 text-ink-3">{a.email}</span> : null}
                  <span className="ml-2 inline-flex gap-1.5 align-middle">
                    {a.disabledAt ? <Badge tone="warn">Disabled</Badge> : null}
                    {!a.passwordHash && !a.disabledAt ? <Badge tone="info" title="No password yet: Google sign-in only, or waiting for them to use the emailed link">No password yet</Badge> : null}
                  </span>
                </span>
                <span className="flex items-center gap-4 text-xs text-ink-3">
                  <span>{a.lastLoginAt ? `Last sign-in ${dateTime(a.lastLoginAt)}` : "Never signed in"}</span>
                  <ToggleDisabled id={a.id} disabled={!!a.disabledAt} self={a.id === me.id} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Shell>
  );
}
