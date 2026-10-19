# Payroll review — 2026-10-19

Three passes: a code review of the engine and the workbook builder (the workbook was generated from demo-salon's finalized
2026-09-21..10-04 period and opened with openpyxl), a live walkthrough of the Payroll page, Staff → Pay, Time clock, the
two-location tenant and a Provider login, and a column-by-column comparison with the owner's own Vagaro-based pay sheets (the
`salon-payroll` skill) plus Vagaro, Boulevard, Mangomint and GlossGenius. Paths are under `apps/web/src/` unless noted; `P` =
`server/payroll.ts`, `X` = `server/payroll-xlsx.ts`, `C` = `packages/core/src/payroll.ts`, `PG` = `app/[slug]/payroll/page.tsx`.

Severity: **H** = pays the wrong amount or loses pay; **M** = the owner has to work around it every run; **L** = polish.

## 1. What is right

The arithmetic of the owner's sheets is implemented in integer cents with the same formulas: main-service % on amount paid net of
tips, product/package % (membership sales earn nothing), cash vs card tips, the card-tip fee, Total 1099, W-2 hourly or salary
plus tips and product %, a tax deduction entered by the accountant, Total Check. Page and workbook come from one object, so they
agree to the cent (checked on the demo). Rate changes are effective-dated with history and an audit trail. Refunds come back out
on the day they are refunded, itemized or proportional. Overtime does weekly 1.5× or California daily with the FLSA regular rate
including commission. The workbook already has a Summary tab plus one tab per person with Misc / Main sections and the familiar
Cash | Cash TIP | Credit Card | CC Tip | Disc | Amt Paid | Total columns. Hours on the page match the Time clock exactly.

## 2. Gaps, by money impact

