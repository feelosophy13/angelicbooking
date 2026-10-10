import Link from "next/link";
import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { listReviews } from "@/server/reviews";
import { Card, PageHeader, Empty } from "@/components/ui";

export const metadata: Metadata = { title: "Reviews" };

function Stars({ n }: { n: number | null }) {
  return <span className="text-amber-400" aria-label={`${n ?? 0} stars`}>{"★".repeat(n ?? 0)}<span className="text-stone-300">{"★".repeat(5 - (n ?? 0))}</span></span>;
}

export default async function ReviewsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "clients.read");
  const r = await listReviews(business.id);
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: business.timezone });
  return (
    <>
      <PageHeader title="Reviews">
        <Link href={`/app/${slug}/settings/reviews`} className="text-sm text-brand-700 underline">Settings</Link>
      </PageHeader>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="text-xs uppercase tracking-wide text-stone-500">Average</p><p className="text-xl font-semibold">{r.count ? r.average.toFixed(1) : "—"} <span className="text-sm font-normal text-stone-500">/ 5</span></p></Card>
        <Card className="p-4"><p className="text-xs uppercase tracking-wide text-stone-500">Ratings</p><p className="text-xl font-semibold">{r.count}</p><p className="text-xs text-stone-500">of {r.requested} requested</p></Card>
        <Card className="p-4"><p className="text-xs uppercase tracking-wide text-stone-500">By provider</p>{r.byStaff.length === 0 ? <p className="text-sm text-stone-500">—</p> : r.byStaff.map((s) => <p key={s.staffName} className="text-sm">{s.staffName}: <b>{s.avg.toFixed(1)}</b> ({s.n})</p>)}</Card>
      </div>
      {r.rows.length === 0 ? <Empty title="No ratings yet" body="Clients are asked to rate each visit a couple of hours after checkout." /> : (
        <Card>
          <ul className="divide-y divide-stone-100 text-sm">
            {r.rows.map(({ r: rv, firstName, lastName, staffName }) => (
              <li key={rv.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span><Stars n={rv.rating} /> <span className="ml-2 font-medium">{firstName ? `${firstName} ${lastName ?? ""}`.trim() : "Client"}</span>{staffName ? <span className="text-stone-500"> · with {staffName}</span> : null}</span>
                  <span className="text-xs text-stone-500">{rv.submittedAt ? fmt.format(rv.submittedAt) : ""}{rv.clientId ? <> · <Link href={`/app/${slug}/clients/${rv.clientId}`} className="underline">client</Link></> : null}</span>
                </div>
                {rv.comment ? <p className="mt-1 whitespace-pre-line text-stone-700">{rv.comment}</p> : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
