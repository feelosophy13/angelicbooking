import { and, asc, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { can, instantToISODate } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { formatDateLong, formatTime, shiftISODate } from "@/lib/utils";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { Button, Card, Input, LinkButton, PageHeader, Empty } from "@/components/ui";
import { ConfirmSubmit } from "@/components/form";
import { dateShort, hours as fmtHours } from "@/lib/format";

export const metadata: Metadata = { title: "Time clock" };
import { clockToggle, deleteTimeEntry, editTimeEntry, rotateClockToken } from "./actions";
import { listLocations } from "@/server/locations";
import { ensureClockToken } from "@/server/time-clock";
import { appUrl } from "@/lib/stripe";
import QRCode from "qrcode";

export default async function TimePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, permissions, user } = await requireBusiness(slug);
  const tz = business.timezone;
  const today = instantToISODate(new Date(), tz);
  const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const from = isDate(sp.from) ? sp.from! : shiftISODate(today, -13);
  const to = isDate(sp.to) ? sp.to! : today;
  // Three things, three permissions (S3): everyone's rows (time.view.all), correcting rows (time.edit), the kiosk QR codes (staff.manage).
  const viewAll = can(permissions, "time.view.all");
  const edit = can(permissions, "time.edit");
  const manage = can(permissions, "staff.manage");

  const data = await withTenant(business.id, async (tx) => {
    const staff = await tx.select().from(schema.staff).where(eq(schema.staff.active, true)).orderBy(asc(schema.staff.displayName));
    const me = staff.find((s) => s.userId === user.id) ?? null;
    const open = me ? await tx.query.timeEntries.findFirst({ where: and(eq(schema.timeEntries.staffId, me.id), isNull(schema.timeEntries.clockOutAt), eq(schema.timeEntries.minutes, 0)) }) : null;
    const entries = await tx
      .select()
      .from(schema.timeEntries)
      .where(and(gte(schema.timeEntries.date, from), lte(schema.timeEntries.date, to), viewAll ? undefined : eq(schema.timeEntries.staffId, me?.id ?? "-")))
      .orderBy(desc(schema.timeEntries.date), desc(schema.timeEntries.createdAt));
    return { staff, me, open, entries };
  });
  const name = new Map(data.staff.map((s) => [s.id, s.displayName]));
  const totals = new Map<string, number>();
  for (const e of data.entries) totals.set(e.staffId, (totals.get(e.staffId) ?? 0) + e.minutes);
  const locations = await listLocations(business.id);
  const multiLocation = locations.length > 1;
  const locName = (id: string | null) => (id ? (locations.find((l) => l.id === id)?.name.replace(/^.*? - /, "") ?? null) : null);
  // Managers: one printable QR code per location for the PIN kiosk.
  const kiosks = manage
    ? await Promise.all(
        locations.map(async (l) => {
          const url = appUrl(`/clock/${await ensureClockToken(business.id, l.id)}`);
          return { id: l.id, name: l.name, url, qr: await QRCode.toDataURL(url, { margin: 1, width: 240, color: { dark: "#1c1917" } }) };
        }),
      )
    : [];
  const withoutPin = data.staff.filter((s) => !s.clockPinHash).length;

  return (
    <>
      <PageHeader title="Time clock">
        <form className="flex items-center gap-2">
          <Input type="date" name="from" defaultValue={from} className="w-40" />
          <span className="text-sm text-stone-500">to</span>
          <Input type="date" name="to" defaultValue={to} className="w-40" />
          <Button type="submit" variant="secondary" size="sm">Show</Button>
        </form>
        {edit ? <LinkButton href={`/app/${slug}/time/new`} variant="primary" size="sm"><Plus className="h-4 w-4" /> Add hours</LinkButton> : null}
      </PageHeader>
      <div className="max-w-3xl">
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
          {manage ? (
            <Card className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-medium">Clock-in QR code</h2>
                  <p className="text-sm text-stone-600">Print it and put it by the door. Staff scan it with their phone, type their PIN and are clocked in or out; no app login needed. Set each person&apos;s PIN on their staff profile{withoutPin ? ` (${withoutPin} of ${data.staff.length} have none yet)` : ""}.</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-6">
                {kiosks.map((k) => (
                  <div key={k.id} className="w-44 text-center text-xs">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={k.qr} alt={`Clock-in QR code for ${k.name}`} className="mx-auto h-40 w-40 rounded-lg border border-stone-200" />
                    {multiLocation ? <p className="mt-1 font-medium">{k.name}</p> : null}
                    <a href={k.qr} download={`clock-in-${k.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`} className="block text-brand-700 underline">Download</a>
                    <a href={k.url} target="_blank" rel="noreferrer" className="block text-stone-500 underline">Open page</a>
                    <form action={rotateClockToken} className="mt-1">
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="locationId" value={k.id} />
                      <ConfirmSubmit title="Issue a new code?" body="The printed QR code stops working until you replace it with the new one." confirmLabel="New code" variant="ghost" className="text-xs text-stone-500">New code</ConfirmSubmit>
                    </form>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
          <Card>
            <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">{formatDateLong(from)} – {formatDateLong(to)}</h2>
            {data.entries.length === 0 ? <div className="p-4"><Empty title="No hours recorded" /></div> : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-4 py-2">Date</th><th className="px-4 py-2">Staff</th><th className="px-4 py-2">In / out</th>{multiLocation ? <th className="px-4 py-2">Where</th> : null}<th className="px-4 py-2 text-right">Hours</th><th className="px-4 py-2">Note</th><th /><th /></tr></thead>
                <tbody className="divide-y divide-stone-100">
                  {data.entries.map((e) => (
                    <tr key={e.id} className={e.note?.includes("Auto clock-out") ? "bg-amber-50" : ""}>
                      <td className="px-4 py-2">{dateShort(e.date)}</td>
                      <td className="px-4 py-2">{name.get(e.staffId)}</td>
                      <td className="px-4 py-2 text-stone-600">{e.clockInAt ? `${formatTime(e.clockInAt, tz)} – ${e.clockOutAt ? formatTime(e.clockOutAt, tz) : "…"}` : "manual"}</td>
                      {multiLocation ? <td className="px-4 py-2 text-stone-600">{locName(e.locationId) ?? ""}</td> : null}
                      <td className="px-4 py-2 text-right">{fmtHours(e.minutes)}</td>
                      <td className="px-4 py-2 text-stone-600">{e.note ?? ""}</td>
                      <td className="px-2 py-2 text-right">{edit ? (
                        <details className="inline-block text-left">
                          <summary className="cursor-pointer text-xs text-stone-500 hover:text-stone-800">Edit</summary>
                          <form action={editTimeEntry} className="mt-1 flex w-52 flex-col gap-1">
                            <input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={e.id} />
                            <Input name="hours" type="number" step="0.25" min={0} max={24} defaultValue={(e.minutes / 60).toFixed(2)} aria-label="Hours" />
                            <Input name="note" defaultValue={e.note ?? ""} placeholder="Note" aria-label="Note" />
                            <Button type="submit" size="sm" variant="secondary">Save</Button>
                          </form>
                        </details>
                      ) : null}</td>
                      <td className="px-2 py-2 text-right">{edit ? <form action={deleteTimeEntry}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={e.id} /><ConfirmSubmit title="Remove this time entry?" body="Payroll for this period will no longer include these hours." confirmLabel="Remove" variant="ghost" className="text-stone-500 hover:text-red-600">Remove</ConfirmSubmit></form> : null}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-stone-200 bg-stone-50 text-sm">
                  <tr><td colSpan={multiLocation ? 8 : 7} className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-stone-500">Hours by staff</td></tr>
                  {[...totals.entries()].sort((x, y) => y[1] - x[1]).map(([sid, min]) => (
                    <tr key={sid}>
                      <td className="px-4 py-1" />
                      <td className="px-4 py-1 text-stone-800">{name.get(sid)}</td>
                      <td />
                      {multiLocation ? <td /> : null}
                      <td className="px-4 py-1 text-right tabular-nums">{fmtHours(min)}</td>
                      <td colSpan={3} />
                    </tr>
                  ))}
                  <tr className="border-t border-stone-200 font-semibold">
                    <td className="px-4 py-2" />
                    <td className="px-4 py-2">Total</td>
                    <td />
                    {multiLocation ? <td /> : null}
                    <td className="px-4 py-2 text-right tabular-nums">{fmtHours([...totals.values()].reduce((a, b) => a + b, 0))}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table></div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