| # | Sev | Problem | Where |
|---|---|---|---|
| 1 | H | **No pay schedule.** Any two dates; default is "14 days ending yesterday". Nothing stores weekly / biweekly / semimonthly with an anchor, so every run is retyped and periods can overlap or leave gaps. Uniqueness is on the exact date pair, so two overlapping periods can both be finalized, and **salary pays a flat amount per run** (C:348): a 7-day or overlapping run pays a full salary. | P:379-381, `domain.ts:1016`, PG |
| 2 | H | **Finalize is a snapshot nothing reads back.** The page and the workbook always recompute live (E:26); the snapshot only feeds a drift notice, which shows only when the period is reopened with the same overtime flag and no location filter (PG:55). The file handed to the accountant for a finalized period is not the finalized figures when anything drifted. No reopen, no "paid on" date, no record of what was actually paid. | P:340-363, PG:55, `export/route.ts` |
| 3 | H | **Late-closed or backdated tickets fall into a closed period and are never paid.** Service lines are dated by the appointment item's start (P:151-156); a visit on the last day whose ticket closes after finalize lands in the finalized period, appears only as drift, and is paid only if the owner types an adjustment. Refunds got the "book on own date" rule; late tickets and reschedules did not. Also, sales are loaded only if closed within [start−183 d, end+31 d] (P:33-34): a ticket closed more than 31 days after the visit is never paid in any period. | P:33-34, 151-156 |
| 4 | H | **Whole-ticket refunds claw back the tip too** (P:205-208 applies the refund fraction to tip cents). Refunding a service while the stylist keeps the tip needs an itemized refund; the owner is not told. | P:205-208 |
| 5 | H | **Package redemptions pay the performer at full list price** (`offers.ts:194`, P:136) after the seller already earned the product % on the package sale. Memberships likewise pay full value for covered services. Commission base is **tax-inclusive** (P:133-136): the salon pays product % on the sales tax it remits. The owner's Vagaro sheet behaves the same way, so this is a policy decision to confirm, not necessarily a bug. | P:133-136, 150, `server/offers.ts:194` |
| 6 | M | **Silently dropped money.** Service lines and tips with no staff credited are ignored with no "unassigned" warning (P:125; `unmatchedStaffIds` can never fire, C:313). Hourly people with no punches and no sales **vanish from the workbook** (X:131) instead of a $0 row, so a missed clock-in is invisible to whoever cuts checks. | P:125, X:131 |
| 7 | M | **Discounts are absorbed 100% by the provider** (P:132), no house-absorbs option; member-rate discounts are baked into the unit price (`sales.ts:98-103`) so they never show in the Disc column. No-show and late-cancel fees have no staff (`sales.ts:236`), so the provider gets nothing with no option to share. | P:132, `sales.ts:98-103, 236` |
| 8 | M | **The lock after finalize has holes**: kiosk and API punches and the 14-hour auto-close still write into a finalized period (`time-clock.ts:73-88`); sale edits, reschedules and voids are not locked at all. Adjustments attach by period start, so moving the start date orphans them (P:241). | `server/time-clock.ts:73-88`, P:241 |
| 9 | M | **W-2 tax is a placeholder**: a flat $ or a % of wage plus commission (C:371-372). No FICA, federal or state tables, employer taxes, pay stubs, YTD, 1099 year totals. The W-2 workbook carries zeros unless each person's withholding is pre-set. Adjustments are described as pre-withholding but the % ignores them (C:372). | C:371-372, `adjustments/new/page.tsx:21` |
| 10 | M | **Missing pay models** a salon asks for: tiered commission by period revenue (Vagaro, Boulevard, Mangomint, GlossGenius all have it), per-service or per-category rates, "greater of" hourly vs commission, booth rent, backbar / service-cost deductions before commission, tip pooling or tip-outs to assistants, split credit on shared visits, recurring adjustments (draws, garnishments, reimbursements, PTO). Everything is a one-off hand-typed adjustment. | `domain.ts:230-238` |
| 11 | M | **Location filter misleads**: "Reston" narrows sales only; hours and adjustments stay whole, so Reston + Arlington > All and the headline "TOTAL PAYROLL" is wrong per site. Finalize is hidden while filtered. The owner's process makes one workbook per location with the employee's location deciding. | PG, `export/route.ts:25` |
| 12 | M | **Card-tip fee and product rate are per person, with no salon default.** The demo already has one provider at 10% product while the rest are 5%, and nothing flags it; the salon's standard 3% / 5% must be re-entered for every new hire under "More options". | `staff/[staffId]/pay/*` |
| 13 | M | **Overtime week starts on Monday** regardless of the business's week-start setting added today (P:288, 316 vs `domain.ts:66`). Salaried non-exempt staff never get overtime (C:337). Overtime is on by default from the URL (PG:34) and the finalized flag only warns when it differs. | P:288, 316, C:337, PG:34 |
| 14 | M | **Providers cannot see their own pay** by default: the Provider role lacks `payroll.view.own`, and `/payroll/export` for a denied role returns HTTP 500 instead of "Not allowed" (the route throws `PermissionError` with no handler). | `export/route.ts:15`, `permissions.ts` defaults |
| 15 | L | Rounding: per-line cash/card split, discount and tax use `Math.round` per line (P:132-147) rather than proportional allocation, so section totals can differ from the ticket by cents; with a mid-period rate change commission rounds per line (C:355) instead of on the sum. Tips "same as payment" are split by payment mix (C:177), an approximation on mixed tickets. | P:132-147, C:177, 355 |
| 16 | L | Staff deletion cascades pay rates, time entries and adjustments (`domain.ts:520, 965, 986`); history is gone and only the snapshot's names remain. | `domain.ts` |

## 3. The workbook

What the accountant gets today: `Summary` (Employee, Position, Pay type, Rate, Commission, Wage, Cash Tip, Card Tip, Fee, Total,
Service Revenue, Service Profit, TOTAL row) and one tab per active person: title row, "Pay period: 2026-09-21 - 2026-10-04", Misc
section, Main section, optional Refunded section, summary lines (Main Services 45%, Misc 10%, Cash Tips, Card Tips, Fees on CC
Tip, adjustments, Total 1099); hourly/salary tabs: Rate, Hours, Pay, commission, tips, fee, Product %, adjustments, Tax Deductions
"entered by accountant", Total Check, then hours by date and procedure lists. A W-2 variant drops commission people and the two
revenue columns. Filename `YYYYMMDD_YYYYMMDD_<slug>.xlsx`.

