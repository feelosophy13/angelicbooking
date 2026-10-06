import Link from "next/link";
import { asc } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { can } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { Button, Card, Field, Input, PageHeader } from "@/components/ui";
import { createStaff, toggleStaffActive } from "./actions";

export default async function StaffPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, role } = await requireBusiness(slug);
  const rows = await withTenant(business.id, (tx) =>
    tx.select().from(schema.staff).orderBy(asc(schema.staff.active), asc(schema.staff.sortOrder), asc(schema.staff.displayName)),
  );
  const manage = can(role, "staff.manage");

  return (
    <>
      <PageHeader title="Staff" />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <ul className="divide-y divide-stone-200">
            {rows.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.color }} />
                <div className="min-w-0 flex-1">
                  <Link href={`/app/${slug}/staff/${s.id}`} className="font-medium hover:underline">{s.displayName}</Link>
                  <p className="truncate text-xs text-stone-500">{s.email ?? "no email"}{s.active ? "" : " · inactive"}</p>
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
            ))}
          </ul>
        </Card>
        {manage ? (
          <Card className="p-4">
            <h2 className="mb-3 font-medium">Add staff member</h2>
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
      </div>
    </>
  );
}
