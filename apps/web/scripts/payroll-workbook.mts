// Dev check: build the workbooks the export route would send for a business and period, the same way the route does.
// Usage (from apps/web): pnpm exec tsx --tsconfig tsconfig.json scripts/payroll-workbook.mts <slug> <start> <end> <outDir>
import "../../../packages/db/src/env";
import { writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, schema } from "@angelic/db";
import { payPeriodLabel } from "@angelic/core";
import { payrollForPeriod } from "@/server/payroll";
import { listLocations } from "@/server/locations";
import { buildPayrollWorkbook, buildSummaryCsv, buildW2Workbook } from "@/server/payroll-xlsx";

const [slug, start, end, outDir] = process.argv.slice(2);
const business = (await db.query.businesses.findFirst({ where: eq(schema.businesses.slug, slug!) }))!;
const { result, finalized, overtime } = await payrollForPeriod(business, { start: start!, end: end! }, false);
const locations = await listLocations(business.id);
const opts = { salon: business.name, periodLabel: payPeriodLabel({ start: start!, end: end! }), period: { start: start!, end: end! }, currency: business.currency, location: null, finalizedAt: finalized?.createdAt ?? null, paidOn: finalized?.paidOn ?? null, paymentRef: finalized?.paymentRef ?? null, overtime, weekStart: business.weekStart, locations: locations.map((l) => ({ id: l.id, name: l.name })) };
writeFileSync(`${outDir}/${slug}_full.xlsx`, await buildPayrollWorkbook(result, opts));
writeFileSync(`${outDir}/${slug}_w2.xlsx`, await buildW2Workbook(result, opts));
writeFileSync(`${outDir}/${slug}_summary.csv`, buildSummaryCsv(result, opts));
console.log("finalized:", !!finalized, "employees:", result.employees.length, "omitted:", result.omitted.length);
for (const e of result.employees) console.log(`  ${e.employee.name.padEnd(16)} ${e.employee.payType.padEnd(10)} total=${(e.totalCents / 100).toFixed(2)} act=${e.hasActivity}`);
process.exit(0);
