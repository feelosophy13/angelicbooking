import Link from "next/link";
import { and, asc, eq, gt } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { can } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { Button, Card, Field, Input, PageHeader } from "@/components/ui";
import { cancelInvite, createStaff, toggleStaffActive } from "./actions";
import { InviteForm } from "./invite-form";

export default async function StaffPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, role } = await requireBusiness(slug);
  const manage = can(role, "staff.manage");
  const manageMembers = can(role, "members.manage");

  const [rows, members, invites] = await Promise.all([
    withTenant(business.id, (tx) =>
      tx.select().from(schema.staff).orderBy(asc(schema.staff.active), asc(schema.staff.sortOrder), asc(schema.staff.displayName)),
    ),
    db.select({ userId: schema.member.userId, role: schema.member.role }).from(schema.member).where(eq(schema.member.organizationId, business.id)),
    manageMembers
      ? db
          .select()
          .from(schema.invitation)
          .where(and(eq(schema.invitation.organizationId, business.id), eq(schema.invitation.status, "pending"), gt(schema.invitation.expiresAt, new Date())))
          .orderBy(asc(schema.invitation.email))
      : Promise.resolve([]),
  ]);
  const roleByUser = new Map(members.map((m) => [m.userId, m.role]));

  return (
    <>
      <PageHeader title="Staff" />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card>
            <ul className="divide-y divide-stone-200">
              {rows.map((s) => {
                const memberRole = s.userId ? roleByUser.get(s.userId) : null;
                return (
                  <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.color }} />
                    <div className="min-w-0 flex-1">
                      <Link href={`/app/${slug}/staff/${s.id}`} className="font-medium hover:underline">{s.displayName}</Link>
                      <p className="truncate text-xs text-stone-500">
                        {s.email ?? "no email"}
                        {memberRole ? ` · ${memberRole.replace("_", " ")} (has login)` : " · no login yet"}
                        {s.active ? "" : " · inactive"}
                      </p>
                    </div>
                    {manage ? (
                      <form action={toggleStaffActive}>
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="staffId" value={s.id} />
                        <input type="hidden" name="active" value={s.active ? "false" : "true"} />
                        <Button size="sm" variant="ghost" type="submit">{s.active ? "Deactivate" : "Reactivate"}</Button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>

          {manageMembers && invites.length > 0 ? (
            <Card>
              <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Pending invitations</h2>
              <ul className="divide-y divide-stone-200">
                {invites.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{inv.email}</p>
                      <p className="text-xs text-stone-500">{inv.role?.replace("_", " ")} · expires {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(inv.expiresAt)}</p>
                    </div>
                    <input readOnly value={`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/invite/${inv.id}`} className="w-72 rounded border border-stone-300 bg-stone-50 px-2 py-1 text-xs" />
                    <form action={cancelInvite}>
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="invitationId" value={inv.id} />
                      <Button size="sm" variant="ghost" type="submit">Revoke</Button>
                    </form>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          {manage ? (
            <Card className="p-4">
              <h2 className="mb-3 font-medium">Add staff member</h2>
              <p className="mb-3 text-xs text-stone-500">Creates a calendar column. Invite them below if they need to sign in.</p>
              <form action={createStaff} className="space-y-3">
                <input type="hidden" name="slug" value={slug} />
                <Field label="Name"><Input name="displayName" required /></Field>
                <Field label="Email"><Input name="email" type="email" /></Field>
                <Field label="Phone"><Input name="phone" /></Field>
                <Field label="Calendar colour"><Input name="color" type="color" defaultValue="#6366f1" className="h-10 p-1" /></Field>
                <Button type="submit" className="w-full">Add</Button>
              </form>
            </Card>
          ) : null}
          {manageMembers ? (
            <Card className="p-4">
              <h2 className="mb-3 font-medium">Invite to sign in</h2>
              <InviteForm slug={slug} />
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
