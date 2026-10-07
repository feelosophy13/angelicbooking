import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Lock, Plus } from "lucide-react";
import { requireAction } from "@/lib/tenant";
import { listRoles } from "@/server/roles";
import { BackLink, Card, LinkButton, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Roles & permissions" };

export default async function RolesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "members.manage");
  const roles = await listRoles(business.id);
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Roles & permissions">
        <LinkButton href={`/app/${slug}/settings/roles/new`} variant="primary"><Plus className="h-4 w-4" /> New role</LinkButton>
      </PageHeader>
      <p className="mb-3 max-w-2xl text-sm text-stone-600">A role is a named set of permissions. Assign one to each person with a login on their staff page under Access. Built-in roles can be edited; Owner is locked.</p>
      <Card className="max-w-3xl">
        <ul className="divide-y divide-stone-100">
          {roles.map((r) => (
            <li key={r.id}>
              <Link href={`/app/${slug}/settings/roles/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-stone-50">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-medium">{r.name}{r.key === "owner" ? <Lock className="h-3.5 w-3.5 text-stone-400" aria-label="Locked" /> : null}{r.isSystem ? <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-stone-500">Built-in</span> : null}</p>
                  <p className="truncate text-xs text-stone-500">{r.description ?? ""}</p>
                </div>
                <span className="text-xs text-stone-500">{r.permissions.length} permission{r.permissions.length === 1 ? "" : "s"}</span>
                <span className="w-24 text-right text-xs text-stone-500">{r.members} member{r.members === 1 ? "" : "s"}</span>
                <ChevronRight className="h-4 w-4 text-stone-300" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
