import Link from "next/link";
import { and, asc, eq, gt } from "drizzle-orm";
import { db, schema } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { Button, Card, PageHeader, Empty } from "@/components/ui";
import { cancelInvite } from "../actions";
import { InviteForm } from "../invite-form";

export default async function InvitationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "members.manage");
  const invites = await db
    .select()
    .from(schema.invitation)
    .where(and(eq(schema.invitation.organizationId, business.id), eq(schema.invitation.status, "pending"), gt(schema.invitation.expiresAt, new Date())))
    .orderBy(asc(schema.invitation.email));
  return (
    <>
      <PageHeader title="Staff invitations">
        <Link href={`/app/${slug}/staff`} className="text-sm text-brand-700 underline">← Staff</Link>
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Pending</h2>
          {invites.length === 0 ? <div className="p-4"><Empty title="No pending invitations" /></div> : (
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
          )}
        </Card>
        <Card className="p-4">
          <h2 className="mb-1 font-medium">Invite someone to sign in</h2>
          <p className="mb-3 text-xs text-stone-500">They get a link to create their login. If a staff member with that email already exists, the login is attached to them.</p>
          <InviteForm slug={slug} />
        </Card>
      </div>
    </>
  );
}
