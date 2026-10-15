import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight, Mail, Plus } from "lucide-react";

export const metadata: Metadata = { title: "Staff" };
import { asc, desc, eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { can } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { staffLocationIndex } from "@/server/locations";
import { listRoles } from "@/server/roles";
import { Card, LinkButton, PageHeader } from "@/components/ui";
import { moveStaffAction } from "./actions";

export default async function StaffPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, permissions } = await requireBusiness(slug);
  const [rows, locations, members, locIndex] = await Promise.all([
    withTenant(business.id, (tx) => tx.select().from(schema.staff).orderBy(desc(schema.staff.active), asc(schema.staff.sortOrder), asc(schema.staff.displayName))),
    withTenant(business.id, (tx) => tx.select({ id: schema.locations.id, name: schema.locations.name }).from(schema.locations)),
    db.select({ userId: schema.member.userId, role: schema.member.role }).from(schema.member).where(eq(schema.member.organizationId, business.id)),
    withTenant(business.id, (tx) => staffLocationIndex(tx)),
  ]);
  const roles = await listRoles(business.id);
  const roleName = (key: string) => roles.find((r) => r.key === key)?.name ?? key;
  const roleByUser = new Map(members.map((m) => [m.userId, m.role]));
  const locationName = (id: string | null) => (id ? locations.find((l) => l.id === id)?.name ?? null : null);
  const multiLocation = locations.length > 1;
  const canReorder = can(permissions, "staff.manage");
  const activeIds = rows.filter((r) => r.active).map((r) => r.id);
  const firstActive = activeIds[0];
  const lastActive = activeIds[activeIds.length - 1];
  const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  /** "Sterling Mon–Wed · Fairfax Thu–Sat" from the weekly hours; falls back to the primary location. */
  const whereWorks = (staffId: string, primary: string | null) => {
    const days = locIndex.byDay.get(staffId);
    if (!days?.size) return locationName(primary) ?? "any location";
    const byLoc = new Map<string, number[]>();
    for (const [wd, locs] of [...days.entries()].sort((a, b) => ((a[0] + 6) % 7) - ((b[0] + 6) % 7))) for (const loc of locs) if (loc) byLoc.set(loc, [...(byLoc.get(loc) ?? []), wd]);
    const span = (wds: number[]) => {
      const out: string[] = [];
      for (let i = 0; i < wds.length; ) {
        let j = i;
        while (j + 1 < wds.length && ((wds[j + 1]! - wds[j]! + 7) % 7) === 1) j++;
        out.push(j > i + 1 ? `${DAY[wds[i]!]}–${DAY[wds[j]!]}` : wds.slice(i, j + 1).map((d) => DAY[d]).join(", "));
        i = j + 1;
      }
      return out.join(", ");
    };
    return [...byLoc.entries()].map(([loc, wds]) => `${(locationName(loc) ?? "?").replace(/^.*? - /, "")} ${span(wds)}`).join(" · ");
  };
  return (
    <>
      <PageHeader title="Staff">
        {can(permissions, "members.manage") ? <LinkButton href={`/app/${slug}/staff/invitations`}><Mail className="h-4 w-4" /> Invitations</LinkButton> : null}
        {can(permissions, "staff.manage") ? <LinkButton href={`/app/${slug}/staff/new`} variant="primary"><Plus className="h-4 w-4" /> New staff member</LinkButton> : null}
      </PageHeader>
      {canReorder ? <p className="mb-3 text-sm text-stone-600">The order here is the order clients see providers on the booking page. Use the arrows to move someone up.</p> : null}
      <Card>
        <ul className="divide-y divide-stone-200">
          {rows.map((s) => {
            const memberRole = s.userId ? roleByUser.get(s.userId) : null;
            return (
              <li key={s.id} className="flex items-center hover:bg-stone-50">
                <Link href={`/app/${slug}/staff/${s.id}`} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
                  {s.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.photoUrl} alt="" className="h-9 w-9 shrink-0 rounded-full border border-stone-200 object-cover" />
                  ) : (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ background: s.color }}>{s.displayName.slice(0, 1)}</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`font-medium ${s.active ? "" : "text-stone-400"}`}>{s.displayName}{s.active ? "" : " · inactive"}</p>
                    <p className="truncate text-xs text-stone-500">
                      {[s.fullName && s.fullName.trim() !== s.displayName ? s.fullName : null, s.position, multiLocation && s.takesAppointments ? whereWorks(s.id, s.locationId) : multiLocation ? locationName(s.locationId) : null, s.email ?? "no email", memberRole ? `${roleName(memberRole)} (has login)` : "no login yet", s.takesAppointments ? null : "no calendar column"].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-stone-300" />
                </Link>
                {canReorder && s.active ? (
                  <form action={moveStaffAction} className="flex gap-0.5 pr-3">
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="staffId" value={s.id} />
                    <button name="dir" value="up" disabled={s.id === firstActive} aria-label={`Move ${s.displayName} up`} className="rounded px-1.5 text-stone-500 hover:bg-stone-100 disabled:opacity-30">↑</button>
                    <button name="dir" value="down" disabled={s.id === lastActive} aria-label={`Move ${s.displayName} down`} className="rounded px-1.5 text-stone-500 hover:bg-stone-100 disabled:opacity-30">↓</button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