| # | Problem | Where |
|---|---|---|
| W1 | **Every cell is a hard-coded value: zero formulas** in ~1,700 cells. Totals do not recalculate when the accountant corrects a row, and nothing can be traced. | X |
| W2 | Dates are text strings, not Excel dates (X:58): no sorting or filtering by date. No frozen panes, no autofilter, no print setup, no column widths tuned for printing. | X:58 |
| W3 | **The Summary does not foot.** No Hours, OT hours, Adjustments, Tax or Net columns; 1099 adjustments are inside Total only, W-2 tax deduction is not a column (X:146). No pay-period dates, pay date, employee type (1099 / W-2), YTD. | X:146 |
| W4 | Currency symbol is hard-coded "$" (X:15) regardless of the business currency; "Rate" text omits the product % (C:418); $0 product rows appear as noise. | X:15, C:418 |
| W5 | Against the owner's sheet: Checkout By sits in column 4 instead of 2; the Total column is amount paid plus discount instead of amount paid; summary lines sit in column C/J instead of A/B; the period label is the long weekday form instead of "July 12 2026 - July 25 2026"; the W-2 tab puts earnings before the hours table, lacks weekly hour subtotals and a Total hours row, lacks Checkout By and Total rows on Procedures and Products, and includes memberships in Products; refunds are negative rows rather than a Refunded Transactions section; no Quality Check tab listing omitted records; the accountant W-2 file is not one tab per location. | X |
| W6 | No CSV, no per-person export for managers, no per-location filename. The `location` query parameter is not validated against the tenant in the route (harmless, yields an empty sheet). | `export/route.ts:25` |

## 4. Page and settings

- One page does run, review, finalize, export, adjustments and the overtime rule; the Options popover does not close on outside
  click or Escape; "Add" adjustment still shows on a finalized period and only fails on submit.
- The summary table has no Hours, OT or Adjustments columns, so an adjustment changes TOTAL with nothing visible in the row; "Svc
  profit" reads negative for hourly staff (Sofia −$126.77) and looks like an error.
- Hourly cards show sales only; the per-day shifts and the OT split live only on Time clock, so "0.40 OT" cannot be traced on the
  payroll page.
- Adjustments: one page per add, no edit, no recurring, no "copy last period"; the staff picker lists inactive staff and the owner.
- No per-person pay history (past sheets) and no "paid" or check-number mark on a period.
- Copy bug on the adjustment form: a literal `person’s check` entity; a React "unique key" warning on the payroll page.
- Staff → Pay: the salon's standard product % and card-fee % are hidden under "More options"; a scheduled rate change cannot be
  cancelled.

## 5. Competitors in one line each

Vagaro: tiered commission by revenue, hourly + commission, overtime, business-cost deductions, weekly / biweekly / semimonthly /
monthly periods, mark as paid with payroll history, Gusto sync. Boulevard: compensation plans with tiers and service charges before
or after commission, commission line-items report, renter payouts. Mangomint: sliding-scale commission, backbar fees pre or post
commission, in-house payroll processing with deductions and reimbursements, tip settings. GlossGenius: 1099 and W-2 in one run,
in-house payroll in 50 states. Zenoti: "greater of" hourly vs commission.

## 6. What to build, in order

1. **Pay schedule on the business** (weekly / biweekly / semimonthly / monthly, anchor date, week start shared with the calendar's
   setting), Previous / Next period navigation, no overlapping finalizations, salary prorated to the schedule.
2. **Finalized means finalized**: page and export read the snapshot for a finalized period (live figures behind a "what changed"
   view); late-closed and backdated tickets and reschedules book on their own date like refunds; a "paid on" date and check
   reference; lock kiosk and API punches too.
3. **Workbook**: Excel dates, SUM formulas, Summary with Hours / OT / Adjustments / Tax / Net that foots, frozen header and
   autofilter, business currency, CSV, one workbook per location with hours split by the employee's location, and the layout
   aligned to the owner's sheet (column order, Total column, summary in A/B, period label, W-2 table order and totals, Quality
   Check tab).
4. **Money correctness**: tips survive whole-ticket refunds unless the tip is refunded; "unassigned revenue" warning; $0 rows for
   hourly people with no punches; discount absorption setting (provider / house / split); no-show fee sharing option; package
   redemption base (list price vs package share).
5. **Salon-wide defaults** for product % and card-tip fee with per-person overrides; tiered commission; "greater of"; backbar
   deduction; recurring adjustments; shared-visit split; `payroll.view.own` on by default for Provider and a 403 page on the export.
6. W-2 withholding stays external (Gusto / ADP) unless the owner wants real tax tables; add a Gusto-shaped hours and earnings CSV.
