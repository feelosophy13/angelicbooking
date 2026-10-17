import { NextResponse } from "next/server";
import { instantToISODate } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { defaultPeriod, runPayroll } from "@/server/payroll";
import { buildPayrollWorkbook, buildW2Workbook } from "@/server/payroll-xlsx";
import { formatDateLong } from "@/lib/utils";
import { eq } from "drizzle-orm";
import { auditEvent } from "@/lib/audit";
import { schema, withTenant } from "@angelic/db";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, user } = await requireAction(slug, "payroll.view");
  const url = new URL(req.url);
  const today = instantToISODate(new Date(), business.timezone);
  const isDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const start = isDate(url.searchParams.get("start")) ? url.searchParams.get("start")! : defaultPeriod(today).start;
  const end = isDate(url.searchParams.get("end")) ? url.searchParams.get("end")! : defaultPeriod(today).end;
  // Same default as the Payroll page: on unless the link says "0".
  const overtime = url.searchParams.getAll("overtime").at(-1) !== "0";
  const kind = url.searchParams.get("kind") === "w2" ? "w2" : "full";
  const locationId = url.searchParams.get("location") || null;
  const result = await runPayroll(business, { start, end }, overtime, locationId);
  const locationName = locationId ? (await withTenant(business.id, (tx) => tx.query.locations.findFirst({ where: eq(schema.locations.id, locationId), columns: { name: true } })))?.name : null;
  const periodLabel = `${formatDateLong(start)} - ${formatDateLong(end)}${locationName ? ` - ${locationName}` : ""}`;
  const buf = kind === "w2" ? await buildW2Workbook(result, { salon: business.name, periodLabel }) : await buildPayrollWorkbook(result, { salon: business.name, periodLabel });
  // Pay sheets carry everyone's pay: note who downloaded which.
  await auditEvent(business.id, user.id, "payroll.export", "payroll", `${start}_${end}`, { kind, overtime, locationId });
  const name = `${start.replace(/-/g, "")}_${end.replace(/-/g, "")}_${kind === "w2" ? "W2_Summary" : business.slug}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}
