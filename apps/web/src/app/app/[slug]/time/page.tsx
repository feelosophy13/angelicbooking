import { and, asc, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { can, instantToISODate } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { formatDateLong, formatTime, shiftISODate } from "@/lib/utils";
import { Button, Card, Field, Input, PageHeader, Select, Empty } from "@/components/ui";
import { addTimeEntry, clockToggle, deleteTimeEntry } from "./actions";

export default async function TimePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, role, user } = await requireBusiness(slug);
  const tz = business.timezone;
  const today = instantToISODate(new Date(), tz);
  const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const from = isDate(sp.from) ? sp.from! : shiftISODate(today, -13);
  const to = isDate(sp.to) ? sp.to! : today;
  const manage = can(role, "staff.manage");

  const data = await withTenant(business.id, async (tx) => {
    const staff = await tx.select().from(schema.staff).where(eq(schema.staff.active, true)).orderBy(asc(schema.staff.displayName));
    const me = staff.find((s) => s.userId === user.id) ?? null;
    const open = me ? await tx.query.timeEntries.findFirst({ where: and(eq(schema.timeEntries.staffId, me.id), isNull(schema.timeEntries.clockOutAt), eq(schema.timeEntries.minutes, 0)) }) : null;
    const entries = await tx
      .select()
      .from(schema.timeEntries)
      .where(and(gte(schema.timeEntries.date, from), lte(schema.timeEntries.date, to), manage ? undefined : eq(schema.timeEntries.staffId, me?.id ?? "-")))
      .orderBy(desc(schema.timeEntries.date), desc(schema.timeEntries.createdAt));
    return { staff, me, open, entries };
  });
  const name = new Map(data.staff.map((s) => [s.id, s.displayName]));
  const totals = new Map<string, number>();
  for (const e of data.entries) totals.set(e.staffId, (totals.get(e.staffId) ?? 0) + e.minutes);

  return (
    <>
      <PageHeader title="Time clock">
        <form className="flex items-center gap-2">
          <Input type="date" name="from" defaultValue={from} className="w-40" />
          <span className="text-sm text-stone-500">to</span>
          <Input type="date" name="to" defaultValue={to} className="w-40" />
          <Button type="submit" variant="secondary" size="sm">Show</Button>
        </form>
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {data.me ? (
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium">{data.me.displayName}</p>
                <p className="text-sm text-stone-600">{data.open?.clockInAt ? `Clocked in at ${formatTime(data.open.clockInAt, tz)}` : "Not clocked in"}</p>
              </div>
              <form action={clockToggle}>
                <input type="hidden" name="slug" value={slug} />
                <Button type="submit" variant={data.open ? "danger" : "primary"}>{data.open ? "Clock out" : "Clock in"}</Button>
              </form>
            </Card>
          ) : null}
          <Card>
            <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">{formatDateLong(from)} – {formatDateLong(to)}</h2>
            {data.entries.length === 0 ? <div className="p-4"><Empty title="No hours recorded" /></div> : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-4 py-2">Date</th><th className="px-4 py-2">Staff</th><th className="px-4 py-2">In / out</th><th className="px-4 py-2 text-right">Hours</th><th className="px-4 py-2">Note</th><th /></tr></thead>
                <tbody className="divide-y divide-stone-100">
                  {data.entries.map((e) => (
                    <tr key={e.id}>
                      <td className="px-4 py-2">{e.date}</td>
                      <td className="px-4 py-2">{name.get(e.staffId)}</td>
                      <td className="px-4 py-2 text-stone-600">{e.clockInAt ? `${formatTime(e.clockInAt, tz)} – ${e.clockOutAt ? formatTime(e.clockOutAt, tz) : "…"}` : "manual"}</td>
                      <td className="px-4 py-2 text-right">{(e.minutes / 60).toFixed(2)}</td>
                      <td className="px-4 py-2 text-stone-600">{e.note ?? ""}</td>
                      <td className="px-2 py-2 text-right">{manage ? <form action={deleteTimeEntry}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={e.id} /><button className="text-xs text-stone-400 hover:text-red-600">✕</button></form> : null}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="text-sm font-medium">
                  {[...totals.entries()].map(([sid, min]) => (
                    <tr key={sid}><td className="px-4 py-1" /><td className="px-4 py-1">{name.get(sid)}</td><td /><td className="px-4 py-1 text-right">{(min / 60).toFixed(2)}</td><td /><td /></tr>
                  ))}
                </tfoot>
              </table>
            )}
          </Card>
        </div>
        {manage ? (
          <Card className="p-4">
            <h2 className="mb-3 font-medium">Add hours manually</h2>
            <form action={addTimeEntry} className="space-y-2">
              <input type="hidden" name="slug" value={slug} />
              <Field label="Staff"><Select name="staffId">{data.staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</Select></Field>
              <Field label="Date"><Input type="date" name="date" defaultValue={today} required /></Field>
              <Field label="Hours"><Input name="hours" type="number" step="0.25" min={0} max={24} required /></Field>
              <Field label="Note"><Input name="note" placeholder="Optional" /></Field>
              <Button type="submit" size="sm" variant="secondary">Add</Button>
            </form>
          </Card>
        ) : null}
      </div>
    </>
  );
}
