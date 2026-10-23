import type { Metadata } from "next";
import Link from "next/link";
import { instantToISODate, OVER_SHORT_NOTE_CENTS, zonedToInstant } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { BackLink, Card, Empty, Input, PageHeader } from "@/components/ui";
import { LocationFilter } from "@/components/location-filter";
import { AutoSubmitForm } from "@/components/auto-submit-form";
import { StackTable } from "@/components/stack-table";
import { LinkRow } from "@/components/table-row";
import { listLocations } from "@/server/locations";
import { drawerHistory } from "@/server/drawer";
import { siteLabels } from "@/lib/location-ui";
import { formatMoney, formatTime, shiftISODate } from "@/lib/utils";
import { OverShort } from "../panel";

export const metadata: Metadata = { title: "Close-out history" };

/** Over/short per close, oldest on the left: bars up for over, down for short, red past the note limit. */
function Trend({ points, currency }: { points: { id: string; label: string; cents: number }[]; currency: string }) {
  const max = Math.max(OVER_SHORT_NOTE_CENTS * 2, ...points.map((p) => Math.abs(p.cents)));
  const w = 600;
  const h = 120;
  const mid = h / 2;
  const step = w / Math.max(points.length, 1);
  const bar = Math.max(2, Math.min(24, step * 0.6));
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-32 w-full" role="img" aria-label="Over and short per close">
      <line x1={0} x2={w} y1={mid} y2={mid} className="stroke-stone-300" strokeWidth={1} />
      {points.map((p, i) => {
        const len = (Math.abs(p.cents) / max) * (mid - 6);
        const x = i * step + (step - bar) / 2;
        const fill = p.cents === 0 ? "fill-emerald-500" : Math.abs(p.cents) > OVER_SHORT_NOTE_CENTS ? "fill-red-500" : "fill-amber-400";
        return (
          <rect key={p.id} x={x} width={bar} y={p.cents >= 0 ? mid - Math.max(len, 1.5) : mid} height={Math.max(len, 1.5)} rx={1.5} className={fill}>
            <title>{`${p.label}: ${p.cents === 0 ? "balanced" : `${formatMoney(Math.abs(p.cents), currency)} ${p.cents > 0 ? "over" : "short"}`}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export default async function DrawerHistoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ location?: string; from?: string; to?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await requireAction(slug, "reports.view");
  const tz = business.timezone;
  const currency = business.currency;
  const locations = await listLocations(business.id);
  const labels = siteLabels(locations);
  const locationId = locations.some((l) => l.id === sp.location) ? sp.location! : null;
  const today = instantToISODate(new Date(), tz);
  const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const from = isDate(sp.from) ? sp.from! : shiftISODate(today, -29);
  const to = isDate(sp.to) ? sp.to! : today;
  const rows = await drawerHistory(business.id, { from: zonedToInstant(from, "00:00", tz), to: zonedToInstant(shiftISODate(to, 1), "00:00", tz), locationId });
  const money = (c: number) => formatMoney(c, currency);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
  const over = rows.filter((r) => (r.s.overShortCents ?? 0) > 0).reduce((n, r) => n + r.s.overShortCents!, 0);
  const short = rows.filter((r) => (r.s.overShortCents ?? 0) < 0).reduce((n, r) => n - r.s.overShortCents!, 0);
  const offCount = rows.filter((r) => Math.abs(r.s.overShortCents ?? 0) > OVER_SHORT_NOTE_CENTS).length;
  const multi = locations.length > 1;
  const q = new URLSearchParams({ ...(sp.from ? { from } : {}), ...(sp.to ? { to } : {}) }).toString();

  return (
    <div>
      <BackLink href={`/app/${slug}/drawer`}>Cash drawer</BackLink>
      <PageHeader title="Close-out history" />
      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          {multi ? <LocationFilter locations={locations} current={locationId} query={q} /> : null}
          <AutoSubmitForm className="flex flex-wrap items-center gap-2">
            {locationId ? <input type="hidden" name="location" value={locationId} /> : null}
            <Input type="date" name="from" defaultValue={from} aria-label="From" className="h-9 w-auto" />
            <span className="text-sm text-stone-500">to</span>
            <Input type="date" name="to" defaultValue={to} aria-label="To" className="h-9 w-auto" />
          </AutoSubmitForm>
        </div>
      </Card>
      {!rows.length ? (
        <Empty title="No drawers closed in these dates" body="Each close-out shows here with who opened and closed it and how the count came out." />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="p-4"><p className="text-xs text-stone-500">Close-outs</p><p className="text-xl font-semibold tabular-nums">{rows.length}</p></Card>
            <Card className="p-4"><p className="text-xs text-stone-500">Total over</p><p className="text-xl font-semibold tabular-nums">{money(over)}</p></Card>
            <Card className="p-4"><p className="text-xs text-stone-500">Total short</p><p className="text-xl font-semibold tabular-nums">{money(short)}</p></Card>
            <Card className="p-4"><p className="text-xs text-stone-500">Off by more than {money(OVER_SHORT_NOTE_CENTS)}</p><p className="text-xl font-semibold tabular-nums">{offCount}</p></Card>
          </div>
          <Card className="mb-4 p-4">
            <h2 className="mb-2 text-sm font-semibold text-stone-600">Over and short</h2>
            <Trend points={[...rows].reverse().map((r) => ({ id: r.s.id, label: `${day.format(r.s.closedAt!)}${multi ? ` · ${labels.get(r.s.locationId)}` : ""}`, cents: r.s.overShortCents ?? 0 }))} currency={currency} />
          </Card>
          <Card>
            <div className="overflow-x-auto">
              <StackTable className="w-full text-sm">
                <thead className="text-left text-xs text-stone-500">
                  <tr>
                    <th className="px-4 py-2">Closed</th>
                    {multi ? <th className="px-4 py-2">Location</th> : null}
                    <th className="px-4 py-2">Opened by</th>
                    <th className="px-4 py-2">Closed by</th>
                    <th className="px-4 py-2 text-right">Expected</th>
                    <th className="px-4 py-2 text-right">Counted</th>
                    <th className="px-4 py-2 text-right">Over / short</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {rows.map((r) => (
                    <LinkRow key={r.s.id} href={`/app/${slug}/drawer/${r.s.id}`}>
                      <td className="px-4 py-2">
                        <Link href={`/app/${slug}/drawer/${r.s.id}`} className="font-medium hover:underline">{day.format(r.s.closedAt!)}</Link>
                        <p className="text-xs text-stone-500">{r.s.register === "Main" ? "" : `${r.s.register} · `}{formatTime(r.s.openedAt, tz)} to {formatTime(r.s.closedAt!, tz)}</p>
                      </td>
                      {multi ? <td className="px-4 py-2">{labels.get(r.s.locationId) ?? r.locationName}</td> : null}
                      <td className="px-4 py-2">{r.openedByName ?? "—"}</td>
                      <td className="px-4 py-2">{r.closedByName ?? "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(r.s.expectedCents ?? 0)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(r.s.countedCents ?? 0)}</td>
                      <td className="px-4 py-2 text-right"><OverShort cents={r.s.overShortCents ?? 0} currency={currency} />{r.s.closeNote ? <p className="truncate text-xs text-stone-500">{r.s.closeNote}</p> : null}</td>
                    </LinkRow>
                  ))}
                </tbody>
              </StackTable>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
