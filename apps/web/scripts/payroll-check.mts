// Dev check: run payroll for a business and period, write the workbook, and
// print the Summary tab back out. Usage: pnpm exec tsx --tsconfig tsconfig.json scripts/payroll-check.ts <slug> <start> <end> <out.xlsx>
import "../../../packages/db/src/env";
import ExcelJS from "exceljs";
import { writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, schema } from "@angelic/db";
import { runPayroll } from "../src/server/payroll";
import { buildPayrollWorkbook } from "../src/server/payroll-xlsx";

const [slug, start, end, out] = process.argv.slice(2);
const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.slug, slug!) });
if (!business) throw new Error("no business");
const result = await runPayroll(business, { start: start!, end: end! }, false);
for (const e of result.employees.filter((x) => x.hasActivity)) {
  console.log(`${e.employee.name} [${e.employee.payType}] total=${(e.totalCents / 100).toFixed(2)} mainRev=${(e.mainRevenueCents / 100).toFixed(2)} comm=${(e.mainCommissionCents / 100).toFixed(2)} prod=${(e.productCommissionCents / 100).toFixed(2)} cashTip=${(e.cashTipsCents / 100).toFixed(2)} cardTip=${(e.cardTipsCents / 100).toFixed(2)} fee=${(e.ccTipFeeCents / 100).toFixed(2)} wage=${(e.wageCents / 100).toFixed(2)} hours=${(e.totalMinutes / 60).toFixed(2)}`);
}
const buf = await buildPayrollWorkbook(result, { salon: business.name, periodLabel: `${start} - ${end}` });
writeFileSync(out!, buf);
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(buf as unknown as ArrayBuffer);
console.log("tabs:", wb.worksheets.map((w) => w.name).join(", "));
const s = wb.getWorksheet("Summary")!;
s.eachRow((row, i) => { if (i >= 3) console.log("  ", row.values.slice(1).map((v) => (typeof v === "number" ? v.toFixed(2) : String(v ?? ""))).join(" | ")); });
process.exit(0);
