import { instantToISODate, zonedToInstant } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { csvResponse } from "@/lib/csv";
import { listLocations } from "@/server/locations";
import { closingDay } from "@/server/drawer";
import { paymentMethodLabel } from "@/lib/payment-methods";
import { shiftISODate } from "@/lib/utils";
import { pickLocation } from "../../../drawer/data";

/** The closing report for one location and day as a CSV: ?location&date. One section per block of the page, a blank row between. */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "reports.view");
  const url = new URL(req.url);
  const tz = business.timezone;
  const d = url.searchParams.get("date");
  const date = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : instantToISODate(new Date(), tz);
  const loc = pickLocation(await listLocations(business.id), url.searchParams.get("location") ?? undefined);
  if (!loc) return new Response("No location", { status: 404 });
  const r = await closingDay(business.id, loc.id, zonedToInstant(date, "00:00", tz), zonedToInstant(shiftISODate(date, 1), "00:00", tz));
  const $ = (c: number) => (c / 100).toFixed(2);
  const rows: (string | number | null)[][] = [
    ["Location", loc.name, "", "", ""],
    ["Date", date, "", "", ""],
    [],
    ["Payments by method", "Payments", "Taken", "Tips", "Refunds", "Net"],
    ...r.methods.map((m) => [paymentMethodLabel(m.method), m.count, $(m.amountCents), $(m.tipsCents), $(m.refundsCents), $(m.netCents)]),
    ["Total", r.totals.count, $(r.totals.amountCents), $(r.totals.tipsCents), $(r.totals.refundsCents), $(r.totals.netCents)],
    [],
    ["Card processor", "Charged at the desk", "Online deposits", "Refunds", "Deposits refunded", "Net before fees"],
    ...r.processors.map((p) => [p.provider === "helcim" ? "Helcim" : p.provider === "stripe" ? "Stripe" : p.provider, $(p.chargedCents), $(p.depositsCents), $(p.refundsCents), $(p.depositRefundsCents), $(p.netCents)]),
    [],
    ["Tickets closed", r.tickets.count],
    ["Services", $(r.tickets.servicesCents)],
    ["Products", $(r.tickets.productsCents)],
    ["Packages, memberships, gift cards and fees", $(r.tickets.otherCents)],
    ["Discounts", $(-r.tickets.discountCents)],
    ["Tax", $(r.tickets.taxCents)],
    ["Tips", $(r.tickets.tipCents)],
    ["Total", $(r.tickets.totalCents)],
    [],
    ["Deposits taken online", r.deposits.count, $(r.deposits.amountCents)],
    ["Cash taken with no drawer open", "", $(r.unstampedCashCents)],
    [],
    ["Drawer", "Closed by", "Expected", "Counted", "Over/short", "Note"],
    ...r.drawers.map((x) => [x.s.register, x.closedByName, $(x.s.expectedCents ?? 0), $(x.s.countedCents ?? 0), $(x.s.overShortCents ?? 0), x.s.closeNote]),
    [],
    ["Open ticket", "Client", "Due"],
    ...r.openTickets.map((t) => [`#${t.number}`, t.clientName, $(t.dueCents)]),
  ];
  return csvResponse(`closing-report-${date}.csv`, ["Closing report", "", "", "", "", ""], rows);
}
