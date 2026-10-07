import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { listMembers, listRoles } from "@/server/roles";
import { Button, Card, Select } from "@/components/ui";
import { ConfirmSubmit } from "@/components/form";
import { changeMemberRole, revokeAccess } from "./actions";

export default async function StaffAccessPage({ params }: { params: Promise<{ slug: string; staffId: string }> }) {
  const { slug, staffId } = await params;
  const { business, user } = await requireAction(slug, "members.manage");
  const person = await withTenant(business.id, (tx) => tx.query.staff.findFirst({ where: eq(schema.staff.id, staffId) }));
  if (!person) notFound();
  const [members, roles] = await Promise.all([listMembers(business.id), listRoles(business.id)]);
  const member = person.userId ? members.find((m) => m.userId === person.userId) : null;
  const roleName = (key: string) => roles.find((r) => r.key === key)?.name ?? key;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card className="p-5">
        {member ? (
          <>
            <h2 className="mb-1 font-medium">Login</h2>
            <p className="text-sm text-stone-700">{member.name} · {member.email}</p>
            <p className="mb-4 text-xs text-stone-500">Member since {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(member.createdAt)}{member.userId === user.id ? " · this is you" : ""}</p>
            <form action={changeMemberRole} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="staffId" value={staffId} />
              <input type="hidden" name="memberId" value={member.id} />
              <div className="min-w-64">
                <label className="mb-1 block text-sm font-medium text-stone-700">Role</label>
                <Select name="role" defaultValue={member.role}>
                  {roles.map((r) => <option key={r.id} value={r.key}>{r.name}{r.description ? ` — ${r.description}` : ""}</option>)}
                </Select>
              </div>
              <Button type="submit" variant="secondary">Change role</Button>
            </form>
            <p className="mt-3 text-xs text-stone-500">Currently <span className="font-medium">{roleName(member.role)}</span>. <Link href={`/app/${slug}/settings/roles`} className="underline">Edit what each role can do</Link>.</p>
            {member.userId !== user.id ? (
              <form action={revokeAccess} className="mt-6 border-t border-stone-200 pt-4">
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="staffId" value={staffId} />
                <input type="hidden" name="memberId" value={member.id} />
                <ConfirmSubmit title={`Remove ${member.name}'s access?`} body="They stay on the calendar as a staff member but can no longer sign in to this business. You can invite them again later." confirmLabel="Remove access" variant="danger">Remove access</ConfirmSubmit>
              </form>
            ) : null}
          </>
        ) : (
          <>
            <h2 className="mb-1 font-medium">No login yet</h2>
            <p className="mb-4 text-sm text-stone-600">{person.displayName} appears on the calendar but can't sign in. Send an invitation to their email and pick the role they should have.</p>
            <Link href={`/app/${slug}/staff/invitations${person.email ? `?email=${encodeURIComponent(person.email)}` : ""}`} className="inline-flex h-10 items-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">Invite {person.displayName.split(" ")[0]}</Link>
          </>
        )}
      </Card>
      <Card className="p-4 text-sm">
        <h2 className="mb-2 font-medium">Roles in this business</h2>
        <ul className="space-y-2">
          {roles.map((r) => (
            <li key={r.id}><Link href={`/app/${slug}/settings/roles/${r.id}`} className="font-medium hover:underline">{r.name}</Link><p className="text-xs text-stone-500">{r.description}</p></li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
