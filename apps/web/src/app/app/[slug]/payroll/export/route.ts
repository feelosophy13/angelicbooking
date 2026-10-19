import { NextResponse } from "next/server";
import { instantToISODate, payPeriodLabel } from "@angelic/core";
import { can } from "@angelic/core";
import { PermissionError, requireAnyAction } from "@/lib/tenant";
import { currentPeriod, forHomeLocation, forOwnRow, payrollForPeriod } from "@/server/payroll";
import { buildPayrollWorkbook, buildW2Workbook } from "@/server/payroll-xlsx";
import { eq } from "drizzle-orm";
import { auditEvent } from "@/lib/audit";
import { schema, withTenant } from "@angelic/db";

/** The app's "Not allowed" page, as a route handler can send it: a 403 with the same words the error boundary uses, never a 500. */
function notAllowed() {
  const html = `<!doctype html><meta charset="utf-8"><title>Not allowed</title><body style="font-family:system-ui,sans-serif;background:#fafaf9;color:#1c1917;margin:0;padding:48px 16px"><div style="max-width:28rem;margin:0 auto;background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:24px;text-align:center"><h1 style="font-size:18px;margin:0 0 8px">Not allowed</h1><p style="font-size:14px;color:#57534e;margin:0 0 16px">Your role doesn't include this action. Ask an owner or manager.</p><a href="javascript:history.back()" style="font-size:14px;color:#1c1917;border:1px solid #d6d3d1;border-radius:8px;padding:8px 14px;text-decoration:none;display:inline-block">Go back</a></div></body>`;
  return new NextResponse(html, { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Everyone's pay sheet with "Run payroll for everyone"; "See their own pay sheet" exports only the person's own row (never the W-2 summary).
  let ctx: Awaited<ReturnType<typeof requireAnyAction>>;
  try {
    ctx = await requireAnyAction(slug, "payroll.manage", "payroll.view.own");
  } catch (e) {
    if (e instanceof PermissionError) return notAllowed();
    throw e;
  }
  const { business, user, permissions, staffId: myStaffId } = ctx;
  const manage = can(permissions, "payroll.manage");
  const url = new URL(req.url);
  const today = instantToISODate(new Date(), business.timezone);
  const isDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const cur = await currentPeriod(business, today);
  const start = isDate(url.searchParams.get("start")) ? url.searchParams.get("start")! : cur.start;
  const end = isDate(url.searchParams.get("end")) ? url.searchParams.get("end")! : cur.end;
  // Same default as the Payroll page: on unless the link says "0". A finalized period keeps the setting it was finalized with.
  const overtimeAsked = url.searchParams.getAll("overtime").at(-1) !== "0";
  const kind = url.searchParams.get("kind") === "w2" && manage ? "w2" : "full";
  // A location is the people based there (their whole pay), the way the owner runs one sheet per site; a value that isn't one of ours is ignored.
  const askedLocation = url.searchParams.get("location") || null;
  const location = askedLocation ? await withTenant(business.id, (tx) => tx.query.locations.findFirst({ where: eq(schema.locations.id, askedLocation), columns: { id: true, name: true } })) : null;
  const { result: whole, finalized, overtime } = await payrollForPeriod(business, { start, end }, overtimeAsked);
  const result = manage ? forHomeLocation(whole, location?.id ?? null) : forOwnRow(whole, myStaffId ?? null);
  const opts = { salon: business.name, periodLabel: `${payPeriodLabel({ start, end })}${location ? ` - ${location.name}` : ""}` };
  // Pay sheets carry everyone's pay: note who downloaded which.
  await auditEvent(business.id, user.id, "payroll.export", "payroll", `${start}_${end}`, { kind, overtime, locationId: location?.id ?? null, own: !manage, finalized: !!finalized });
  const stem = `${start.replace(/-/g, "")}_${end.replace(/-/g, "")}_${kind === "w2" ? "W2_Summary" : location ? location.name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") : business.slug}`;
  const buf = kind === "w2" ? await buildW2Workbook(result, opts) : await buildPayrollWorkbook(result, opts);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${stem}.xlsx"`,
    },
  });
}
