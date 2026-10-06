import Link from "next/link";
import { requireAction } from "@/lib/tenant";
import { listWaitlist } from "@/server/public-booking";
import { formatDateLong } from "@/lib/utils";
import { Button, Card, PageHeader, Empty } from "@/components/ui";
import { updateWaitlist } from "./actions";

export default async function WaitlistPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "appointments.read.any");
  const rows = await listWaitlist(business.id);
  return (
    <>
      <PageHeader title="Waitlist" />
      {rows.length === 0 ? <Empty title="Nobody waiting" body="Clients can join the waitlist from the booking page when a day is full." /> : (
        <Card>
          <ul className="divide-y divide-stone-200">
            {rows.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{w.clientFirst} {w.clientLast} <span className="font-normal text-stone-500">{w.clientPhone}</span></p>
                  <p className="text-xs text-stone-500">{formatDateLong(w.date)} · {w.serviceName ?? "any service"}{w.staffName ? ` · ${w.staffName}` : ""}{w.notes ? ` · ${w.notes}` : ""}</p>
                </div>
                <Link href={`/app/${slug}/appointments/new?date=${w.date}${w.clientId ? `&clientId=${w.clientId}` : ""}${w.serviceId ? `&serviceId=${w.serviceId}` : ""}`} className="text-brand-700 underline">Book</Link>
                <form action={updateWaitlist} className="flex gap-1">
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="id" value={w.id} />
                  <Button name="status" value="booked" size="sm" variant="secondary" type="submit">Booked</Button>
                  <Button name="status" value="closed" size="sm" variant="ghost" type="submit">Remove</Button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
