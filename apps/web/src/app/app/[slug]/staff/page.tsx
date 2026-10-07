import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { can } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { Card, LinkButton, PageHeader } from "@/components/ui";

export default async function StaffPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, role } = await requireBusiness(slug);
  const [rows, members] = await Promise.all([
    withTenant(business.id, (tx) =>
      tx.select().from(schema.staff).orderBy(asc(schema.staff.active), asc(schema.staff.sortOrder), asc(schema.staff.displayName)),
    ),
    db.select({ userId: schema.member.userId, role: schema.member.role }).from(schema.member).where(eq(schema.member.organizationId, business.id)),
  ]);
  const roleByUser = new Map(members.map((m) => [m.userId, m.role]));
  return (
    <>
      <PageHeader title="Staff">
        {can(role, "members.manage") ? <LinkButton href={`/app/${slug}/staff/invitations`}>Invitations</LinkButton> : null}
        {can(role, "staff.manage") ? <LinkButton href={`/app/${slug}/staff/new`} variant="primary">+ New staff member</LinkButton> : null}
      </PageHeader>
      <Card>
        <ul className="divide-y divide-stone-200">
          {rows.map((s) => {
            const memberRole = s.userId ? roleByUser.get(s.userId) : null;
            return (
              <li key={s.id}>
                <Link href={`/app/${slug}/staff/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-stone-50">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.color }} />
                  <div className="min-w-0 flex-1">
                    <p className={`font-medium ${s.active ? "" : "text-stone-400"}`}>{s.displayName}{s.active ? "" : " · inactive"}</p>
                    <p className="truncate text-xs text-stone-500">
                      {[s.position, s.email ?? "no email", memberRole ? `${memberRole.replace("_", " ")} (has login)` : "no login yet"].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span className="text-stone-300">›</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
