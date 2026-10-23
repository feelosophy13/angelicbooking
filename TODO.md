# To do

Living list of outstanding work and recurring upkeep for Angelic Booking. Keep it current:
tick items off, add new ones at the right level, and date anything time-sensitive.
Operational detail (ids, commands, env names) lives in `docs-ops.md`; product plan in `PLAN.md`.

## 1. Launch blockers (nothing charges or texts until these are done)

### Stripe
- [x] Stripe sandbox test keys are in local `.env` (2026-10-10); Billing, Customer Portal, number add-on, usage meter and
      the billing webhook were verified against the sandbox with `apps/web/scripts/billing-*.ts`.
- [x] Connect account creation migrated to Accounts v2 (Stripe refuses v1 Standard accounts for new platforms).
- [ ] ~~Put Stripe **test** keys in local `.env`~~ (`STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`) so the
      billing, Connect and checkout flows can be run end to end with Stripe test cards.
- [x] Activate the platform Stripe account. Done by 2026-10-17: the live account reports charges and payouts enabled, details
      submitted, nothing currently due; live webhooks for /api/stripe/webhook and /api/stripe/billing exist. The restricted live key must have write access to Customers,
      PaymentIntents, SetupIntents, Refunds, Checkout, Subscriptions, Products/Prices, Billing meters, Webhook
      endpoints and Connect accounts (or use a full secret key).
- [x] Webhooks created 2026-10-10 **in the sandbox** (`we_1UP6MGBapD9TuxcNtawam0qF` Connect, `we_1UP6MGBapD9TuxcNrI58f7K2` account)
      with secrets in `.env` and on Render, plus the sandbox `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
      on Render, via `apps/web/scripts/stripe-production-setup.ts`. Production runs in Stripe **test mode** after the
      next deploy. Live endpoints also exist (`we_1UP6XoPmYAh2Q7irQvL8Ixgh` Connect, `we_1UP6XoPmYAh2Q7ireZildnrP`
      account) from the restricted live key `STRIPE_SECRET_LIVE_KEY`; their secrets are in `.env` as
      `STRIPE_WEBHOOK_LIVE_SECRET` / `STRIPE_BILLING_WEBHOOK_LIVE_SECRET`. Switch Render to live once the account is
      activated and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_LIVE_KEY` is in `.env`: run the script with `--live` (Render
      copies one variable per call if the classifier objects) and deploy.
- [x] Live keys on Render, 2026-10-17: STRIPE_SECRET_KEY (restricted rk_live), NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY and both webhook secrets
      now hold the live values (kept in `.env` as the `*_LIVE_*` names; local dev stays on test keys). Redeployed; both prod webhooks accept
      events signed with the live secrets; the key can read every resource the app uses. Still to do: one real card payment + refund
      from the sale page (proves the key's write access), and a real store order (manual capture with a platform fee).
- [ ] Save the Customer Portal configuration once in the Stripe dashboard (branding, cancellation copy).
- [x] Decide pricing on the admin Pricing page (base plan, trial, number fee, text usage, included texts, platform fee on card
      payments). Prices are in the database now, not in environment variables.

### Twilio
      Done 2026-10-19 (saved on local and production price books with an admin audit entry): base $15/month with 1 location and
      1 active staff included (lowered from $29 the same day for a lower barrier of entry), $29 per extra location, $10 per extra
      staff (Vagaro's per-calendar price), text number $15/month, 100 texts included then 2¢,
      30-day trial, 200 trial emails a day, 0% platform fee. One bundled plan on purpose: payroll, forms, automations and the inbox
      are included rather than sold as add-ons like Vagaro's; revisit per-feature pricing after ten paying salons.
- [ ] (Angelic Beauty was deleted from prod on 2026-10-17 at the owner's request; they will re-add it.) Buy the first toll-free number for Angelic Beauty in production (Settings → Text messaging) and submit
      carrier verification. Needs the owner signed in on app.angelicbooking.com; buy it **before** the deploy that
      turns Stripe on (billing then requires an active subscription to buy a number) or set up billing first. Needs EIN (or sole proprietor), address, contact. Approval takes 1–3 weeks;
      status is polled every 5 minutes.
- [ ] Decide whether a platform-wide fallback sender is wanted for businesses without a verified number
      (`TWILIO_FROM` / `TWILIO_MESSAGING_SERVICE_SID`). It would need its own toll-free verification.
- [x] Twilio auto-recharge enabled by the owner 2026-10-17 (balance was ≈$197 on 2026-10-08).

### Email
- [x] Add a DMARC record in Cloudflare: `TXT _dmarc.mail1  v=DMARC1; p=none;` (improves Gmail/Yahoo delivery). Done 2026-10-10.
- [x] `SUPPORT_EMAIL` = tunityventure@gmail.com on Render and in `.env` (2026-10-17); the Help page shows it.

### Domain move to app.angelicbooking.com (done 2026-10-10)
- [x] Cloudflare DNS `CNAME app → angelic-booking.onrender.com` (DNS only); Render verified, certificate issued.
- [x] Google OAuth client: origin `https://app.angelicbooking.com` + redirect URI `…/api/auth/callback/google` added.
- [x] `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL` switched, deployed, cron job URL updated, redirects verified.
- [ ] Google consent screen: change the home page link from the bare domain to `https://app.angelicbooking.com`
      (cosmetic; the bare domain redirects anyway).
- [x] Marketing site (Cloudflare Worker `angelicbooking`) owns the bare domain and www; root domains detached from Render,
      root redirect removed from `src/proxy.ts`, Cloudflare redirect rule keeps old `/book/*` links working.

## 2. Before real customers

### Payroll review 2026-10-19 (`REVIEW-PAYROLL-2026-10-19.md`, §6 build order)
- [x] Item 1, pay schedule, 2026-10-19 (migration 0121 `businesses.pay_frequency` / `pay_anchor_date`): weekly / every two weeks /
      twice a month (1st–15th, 16th–end) / monthly, with an anchor day for the first two and the week start shared with the calendar
      (`businesses.weekStart`, which the overtime workweek now follows instead of a fixed Monday). Set under Payroll → Options or
      Settings → Payroll rules (`settings.booking` or `payroll.manage`). Payroll opens on the period containing today with Previous /
      Next / This period; "Custom range" keeps the free dates for a one-off run. Finalize refuses a period overlapping a finalized one.
      Salary is per scheduled period: a custom run pays it pro rata by days of each scheduled period it covers (`salaryShare`, said on
      the page); with no schedule set the page assumes two weeks from the latest finalized period (else the week start) and salary stays
      flat per run. Math in core `pay-schedule.ts` (tests `pay-schedule.test.ts`); DB test `payroll-schedule.test.ts`.
- [x] Item 2, finalized means finalized, 2026-10-19 (migration 0122 `payroll_runs.paid_on` / `payment_ref` / `paid_by_user_id` /
      `paid_at`): the Payroll page and both workbook exports read the saved snapshot for a finalized period (`payrollForPeriod`), with the
      run's own overtime setting; live figures sit behind a "What changed since this period was finalized" disclosure; Re-finalize stays
      explicit and is refused while the period is marked paid. "Mark as paid" (day + check or batch reference, audited `payroll.mark_paid` /
      `payroll.unmark_paid`) on a finalized period. Late and backdated tickets book on their own date like refunds: a visit whose period was
      finalized before its ticket closed (or before a reschedule moved it there) is paid in the period containing the close, as "Late ticket ·
      <visit date> · <service>", pushed past any other period finalized before then; a visit moved out of a finalized period after it was
      paid there is not paid again (Quality Check: "paid in an earlier period"). Sales loading has no look-ahead cap any more: a period loads
      sales closed inside it plus any sale with a visit inside it, whenever it closed. Kiosk and web punches and the 14-hour auto-close refuse
      a day inside a finalized period (`assertPunchOpen`; the API already did). `/payroll/export` without permission is the "Not allowed"
      page with status 403, not a 500. A location on the Payroll page now means the people based there with all of their pay (the owner's
      one-sheet-per-site rule; `forHomeLocation`), not "sales at that site only". `buildPayrollLinesDetailed` also returns the Quality
      Check ledger (`omitted`: no staff credited, inactive staff, out of period, not commissionable, paid in an earlier period), saved in the
      snapshot. Whole-ticket refunds no longer claw back tips (item 4, landed here with the rewrite). Tests in `payroll-clawback.test.ts`.
- [x] Item 3, the workbook, 2026-10-19 (`server/payroll-xlsx.ts` rewritten): real Excel dates (`mmm d, yyyy`); every section total, weekly
      hours subtotal, Total hours, summary line and TOTAL is a SUM / ROUND formula with its value cached (viewers that don't recalculate still
      see numbers); the Summary tab has Employee, Position, Pay type (1099 / W-2), Rate, Hours, OT hours, Commission, Wage, Cash tip, Card tip,
      Card-tip fee, Adjustments, Tax, Net (= SUM of the money columns, equal to the engine's total) and the revenue / profit pair, a TOTAL
      row that foots, and the period dates, finalized date and paid-on / reference in the title rows; frozen header rows and an autofilter
      on each tab's main table (Excel allows one per sheet); currency format from `business.currency`; no $0 product rows; per-person tabs in
      the owner's layout (Checkout By in column 2, Total = Amt Paid, pay summary in A/B, "July 12 2026 - July 25 2026" label, W-2 tabs with the
      hours table first with weekly subtotals and Total hours, Procedures performed and Products & Package Sales with Checkout By and Total
      rows, memberships listed separately, a Refunded Transactions section) and a Quality Check tab last. Per-location workbook (`?location=`:
      the people based there, filename `<start>_<end>_<Location>.xlsx`), a Summary CSV (`?kind=csv`), and the accountant's W-2 file as one
      Summary tab per location with no revenue / profit columns. Active hourly and salaried people with no punches and no sales get a $0 row
      (item 4). Dev check: `apps/web/scripts/payroll-workbook.mts <slug> <start> <end> <outDir>` writes the three files the route would send.
- [x] Item 4, money correctness, 2026-10-19 (migration 0123 `businesses.discount_absorb` / `fee_share_bps` / `package_redemption_base`,
      all defaulting to today's behaviour): whole-ticket refunds take back the goods only, the tip stays unless the tip line itself is
      refunded (test in `payroll-clawback.test.ts`); an "Unassigned" card on the Payroll page (and Quality Check rows) for service lines and
      tips with nobody credited; a $0 row on the page and in the workbook for every active hourly or salaried person with no punches and no
      sales (`onSheet` in core; "no punches" chip). Settings → Payroll rules → Commission rules: "Who absorbs discounts" provider (default) /
      house / split, applied in the commission base (`houseDiscountCents` on the line, added back to service money; Amt Paid stays what was
      paid) with the member-rate discount now shown in the Disc column and treated the same way; "Share of no-show and late fees to the
      provider" (%, default 0) crediting the appointment's provider with a row of kind fee paid in full on top of commission
      (`feeShareCents`); "Package sessions pay commission on" list price (default) / package price per session, recorded in `creditCents`
      when the session is used (`offers.ts` redeemCredit), so earlier tickets keep what they were credited. Memberships still credit the
      list price. Tests: core `payroll.test.ts` (house share, fee share, onSheet), DB `payroll-rules.test.ts`.

- [x] Reports tables, 2026-10-19: By location gains Services and Products (net of the ticket discount, like the Staff table), and the
      Staff table gains Refunded: itemized refunds against whoever was credited on the refunded lines, an amount refund split across the
      ticket's service and product lines by share, on the refund date; a person refunded with nothing rung up still gets a row so the
      column foots (`refundsByStaff`, `linesByLocation` in `salesReport`).
- [x] Reports category table, 2026-10-19: category names line up whether or not the row has an expand chevron (the spacer takes the
      button's footprint). Demo seed: up to two recent visits of each package holder and active member become the covered service paid
      with a session (amount 0, credit = the package's per-session price or the service's list price for a membership; the ticket's
      totals and payment drop by the service price, the tip stays), so "From packages & memberships", Prepaid used and provider pay on
      credits all have data (18 sessions in demo-salon, 17 in demo-twosites).
- [x] Package sessions pay commission on the package's per-session price by default, 2026-10-19 (migration 0124 flips the column
      default and moves businesses still on the shipped-hours-earlier "list" default). The owner's choice: a provider earns on what the
      client actually paid for the session, not the service's list price. Settings → Payroll rules lists that option first.
- [x] Reports: client cohorts, 2026-10-19 (reworked the same day to the owner's return-window definition). A "Clients" card under the
      summary tiles: New (first completed visit ever in the period), Returning (a completed visit in the period and one before it),
      Lost and Retention, each against the previous equal-length period. With N = the business's "consider a client lapsed after"
      days: clients are *due back* in a period when their last completed visit before (period end − N) falls in [period start − N,
      period end − N), i.e. their N-day clock ran out inside the period; *retained* when they had another completed visit within N
      days of it or a visit booked ahead as of the period end (an appointment made before the period end, starting after it, not
      cancelled or a no-show, so a past period reads as it did at the time); *lost* otherwise, Lost + Retained = due back; Retention =
      retained ÷ due back, shown with "39 of 40" under it. A separate "Lapsed right now" line (as of today, whatever the period):
      last completed visit N or more days ago with nothing booked or confirmed ahead, with what they spent in the year before their
      clock ran out and the ten biggest spenders (name, last visit, visits, spend; contact details only with `clients.contact`, the
      spend column only with `clients.spend`). The visit and booked-ahead definitions are shared with the We miss you automation
      (`server/visit-sql.ts`, used by `noVisitReach` and the daily scan), whose reach is the one-week slice of "lapsed right now" not
      yet messaged. One caption, one sentence per number, plus the hint to set the days to the usual gap between visits. Setting
      `businesses.lapsed_after_days` (migration 0125, default 90) under Settings → Booking rules next to the cancellation window; a new
      no-visit workflow starts from it and the We miss you page says when the two differ. Export → Clients (CSV): the figures against
      the previous period, Lapsed right now, then every lapsed client. Visits are not split by service, so the card is left out while a
      service filter is on; with a location filter, visits and sales at that site anchor the counts, coming back or booking counts
      anywhere. The lower grid's cards now contain their wide tables at phone width (`min-w-0`). `clientCohorts` and `lapsedClients`
      in `server/sales.ts`; DB test `reports-clients.test.ts`.
- [x] Clients card wording, 2026-10-19: the owner found "Lost", "Retention" and "due back" unreadable. The tiles now say what they
      count, with the business's own number in the label: "Didn't come back within 90 days" and "Came back within 90 days" (of the
      clients whose 90 days since their last visit ran out in the period), and the line below reads "No visit in the last 90 days, as
      of today". Caption and CSV headers say the same; no "Lost", "Retention" or "due back" anywhere on the page.
- [ ] Reports Clients card: revenue is by sale date with the client on the ticket, so a walk-in ticket with no client, or a visit paid
      on a later day, moves money between cohorts and periods; a client whose only history is imported sales (no completed
      appointment) is never New or Returning; a client who came back late counts as Lost in the period their clock ran out and as
      Returning in the period they came back. Demo-salon's seed history is eight weeks, so at the 90-day default every tile but New and
      Returning is 0 there.
- [x] Reports: package and membership money by category on the usage basis, 2026-10-19 (the owner's decision: no "attribute to"
      setting). "Revenue by service category" has Services (paid at the visit), From packages & memberships (the session's value,
      `creditCents`, in the category of the service performed, on the day it is used), Total, and with `payroll.manage` Provider pay
      (the commission Payroll credits on those lines, `payByCategory` over the payroll line builder, so discount-absorb, dated rates,
      the package base and refund clawbacks all agree with Payroll) and Profit; sorted and shared on Total; CSV under Export →
      Revenue by category. Summary cards Prepaid sold (package and membership lines of closed sales) and Prepaid used (credit redeemed);
      membership fees are one "Membership fees" line among the top items, never a category. Category revenue stays gross of refunds
      like service lines (refunds are the Refunds card, by date); Provider pay is net of clawbacks dated in the range. A membership
      session has no per-session price, so it is valued at the service's list (pre-member) price. Tests: `category-rollup.test.ts`,
      DB `reports-prepaid.test.ts`.
- [ ] Reports: hourly and salary pay is not split by category, so Profit on the category table is before wages; the Staff card's
      Cost of revenue is the place for that. Consider allocating wages by service minutes if the owner asks for a fully loaded margin.
- [x] Payroll workbook, 2026-10-19: the W-2 tab's Hours worked dates show the weekday ("Mon, Oct 5, 2026"), and Procedures
      performed has an Amt Paid column (the service amount without tips, the service-commission base) with its own total, like
      the Products table.
- [x] Demo seed, 2026-10-19: sale lines (service, product, tip) carry the sale's own close time. They used to default to the seed run
      time, so payroll treated every one of the 368 demo tips as "Tip (added later)" on the seed day; now none are.
- [x] Client page "Sale" button, 2026-10-18: a secondary button beside Book appointment (shown with `checkout.take`) opens Sales → New
      sale with the client already picked (`/sales/new?clientId=`), for retail, gift card or package purchases without a visit.
### Permissions plan 2026-10-18 (`PERMISSIONS-PLAN-2026-10-18.md`; phase 1 closes the exposures in section 2, phase 2 adds the own / everyone axes)
- [x] Phase 1 catalog, 2026-10-19 (migration 0119 back-fills every stored role so nobody loses what they use today): `clients.contact`,
      `clients.spend`, `reviews.view` / `reviews.view.own`, `staff.directory`, `staff.schedules.view`, `catalog.view` / `catalog.prices` /
      `catalog.costs`, `inventory.view`, `sales.view.own` / `sales.view.all`, `giftcards.view`, `time.view.all` / `time.edit`,
      `waitlist.view` / `waitlist.manage`, `forms.manage`. Defaults per the plan's table (Front desk gains visit photos, as the table says);
      the Roles page is regrouped into Calendar, Clients, Reviews, Checkout and money, Staff, Catalog and inventory, Marketing and forms,
      Settings, each group with a one-line description; `lib/visibility.ts` holds the shared "who sees what" helpers.

- [x] Phase 1 clients (C1–C5), 2026-10-19: the client list hides phone and email and the Lifetime spend column (and sort) without
      `clients.contact` / `clients.spend`; the profile hides contact details, the Spent tile and ticket amounts the same way, filters the
      visit history to the viewer's own appointments for own-calendar roles (retail tickets need `sales.view.all`), shows ratings only with a
      reviews permission (own ones only with `reviews.view.own`), and its tab title needs `clients.read` like the page. The appointment page
      shows the client's phone and email only with `clients.contact` and the record notes and pinned notes only with `clients.notes`; ⌘K
      client hits drop phone and email without `clients.contact`. Gap left: the list's search still matches on phone and email for a role
      without `clients.contact` (it confirms a number belongs to someone); the shared `clientSearchWhere` would need a contact-less variant.

- [x] Phase 1 reviews (R1), 2026-10-19: the Reviews page opens with `reviews.view` (everything) or `reviews.view.own` (pinned to the
      viewer's own lines: no provider filter, no per-provider card, no "with …"); the author's name shows only with `clients.contact`, the
      client link only with `clients.read`. A login not linked to a staff member with only `reviews.view.own` sees an empty page.
- [x] Phase 1 staff and time (S1–S4), 2026-10-19: the staff list needs `staff.directory` and shows days worked only with
      `staff.schedules.view`; Staff hours needs `staff.schedules.view` (was `appointments.read.any`); the time clock shows everyone's rows with
      `time.view.all`, adds, edits and removes rows with `time.edit` (the kiosk QR codes stay `staff.manage`); the Log usage page's recent
      list is the team's only with `inventory.view` or `inventory.manage`, else the viewer's own entries.

- [x] Phase 1 catalog and inventory (I1–I3), 2026-10-19: Services (index, All, a category), Packages, Memberships and Products need
      `catalog.view` (was any member); prices and deposit amounts show only with `catalog.prices`; stock chips and the "Out, low or off"
      filter only with `inventory.view`; the product cost field (new, edit, options, Edit all) and the product export need `catalog.costs`
      (the actions keep a cost they were not sent). Inventory → Stock and History open read-only with `inventory.view` (no Receive, Import,
      Export or cost figures without the permissions behind them); Reorder, Orders, Suppliers, Count and Report stay `inventory.manage`.
- [x] Phase 1 sales and gift cards (M1, M2, M6), 2026-10-19: the Sales list and a ticket open with `checkout.take`, `sales.view.own` or
      `sales.view.all`; without `sales.view.all` the list and the ticket are filtered to tickets the viewer is credited on (the old
      `seesOwnOnly` side effect is gone), and Start sale needs `checkout.take`. A refund (and changing a refund's reason) needs
      `checkout.refund` on a ticket the viewer may see; refunding a deposit needs `checkout.refund` on an appointment the viewer may work
      on. The Gift cards page opens with `giftcards.view` (so the desk can look up a balance); issuing and full codes stay `giftcards.issue`.

- [x] Phase 1 calendar, waitlist and classes (A1, A3, A4), 2026-10-19: the calendar hover card (and the detail panel, which draws the same
      card) shows the client's phone only with `clients.contact`, the visit's notes only with `clients.notes`, and prices, totals and the
      deposit only with `catalog.prices` (`buildTip` takes a `show` argument; the home page passes the viewer's permissions); a class page
      shows the seat price only with `catalog.prices`; the Waitlist page needs `waitlist.view` (phone with `clients.contact`) and booking
      from it or closing entries needs `waitlist.manage`.

- [x] Phase 1 forms and settings (C7, C8, T3), 2026-10-19: designing forms (Settings → Forms list, New form, a form's page, its CSV export,
      create / save / delete / duplicate) needs `forms.manage` (was `business.manage`); voiding, moving or emailing a signed copy needs
      `forms.manage` (was `clients.write`), and so does the "Edit form" link on a signed copy. The submissions inbox's "Still to sign this
      week" lists only the viewer's own upcoming visits for an own-calendar role (`outstandingForms` takes a scope). The signer's IP address
      shows only with `audit.view` (staff view and print view; never on the client's copy). The development "View as" pill is drawn only for
      a real owner.

- [x] Phase 1 API and mobile (T2, R3, S3, S5, C1, A1), 2026-10-19: every API scope now maps to the permission its creator must hold
      (`SCOPE_NEEDS`): `staff:read` ← `staff.schedules.view`, `reviews:read` ← `reviews.view`, `time:read` ← `time.view.all`, `time:write` /
      `time:delete` ← `time.edit`, `forms:write` / `forms:void` / `forms:delete` ← `forms.manage`, `sales:read` ← `sales.view.all`,
      `waitlist:write` ← `waitlist.manage`. `GET /staff/{id}/schedule` reads with `staff:read` (was `catalog:read`; a version-1 key holding only
      `catalog:read` now gets 403 there; the developers page and `public/openapi/v1.json` say so). The mobile agenda drops the client's phone,
      the visit's notes and the price without `clients.contact`, `clients.notes` and `catalog.prices`; the phone menu's Staff tab needs
      `staff.directory`. Default change: Manager keeps `reviews.view.own` and `sales.view.own` (the plan lists them for Provider only) because a
      manager may only edit a role whose permissions they all hold.
- [x] Phase 1 nav and search (A5 and the sidebar), 2026-10-19: Clients needs `clients.read`, Staff `staff.directory`, Staff hours
      `staff.schedules.view`, Waitlist `waitlist.view`, Services / Products / Packages / Memberships `catalog.view`, Inventory
      `inventory.manage` or `inventory.view` (Log supplies with `inventory.log` alone), Gift cards `giftcards.view`, Sales any of
      `checkout.take` / `sales.view.*`, Reviews `reviews.view` / `reviews.view.own`, Forms (sidebar and Settings directory) `forms.manage`.
      ⌘K offers New appointment and Block time only with booking / blocking access (an own-calendar role also needs a linked staff member)
      and New client only with `clients.write`; service hits need `catalog.view`.

- [x] Phase 1 tests, 2026-10-19: `server/__tests__/role-matrix.test.ts` seeds one business (two stylists, a client with phone and email,
      three visits, two paid tickets with tips, two reviews, a product with cost and stock, a gift card, two time-clock rows) and renders the
      real pages as each default role (the viewer is swapped by mocking `lib/tenant`; everything under it runs against Postgres): client list
      and profile, appointment page, mobile agenda and detail, Reviews, Staff, Staff hours, Time clock, Sales, Products, Gift cards. It asserts
      which fields appear for whom (phone and email, spend, other staff's days and hours, prices, stock, other people's tickets, review
      authors) and that refused pages refuse. The permission tests in `packages/core` pin the defaults table row by row; `nav.test.ts`,
      `security-guards.test.ts`, `visibility.test.ts` and `calendar-tip.test.ts` cover the sidebar, the API scope map, the helpers and the
      hover card. (The `payroll-clawback.test.ts` flake seen here was the DST gap fixed 2026-10-19, see "Payroll overtime" below.)

- [x] Phase 2 catalog, 2026-10-19 (migration 0120): new permissions `clients.photos.own`, `reports.staff`, `payroll.manage` (replacing
      `payroll.view`, a 1:1 rename), `payroll.view.own`, `checkout.tips.adjust`, `classes.manage.own` / `classes.manage.any`,
      `staff.self.hours` / `staff.self.services`, `appointments.read.availability`, and `settings.business` / `settings.booking` replacing
      `business.manage`, which is retired (every page, action, nav entry, API scope and test that named it now names one of the two: profile,
      locations, wording and number, reasons, embed, domain and import are `settings.business`; booking rules, store, loyalty, review requests,
      automations and the message log are `settings.booking`; `requireBillingAction` still checks `billing.manage` while a business is locked).
      Back-fill: photos.own replaces photos for own-calendar roles, reports.staff ← reports.view, tips.adjust ← checkout.take with read.any,
      classes.manage.any ← write.any, both settings keys ← business.manage; the self-service, own-pay and availability keys start off for
      everyone. The four built-in roles' descriptions are rewritten for a salon owner (and refreshed in stored rows that still had the old text).
      Not done: `reviews.reply` is not in the catalog yet (the reply feature is phase 3), so nothing is back-filled for it.

- [x] Phase 2 money (M3, M4, M5), 2026-10-19: Reports shows the per-staff table only with `reports.staff`; Payroll opens as "My pay" for
      `payroll.view.own` alone (the page and the workbook export filtered to the person's own row, no W-2 summary, options, finalize or
      adjustments); the tax-exempt switch needs `checkout.discount`; adding a tip to a paid ticket, or changing tips once a ticket is paid,
      needs `checkout.tips.adjust` (the forms hide without it).

- [x] Phase 2 classes (A2), 2026-10-19: scheduling, filling and cancelling a class needs `classes.manage.any`, or `classes.manage.own` for a
      class the person teaches (the New class page then offers only themselves as instructor); the API `classes:` scopes follow
      `classes.manage.any`.

- [x] Phase 2 staff self-service (S6), 2026-10-19: with `staff.self.hours` a person opens their own staff page with the Weekly hours and
      Time off tabs and may save them; with `staff.self.services` the Services tab; the staff list links a row only to a page the viewer may
      open. `staff.manage` still opens everyone's page and every tab. Not built: `staff.self.profile` (the plan lists it under S6 but not in
      the phase 2 list).

- [x] Phase 2 visit photos (C6), 2026-10-19: the Gallery opens with `clients.photos` (everyone's) or `clients.photos.own` (pinned to the
      lines the person performed, no stylist filter); a client profile's photos follow the same scope; a client's profile photo opens with either.

- [x] Phase 2 availability (A6), 2026-10-19: `appointments.read.availability` on an own-calendar role draws every column on the web calendar
      and the mobile agenda, with colleagues' appointments as nameless "Busy" blocks (no client, service, price or link; the hover card and
      detail panel show only the time); booking and blocking stay on the person's own column.

- [x] Phase 2 tests, 2026-10-19: `role-matrix.test.ts` gains the phase 2 cases (an availability-only role's agenda shows colleagues as
      nameless busy blocks; "My pay" shows one row and no finalize, W-2 or finalized-periods controls; `staff.self.hours` opens the person's own
      hours and nobody else's; the Reports staff table needs `reports.staff`); the core table test pins every action's defaults, including
      that `business.manage` and `payroll.view` are gone. The "Finalized periods" card is hidden on the own pay sheet.

### Roles & permissions review 2026-10-18 (`REVIEW-2026-10-18.md` Part 2; fixed in order S1–S8, then the nav/page mismatches)
- [x] S1 API `roles:write` / `roles:delete` now go through `server/roles.ts` (createRole / updateRole / deleteRole) with the same rules as
      the app: nobody grants, removes or deletes permissions their own role lacks, nobody edits their own role, Owner is locked. A key acts
      as the person who created it (`api_keys.created_by_user_id`) with their current role; a key with no recorded creator, or whose
      creator left the business, gets 403 on every role write. Audit rows carry the creator as actor and the key id. The login system's
      copy of a custom role is still only synced when someone saves it in the app (a key has no session to call it with).
- [x] S2 Gift cards: the page (and its sidebar entry) needs `giftcards.issue` or `reports.view`; codes show in full only to issuers,
      others see the last four. Redeeming a card at checkout records who redeemed it on the payment and in the audit log, and neither
      keeps the full code (the ticket note and the log say "Gift card ••••1234"). Gap: Front desk can no longer look up a card's balance
      on that page; selling and redeeming at checkout still work with `checkout.take`.
- [x] S3 Partial ownership: `appointmentAccess` now answers "own" (every live line is mine) or "shared" (some lines are a colleague's).
      On a shared visit an own-calendar role may read it, edit notes, add or remove photos of their own service, log supplies and start
      checkout, and (with "change their own bookings") add, move or remove their own lines only; they may not cancel it, change its
      status (which every line follows), or move it as one. `requireAppointmentAccess` refuses shared access by default; a change opts
      in with the line it is about (`line`) or `shared: "allow"` for work that belongs to no single line. The appointment page, the calendar
      drag, quick status and the mobile API follow the same rule (the mobile detail says `can.write: false` on a shared visit).
- [x] S4 Private file URLs (`/api/files/<id>`) follow the pages that show them: a client's profile photo needs `clients.photos`, a
      signature or form attachment `clients.notes`, a visit photo the appointment it belongs to (whoever may open that appointment; an
      own-calendar role only on visits they are booked on). A signed-in client still sees their own form files.
- [x] S5 Classes: the list and a session page need a calendar permission (`appointments.read.any` or `.own`); an own-calendar role sees
      only the classes they teach (another instructor's is a 404); the roster prints phone and email only with `clients.read`. The
      Classes sidebar entry follows.
- [x] S6 Staff directory: a co-worker's email and whether they have a login (and which role) show only with `staff.manage` or
      `members.manage`; everyone else sees name, position, location and calendar status.
- [x] S7 Own tickets: for a role that sees only its own calendar, "own" now means credited on a line of the ticket. Having rung it up no
      longer counts (it kept showing clients' tickets to whoever once opened them, and to a demoted login), except a ticket with no lines
      yet that they opened in the last hour, so a sale they just started isn't lost before the first line goes on.
- [x] S8 Mobile appointment detail strips the client's contact details (everything but the name) without `clients.read`, and the client's
      private notes without `clients.notes`; `can.write` is false on a visit shared with a colleague.
- [x] Nav and page mismatches (Part 2b), 2026-10-18 (migration 0116): new permission `marketing.send` ("Send marketing", in the role
      editor's own Marketing group; Manager by default, Front desk and Provider not) gates the Marketing pages (campaigns, promo codes,
      sending) and the Marketing sidebar and ⌘K entries instead of `reports.view`; the `campaigns:` API scopes need it too. Back-fill rule
      for stored roles: reports.view → marketing.send. Automations (list, new, edit, toggle, the sidebar entry and the Marketing tile) are
      `business.manage` throughout. Sidebar entries now match their pages: Waitlist needs `appointments.read.any`, Reviews `clients.read`,
      Classes a calendar permission, Gift cards `giftcards.issue` or `reports.view`; the phone menu's Clients tab needs `clients.read`.
      The Access tab disables the Owner option for non-owners and the Change role button (with the reason) whenever the action would
      refuse; the rules live in `lib/role-rules.ts`, shared by the page and `setMemberRole`.

### Full review 2026-10-16 (`REVIEW-2026-10-16.md` has every finding; the "Fix first" table is the order)
- [x] Client-data permissions split, 2026-10-18 (migration 0114): `clients.read` ("View clients") now means only the client list, a
      client's contact details and visit history. Split out of it: `clients.export` (the CSV download, now in the activity log with the
      filter and row count), `clients.notes` (private notes, lash maps, signed forms, the forms inbox and print view), `clients.messages`
      (Inbox, a client's text thread, the unread badge; replying also needs `clients.write`), `clients.photos` (Gallery and the photos on
      a profile), `clients.balances` (store credit and loyalty cards; adjusting them also needs `clients.write`). Defaults: Owner and
      Manager all five; Front desk notes, messages, balances; Provider notes and photos. API key scopes follow (`client-notes:` and
      `forms:read` need notes, `clients:balances` balances, `messages:read` messages). The appointments report CSV drops the Phone
      column unless the caller also has `clients.read`. Back-fill rule for stored roles: clients.read → notes + photos; clients.read +
      clients.write → messages + balances too; clients.read + (reports.view or members.manage) → export. Owners can retick anything
      under Roles.
- [x] Business-settings permissions split, 2026-10-18 (migration 0115): `business.manage` ("Business settings") now means the everyday
      settings only (profile, booking rules, locations, text wording, store, loyalty, reviews, refund and cancellation reasons, forms,
      imports, embed, custom domain, the Message log, the Loyalty page, Marketing automations). Split out of it: `billing.manage`
      (Settings → Payments: the Stripe connection; Settings → Billing: the subscription and card; it is what `requireBillingAction`
      checks, so it is the one permission that works while a business is locked for non-payment), `integrations.manage` (Settings → API
      keys; buying, verifying and releasing the text number, while the Text number page itself stays readable with business settings),
      `audit.view` (Settings → Activity log). Defaults: Owner all; Manager gains business settings and the activity log but not billing
      or integrations ("Everything except Stripe, billing and API keys"); Front desk and Provider unchanged. The Settings directory,
      the sidebar, the ⌘K list, the home setup checklist and the "connect Stripe" pointers on Store, Booking rules, service forms, a
      sale and a client's membership only link to pages the viewer may open. API key scopes `settings:` and `policies:` need business
      settings. Back-fill rule for stored roles: business.manage → billing + integrations + audit too; stored Manager roles do NOT gain
      business.manage (the owner opts in under Roles, and their stored description still reads "Everything except business settings and
      Stripe" until they edit it). Gap: the tax rate and receipt footer live on the Payments page, so they moved with it to
      `billing.manage`; move them to Locations or Business profile if a manager needs them.
- [x] Filters without Apply, 2026-10-18: `AutoSubmitForm` now also runs search boxes (apply ~300 ms after typing stops or on
      Enter, replacing the address instead of adding a back step per letter) and dates (apply once the date is whole). Appointments,
      Gallery and Reviews lost their Apply buttons; Products, Stock and Inventory history search now follow as you type. DESIGN.md →
      Toolbars and filters updated.
- [x] Staff hours shows the whole team, 2026-10-18 (REVIEW-2026-10-18 Part 3): the people lanes, the Edit hours menu, the team-wide Add
      time off picker and the time-off list include every active staff member, not only providers; lanes run providers first in booking
      order, then front desk and other staff. The coverage strip, "no provider in" and Needs attention still count providers only
      (`lib/staff-hours.ts` `orderStaff`, `server/coverage.ts` lanes carry `provider`).
- [x] Staff hours People filter, 2026-10-18: a select beside the service category: Everyone, then each login role somebody holds
      (the business's own Roles in their order: Owner, Manager, Front desk, Provider, custom ones), then "No login yet" for staff who
      have not accepted an invite. `?people=` (`r:<role key>`, `nologin`) drives the lanes, the Edit hours menu and the time-off list
      and is kept by the other filters; the coverage strip and Needs attention still judge every provider (`peopleOptions` /
      `matchesPeople` in `lib/staff-hours.ts`). Job titles (`staff.position`) were tried first and made too many options.
- [x] Staff hours Month view, 2026-10-18: a Week / Month pill beside the arrows (`?period=month&month=YYYY-MM`; arrows move a month,
      "This month" replaces "This week"). Month is a Monday-first calendar where each day lists everyone in the People filter with
      their hours ("9–5", "Off", "Custom 10–2", "Time off") from the same resolved schedule as the week (`buildCoverage` now takes
      `dates` and reports each day's overrides); closed days are hatched; a date opens that week; days stack with the date as a row
      header below `md`. Needs attention, the coverage strip and the People / Coverage switch stay week-only
      (`staff-hours/month-grid.tsx`, month helpers in `lib/staff-hours.ts`).
- [x] Staff hours Month view "Only working / Everyone" pill, 2026-10-18: Only working is the default and leaves out the people who are
      off or on time off that day (a day where nobody in the People filter works says "Nobody in"); Everyone (`?off=show`) lists them
      all with "Off". Kept by the other filters; week view has no such switch (its lanes only ever show people who are in).
- [x] Demo tenants have receptionists and staff logins, 2026-10-18: Dana Whitfield is Front Desk Lead; Marcus Bell (Tue–Sat) and Leila
      Haddad (late shifts and the weekend; home site Reston in `demo-twosites`) are Receptionists, hourly, no calendar column, with
      front-desk time off in the next weeks. Every demo staff member now has a login with the demo password in their role (Ava is a
      Manager, the artists Providers, the desk Front desk), linked to their staff row like an accepted invite, shared between the two
      demo businesses; so the People filter, Roles and Staff → Access show real members and the demo can be walked as each role.
### Calendar: Google Calendar behaviours (2026-10-18; plan and audit in the side-session notes, `calendar-google-parity-audit.md`)
- [x] Jump to a date and keyboard shortcuts, 2026-10-18: a calendar button beside the arrows opens a Monday-first mini month ("Pick a
      date", `calendar-nav.tsx`; picking a day keeps the view, staff, location and forms filters); the keys are Google Calendar's: t today,
      ← → or j k or p n to move, g pick a date, d w m views, c new appointment, / search (⌘K opens from an `app:search` window event
      too), ? the list of shortcuts (a quiet keyboard icon opens it as well), Escape closes. Nothing fires while typing in a field, with a
      modifier held, or while a dialog is open. Helpers and the key map in `lib/calendar-nav.ts` (tested).
- [x] Quick create on the grid, 2026-10-18: clicking an empty slot (or drawing a range down a column, which stays as a dashed ghost)
      opens a popover beside it (`quick-create.tsx`) instead of leaving the page: client (search or add), service, provider (the column's
      person, narrowed to who does the service), time, "Send the client a confirmation", Book; "More options" opens the full New
      appointment page with the same choices. A "Block time" tab (for those allowed) blocks the drawn range with a reason. Server
      actions `quickBook` / `quickBlock` (`[slug]/actions.ts`) follow the full form's rules: own-calendar roles only on their own column,
      "Book anyway" offered to those who may double-book, confirmation then workflows. Success is a client toast (`toast()` in
      `components/toaster.tsx`, one at a time, optional action such as Open) and the grid refreshes. Touch: a tap opens the popover,
      a drag still scrolls. Not built: a popover on the phone agenda list (no empty slots there; "+ New" covers it).
- [x] Drag polish, 2026-10-18: dropping a visit whose client can be reached (a phone or email they accept messages on) asks "Move
      {name} to 3:45 PM?" with "Move and tell {name}" / "Move quietly" / Cancel, the card held where it was dropped meanwhile;
      quietly still restarts the reminders (`moveAppointmentItem({ notify })` → `appointmentChangedSilently`). Blocks and walk-ins move
      without asking. Every move and resize ends in a toast with Undo (moves it back the same way, told or quiet); drag errors are
      toasts too, not a banner above a tall grid. The bottom edge of a card is a resize handle (mouse/pen): the service's last segment,
      or the block, ends where it is dropped, snapped to the booking grid (`resizeService`, action `resizeAppointmentItem`; must stay
      inside the provider's hours and off their classes; no message to the client since the start is unchanged; audit
      `appointment.resize`). Not built: resizing the start edge, resizing on touch.
- [x] Detail panel on click, 2026-10-18: clicking an appointment (a card, or a row of the phone agenda) opens a panel down the right
      edge (a sheet from the bottom on a phone, `appointment-panel.tsx`) instead of leaving the calendar: client and phone (tap to call),
      View client (with `clients.read`), every service with who and when, total, how booked / deposit / forms due, notes, status badge;
      actions Confirm → Check in → Start → Complete (`quickStatus`, now with `in_progress` and a plain error instead of a crash when the
      status isn't theirs to change), Open (the full page), and Remove block for blocked time (`removeBlock`). The content is the hover
      card's server-built summary, so nothing is fetched on click; Escape or × closes; it follows a refresh and closes when the card
      leaves the grid. Keyboard shortcuts keep working with it open. Not built: editing services, moving, cancelling or checkout in the
      panel (Open does those on the appointment page).
- [x] Touch drag, 2026-10-18: on a touch screen (a tablet at the desk) press and hold a card for about a third of a second and it lifts
      (ring, slight scale, a short buzz where supported); the finger then moves it, the page no longer scrolls, and letting go follows the
      same path as a mouse drop ("Move and tell / Move quietly", Undo toast, error toast). A slide or the browser's own scroll within
      the hold cancels the lift, and a plain tap still opens the detail sheet. Verified by driving pointer events with touch type in the
      browser pane (the pane's taps arrive as mouse clicks, so not on a real finger). Resize by touch not built.
- [x] Resize the start edge, 2026-10-18: the top edge of a card is a handle too (the client came early, lunch starts later): the
      service's first segment starts where it is dropped and the end stays. A new start is a time change, so a reachable client is
      asked about like a move ("Change and tell / Change quietly") and the reminders follow; Undo puts the old start back the same way.
      `resizeService` takes `newStartAt` and/or `newEndAt`; `resizeAppointmentItem` takes `newStartISO`, `newEndISO`, `notify`.
- [x] Show / hide providers, 2026-10-18: one chip per provider above the grid (`provider-chips.tsx`, the provider's colour, a tick when
      shown); click to leave them out of the Day columns, the Week overview (where the chips are the legend) and the Month, click again
      to bring them back, "Show all" while someone is hidden. Travels as `?hide=` so the server draws only what is shown (and the day
      strip counts only that), kept by the other filters and remembered per business in this browser like the location pills.
      Own-calendar roles never see the chips.
- [x] Colour by provider or service category, and hour height, 2026-10-18: a quiet sliders button in the header (Day and Week) opens
      Display: "Colour by" Provider / Service category and "Hour height" Compact / Normal / Roomy (0.8 / 1.2 / 1.8 px a minute),
      remembered in this browser (`calendar-display.tsx`). Categories have no colour of their own, so each takes one from a twelve-hue
      palette in menu order (`lib/calendar-palette.ts`); by category every card is tinted and a legend of the categories on screen sits
      above the grid. Month keeps provider colours. Gap: an owner cannot pick a category's colour (would need a colour on the category form).
- [x] Linked multi-provider visits, 2026-10-18: a visit whose services are done by different providers is drawn as one card per column;
      each of those cards now carries a small link mark, and hovering or opening any of them rings its siblings across the columns, so
      the whole visit reads as one (worked out on the client from the items on screen; the detail panel already lists every line).
- [x] Appointment search in ⌘K, 2026-10-18: a client's visits from the last 90 days onward (past ones marked "past", cancelled and
      no-show said so), and upcoming visits found by service name ("lash lift" lists who has one coming); own-calendar roles get only
      their own, roles with no calendar none. The Appointments page keeps the full filters and paging (`search/route.ts`).
- [x] Print-friendly calendar, 2026-10-18: printing Day or Week gives the grid alone (header controls, chips, day strip, setup line,
      hint, dev pill and toasts are `print:hidden`; the sidebar and nav already were), the whole day with no scroll box, cards outlined
      in grey so they survive browsers that drop background colours, and Week asks for landscape (`@page`). "Print this view" sits in
      the Display menu as well as ⌘P. Agenda prints as the plain list it is.
- [x] Check out from the detail panel, 2026-10-18: for those with `checkout.take` (and the right to update the visit) the panel has a
      Check out button that runs the appointment page's own `startCheckout` (opens or returns to the visit's ticket; forms still due
      come back as the usual message), so a visit can be rung up from the calendar without opening its page.
- [x] Security and privacy batch, 2026-10-16:
      - Online booking, shared forms and store orders attach to an existing client only when signed in, or when phone/email AND name match
        (`lib/client-match.ts`); otherwise a new client is made. Forms filled from a manage link or anonymously only fill blank email/phone,
        never replace them; the manage-link forms page prefills earlier answers only for the signed-in client; the confirmed page masks the email.
      - Migration 0095 revokes `admin_users` from `angelic_app` (0091 missed it). **Run migrations on Render** (the deploy does this).
      - Roles: nobody but an owner can change their own role's permissions or their own role, or add, remove, assign or delete permissions
        their role lacks; invites likewise. Role and member changes are now in the audit log. API keys can only carry scopes the creator's
        role covers (`scopesBeyond`). Better Auth's `/api/auth/organization/*` endpoints are closed to the browser (proxy.ts), which also
        closes one-call business deletion.
      - Rate limits and form IPs use the last X-Forwarded-For hop. Client sign-in codes: 5 per hour per email/phone, 15 guesses per hour,
        crypto-random codes, and the same client record chosen every time when duplicates exist.
      - Client photos are private (`client` kind; the files route now shares the kind sets with `lib/files.ts`), so they load again without
        R2 and won't go to the public bucket once R2 is on. `migrate-files` moves them too.
      - Mobile API follows the web calendar rules (own-calendar roles see and change only their own appointments), cancel needs a reason
        (the app shows the list instead of cancelling on one tap), a cancelled visit can't be revived there, a repeat status is a no-op.
- [x] Turnstile on the public forms, 2026-10-16: online booking (and the payment step, before anything is charged), waitlist, client
      login codes, shared forms and the store checkout. It shows nothing unless Cloudflare wants a tick, and the server refuses a form
      without a passing token. Off when the keys aren't set, and off on hosts not registered on the widget (`NEXT_PUBLIC_TURNSTILE_HOSTNAMES`,
      default app.angelicbooking.com and localhost): a business's own booking domain has no bot check yet (add the domain to the widget in
      Cloudflare and to that variable, or leave it to the rate limits). Tests: `lib/__tests__/turnstile.test.ts`.
- [x] Security batch leftovers, 2026-10-16: Better Auth's own rate limiter keys on the client address the proxy works out (header
      `x-angelic-client-ip`, the last X-Forwarded-For entry; a client's own value is overwritten), so a spoofed header no longer lands
      everyone in one shared bucket. Already done earlier: password reset signs other devices out, mobile and API refuse an expired trial,
      dev mobile origins trusted only in development, own-calendar roles see only their own sales.
- [ ] Decide: require a verified email before staff can sign in (`requireEmailVerification`). Off today; a Google sign-in can't take over an
      unverified password account either way.
- [x] Money batch, 2026-10-16 (migration 0096):
      - No-show and late-cancel fees go on a fee-only ticket (`openFeeSaleForAppointment`): a paid deposit stays on the appointment (kept or
        refunded by the cancel choice), an open visit ticket that had taken the deposit is rebuilt with the deposit put back and package
        sessions/credits returned. Paying a fee ticket no longer marks the visit completed, starts review/rebook automations or awards points.
      - A voided ticket no longer blocks ringing the visit up again (`sales_appointment_uq` is now partial, `status <> 'void'`).
      - Card on file and late card tips: the sale is locked and a pending row committed before Stripe is called, a second click while one is in
        flight is refused, and the webhook can settle a charge by the payment id in its metadata if the app died after charging. Refunds lock
        the payment row (no double gift-card/store-credit give-back) and refuse card payments with no Stripe reference.
      - Membership renewals record their PaymentIntent again (looked up from the invoice's payments on the pinned API version), so refunding one
        sends the money back.
      - Deposits charged for a booking that never saved are refunded by the 5-minute job after 20 minutes (`sweepOrphanDeposits`, logged in
        Activity as `deposit.orphan_refund`); a page that returns after that is told to book again. Online order receipts and gift-card codes are
        emailed from the webhook too, once (`sendOrderEmailsOnce`).
      - Verified against the demo Stripe sandbox with `apps/web/scripts/money-smoke.ts`; DB tests in `server/__tests__/money-fixes.test.ts`.
- [x] Money batch follow-ups, all closed by 2026-10-16: Stripe-side refunds and disputes reach the webhook; payments store their Stripe
      account; partial refunds handle sold gift cards and packages; loyalty earns on services and products only. Stripe calls no longer run
      inside a database transaction (card and deposit refunds, desk card payments, online store orders, creating a client's Stripe
      customer): rows are checked and locked, Stripe is called with nothing held open, then the result is saved in a second short
      transaction (a double click is one refund; a crash after Stripe is recovered by the charge.refunded webhook). Also fixed: reads
      through the pool from inside a transaction (payroll, closing a sale, refunds, booking, forms), which froze the local app on
      2026-10-16 when Reports ran several payroll builds at once; Postgres now ends a transaction left idle for 2 minutes. Test:
      `stripe-outside-tx.test.ts`.
- [x] Consent batch, 2026-10-16 (migration 0097):
      - Marketing consent is separate from appointment messages: `sms_marketing_opt_in` (+ when/how it was given) starts OFF for everyone, because the
        booking checkbox only ever covered confirmations and reminders; `email_marketing_opt_in` copies the old email flag. Campaigns and promotional
        automations need it; clients give it with a separate unticked box on the booking form or in their account, or staff record written consent
        on the client page (audited as `client.consent`). **Existing clients will get no marketing texts until they opt in.**
      - STOP (and Twilio 21610) puts the number on `sms_suppressions`: every record with it goes off texts, texts already queued to it are cancelled,
        and nothing (staff edit, import, API, booking form) can turn it back on; START lifts it (appointment texts only).
      - Delivery re-checks consent right before sending (suppression, appointment-text flag, marketing flags), so a STOP or unsubscribe after
        queueing is honoured. Messages carry a `marketing` flag.
      - Unsubscribe now turns off marketing email only (as its page always said), lives at `/unsubscribe/<slug>/<token>` outside the booking site,
        and marketing emails carry `List-Unsubscribe` + one-click POST (`/api/unsubscribe/...`).
      - Campaign texts wait for 9am–8pm local, one message per phone/email; rating-request texts wait for daytime too. Delivery claims in batches
        of 50, so a large campaign can't be reclaimed and sent twice.
      - DB tests: `server/__tests__/consent.test.ts`.
- [ ] Still open from consent: the booking form's new box wasn't clicked through in the browser (typechecked only); the Vagaro import maps
      `text_valid` to appointment texts (fine) but there is no way to carry over marketing consent from Vagaro; a global suppression list across
      businesses was not added (per business only). (Resend pacing and per-business fairness: done, see "Delivery" below.)
- [x] Payroll batch, 2026-10-16:
      - Refunds are booked on the day they happen: a sale is credited in full on its own date and each refund (card, cash or store credit)
        adds negative "Refund ·" rows on the refund date, covering goods and tips in proportion. A refund after a period was paid comes off the
        next one; paid periods re-run the same. Store-credit refunds now claw back commission (no more double pay when the credit is spent), and
        a partly refunded tip is no longer paid in full.
      - Finalized periods are locked: hours (web and API), adjustments, and pay changes starting on or before a finalized period's end are
        refused with a pointer to the current period. Adjustments are audited. Re-finalizing logs who changed and by how much.
      - The payroll page warns when live figures differ from the finalized snapshot (and when overtime differs from how it was finalized).
      - Pay settings (Staff → Pay) need `payroll.view`, not `members.manage`.
      - `buildPayrollLines` now loads only the clients, visits and users its sales need (it used to load every row, and every user on the platform).
      - DB tests: `server/__tests__/payroll-clawback.test.ts`.
- [x] Line-item refunds, 2026-10-16 (migration 0098): the refund form lists the ticket's items with what is left on each; ticking items
      refunds exactly those (quantity for multi-unit products, editable amount for a partial refund) to the payment or as store credit, and
      payroll takes back exactly those lines from whoever was credited on them (`refund_items`). Leaving all unticked still refunds an amount
      off the whole ticket, spread in proportion. A refunded gift card loses that balance (never more than is left on it) and switches off at
      zero; a package refunded in full loses its unused sessions. Refunds and deposit refunds now need `checkout.refund` (no longer
      `reports.view`). Tests: `server/__tests__/refund-items.test.ts`; checked in the browser on demo sale #1518.
- [x] Line-item refund follow-ups, 2026-10-16: a ticked product in the refund form has its own "Back on the shelf" box (unticked by default:
      stock only goes back when the product does; the separate box shows only for whole-ticket refunds). Reports has "Refunds by item"
      (itemized refunds by what was refunded, plus one "Whole ticket" line). Memberships: see "Delivery" below.
- [x] Payroll overtime, 2026-10-16 (migration 0107): commission counts toward the overtime regular rate (FLSA: the period's commission is
      spread evenly over the hours worked, and each overtime hour adds half of that per-hour amount, each double-time hour all of it; shown
      as "OT on commission" and on the Excel sheet). Payroll → Options → "Count overtime" sets Weekly (1.5× over 40 h) or Daily (California:
      1.5× over 8 h a day, 2× over 12 h, the 7th day in a row 1.5× then 2×, and 40 h a week counted on the remaining regular hours). A tip
      added to an old ticket on a later day is paid in the period it was added ("Tip (added later)"), so a finalized period no longer
      drifts; sale lines now record when they were added (existing lines: when their sale closed). Tests: core `payroll.test.ts`,
      `payroll-clawback.test.ts`.
- [x] `payroll-clawback.test.ts` made date-independent, 2026-10-19: the two "20 days later" tests stamped the refund and the tip at
      `now + 20 × 24 h` but expected the calendar day `today + 20`; when that span crossed a DST change (any run from 2026-10-12 to
      2026-11-01, between midnight and 1 am local) the instant fell on the day before. Back-dated rows are now stamped at noon in the
      business's zone on the calendar day, and `TEST_NOW=<ISO instant>` runs the file as if on another date (checked on 2026-10-19 00:30,
      2026-10-31 23:30, 2026-11-01, 2026-12-31, 2027-03-13 23:30). Same commit series: `packages/core/src/permissions.ts` had an
      unescaped quote in the "Send marketing" description that stopped the whole web suite from compiling.
- [ ] Still open from payroll: the 14-hour auto-close is unchanged; no "my earnings" view or 1099 YTD; California's meal/rest-break
      premiums and split-shift pay aren't computed; salary is flat per run. (Bonuses in the overtime rate and overtime on by default: done.)
- [x] Scheduled automations, 2026-10-16 (migration 0099): "We miss you" (no visit) only reaches clients whose last visit was N to N+7 days
      ago, so turning it on or importing years of history never messages every lapsed client at once; its page shows how many it would reach.
      Birthday and no-visit workflows are scanned once a day (`workflows.last_scan_on`) with one query that skips clients already messaged,
      runs start in batches of 200 in one transaction and send together; suspended businesses are skipped; 29 February birthdays fire on the
      28th in other years. Tests: `server/__tests__/scheduled-workflows.test.ts`, `lib/__tests__/workflows-logic.test.ts`.
- [x] Sales permissions, 2026-10-16 (migration 0100): roles that see only their own calendar see and work only on their own tickets
      (credited on a line or rang it up) and can't move credit between staff; new permissions "Discounts and price changes" (discount, price
      edit, void; Manager and Front desk) and "Issue free gift cards" (Manager). Test: `server/__tests__/sales-scope.test.ts`. Note: the dev
      "View as" switch keeps your real user, so as the demo owner you still see tickets you rang up.
- [x] Public links, 2026-10-16: manage, confirmation, forms, review, order and unsubscribe links work while online booking is off (or the
      trial has ended); the booking page itself says booking isn't available and gives the phone number. Online gift cards no longer need the
      store turned on, and the store no longer sells gift cards when online gift cards are off.
- [x] Reminders and classes, 2026-10-16: unticking "Send confirmation" (desk, single or standing) no longer drops the reminders; the API
      has `reminders` (default true) separate from `notify`. A visit booked inside the reminder window skips the reminder (the confirmation
      covers it). Moving a visit restarts only flows timed from the visit (fresh each move, so moving back still reminds) and no longer
      re-sends "booked" messages like the new-booking alert. Online class seats must match their session's service (no free-service id
      carrying a paid seat) and the booking window; cancelling a class refunds every seat's deposit (failures flagged and logged). Tests:
      `reminder-timing.test.ts`, `classes-money.test.ts`.
- [x] Booking and ops guards, 2026-10-16: a double-tapped online booking no longer refunds the deposit its twin request just booked with
      (and lands on the confirmation); a client can't remove the saved card holding an upcoming booking or paying an auto-renewing
      membership; waitlist entries need a bookable service (and a stylist who does it), a day inside the booking window, and at most 5
      open per client; desk booking and drag refuse a time the provider is teaching a class; standing appointments at a custom time (off
      the slot grid) book when inside working hours. `/api/health` checks Postgres (200 / 503): set it as the Render health check path.
      Low-stock digests skip suspended businesses; `migrate-files` carries a cursor (`next` → `?after=`) past files that fail and counts
      only rows it actually moved. The staff account page signs devices out by session id (tokens no longer rendered). Test:
      `booking-guards.test.ts`.
- [x] Sign-in hardening, 2026-10-16: a password reset signs every other device out; linking Google to an account whose email was never
      verified removes that account's password and sessions (closes the "pre-register someone's email" takeover); accepting an invitation
      needs a verified email (with a resend link that returns to the invite); dev mobile origins aren't trusted in production; an expired
      trial closes the REST API (402 `subscription_required`) and the mobile app like the staff app; server actions can no longer slip past
      the trial lock by posting to the billing page (only the billing actions run while locked). **Pending invites from people who never
      verified their email now need them to verify first.**
- [x] Visibility and feeds, 2026-10-16 (migration 0101): API 500s and failing job steps go to `ERROR_WEBHOOK_URL` (shared `lib/report-error.ts`)
      and the notifications job answers 500 when a step fails, so the cron's `curl -f` alerts; the daily billing reconcile and signup nudge
      claim their day in `job_markers` (no more skipped days when a run is late); job secrets compared in constant time. Calendar feeds stop
      for inactive staff and deactivating someone rotates their link; ICS text is escaped and folded per RFC 5545.
- [ ] **Set `ERROR_WEBHOOK_URL` on Render** (a Slack or Discord incoming webhook) so these alerts reach someone.
- [x] Catalog and inventory, 2026-10-16: saving a stylist's services keeps their hidden (inactive) ones and custom prices; receiving a
      purchase order locks it and never takes more than is outstanding (a doubled receipt adds stock once) and values the receipt at the
      price paid; "Receive stock" and scanned deliveries go in all-or-nothing; a $0 retail product can't be rung up or listed online, and a
      product group switched back from back-bar stays off the online store until priced; the same product on two cart lines counts once
      against stock; uploaded SVGs are drawn into WebP (no script on our image domain). Test: `catalog-fixes.test.ts`.
- [x] Money, second batch, 2026-10-16 (migrations 0102–0103): payments, deposits and membership subscriptions remember the Stripe account
      that took them (backfilled), so refunds and cancellations survive a location switching accounts; membership plan prices are kept per
      account; refunds made in Stripe's dashboard are recorded from the webhook (once, even when our own refund's webhook races us) and
      disputes are logged and emailed to the owner; the last package session or membership credit can't be spent twice, and a plan's credits
      only cover its included service (checked on the server); points are earned on services and products only, not gift cards, packages,
      fees or what was paid with points; points can be redeemed twice on one ticket. Test: `money-tail.test.ts`.
- [x] Calendar rules, 2026-10-16: every status change refuses to revive a cancelled visit, does nothing (and sends nothing) when the status
      is unchanged, and turns a clash on undoing a no-show into a message; the calendar's plain cancel no longer cancels a visit without a
      reason (it points to Cancel); a desk booking whose extra service doesn't fit is taken back out instead of leaving half a booking (a
      standing appointment skips that date and says so); moving a service to another provider takes their price (and length, for one-block
      services); a failed automatic deposit refund on an online cancel is logged, emailed to the salon and shown honestly to the client;
      desk bookings check the client and location belong to the business. Test: `status-rules.test.ts`.
- [x] Clients, 2026-10-16: a CSV import merges a row into an existing client only when phone/email AND name match (a row without contact
      details matches only a single client of that name), so families sharing a phone stay separate; imported birthdays go into the birthday
      field (MM/DD, two-digit years, impossible dates refused) instead of notes; automation texts are prefixed with the business name once;
      a rating link can be used once. Tests: `import-clients.test.ts`, `forms-logic.test.ts` (parseBirthday).
- [x] Staff and time clock, 2026-10-16: overtime counts the whole Monday–Sunday workweek even when it straddles two pay periods (the
      earlier days count toward 40 h but aren't paid twice); shifts closed automatically after 14 h are flagged on Payroll and highlighted
      on Time clock; time entries can be edited (hours, note) and every add/edit/remove is audited; web clock-ins record the person's site;
      kiosk PINs are keyed with the server secret (old ones upgrade on use) and wrong PINs are limited per kiosk; the dev "View as" switch
      only works for owners. Test: core `payroll.test.ts` (split week).
- [x] Settings and imports, 2026-10-16: a location with sales, visits or hours can't be deleted (its history stays in reports; refunds
      already follow the payment's own Stripe account); `.xls` uploads and unreadable spreadsheets get a clear "save as .xlsx or CSV"
      message instead of an error page; imported appointments get a location and future ones get the salon's reminders. Test:
      `forms-logic.test.ts` (parseTable).
- [x] Reviews and memberships, 2026-10-16 (migration 0104): the Google review link is offered after every rating, not only 4–5★ (review
      gating breaks Google's rules and the FTC review rule); a membership's "% off other services" now prices the member's service lines
      automatically (shown on the ticket, removed if the client changes, a typed price overrides it, credit-covered lines credit full price);
      repricing a plan clears its per-account Stripe prices so renewals charge the new price. Test: `member-pricing.test.ts`.
- [x] Reports, 2026-10-16: refunds are counted on the day they were made (total and per location), so a closed month no longer changes when
      an old sale is refunded; staff revenue is after each line's share of the ticket discount; the page says which date each figure uses.
- [x] Data isolation, 2026-10-16 (migration 0105): `files` (client photos, signed forms, staged client imports) now has forced row-level
      security like every business table; lookups by file id use the jobs context, writes run inside the business. A test fails if any table
      with a `business_id` lacks forced RLS (`rls-coverage.test.ts`). Demo seed scripts write files through the tenant too.
- [x] Custom domains, 2026-10-16: an address becomes active only once the salon publishes a TXT record (`_angelic-verify.<name>`, shown on
      Settings → Custom domain) proving it's theirs; addresses already active stay active. A claim that never proved ownership can be taken
      over by whoever publishes the record, and a custom hostname only serves a booking page once it is active (no more squatting another
      salon's name).
- [x] Delivery and membership refunds, 2026-10-16 (migration 0106): emails are paced to Resend's limit (`RESEND_MAX_PER_SECOND`, default 2;
      a 429 waits as asked and retries, and if still busy the message is requeued a minute later without using up one of its 3 tries). The
      cron run takes turns between businesses (10 per business per round, at most 200 each, stops claiming after 3 minutes) and sends
      appointment messages before marketing. Fixed a claim bug: the `LIMIT … FOR UPDATE SKIP LOCKED` subquery inside the UPDATE could claim
      far more than the batch (a whole campaign); it now locks the ids first, then updates them. Refunding a membership line in full (or
      the whole ticket) cancels a membership that ticket started (credits to 0, Stripe auto-renew cancelled after the commit); refunding a
      renewal ticket puts the membership back as it was before that renewal (recorded in the audit log at renewal; older renewals take one
      period and its credits off). Tests: `delivery-fairness.test.ts`, `refund-items.test.ts`.
- [x] Review per-area batch, 2026-10-17 (migration 0108): the admin database role can no longer read secrets (password hashes and
      OAuth tokens, 2FA secrets, sign-in/reset codes, API key hashes, session tokens; sessions keep who/when for "last login"; also in
      `packages/db/sql/admin-role.sql` so re-running it can't grant them back). Two equal partial deposit refunds are two refunds in Stripe
      (the key carries the deposit as it stood). Promo use limits hold under concurrency: the code is locked and uses already held (open
      tickets, upcoming bookings) count, checked where the ticket or booking is saved. Marketing emails (campaigns and automations)
      need a postal address (the business's, else the main location's) or aren't sent. Platform billing webhooks read the subscription
      fresh (out-of-order events can't roll it back). Online store holds last 60 minutes. Payroll adjustments count in the period that
      contains their start date, however its boundaries are picked. Tests: `api-marketing`, `money-tail`, `stripe-outside-tx`.
- [x] Review per-area batch 2, 2026-10-17 (migration 0109): a pay-rate change inside a period pays commission, card-tip fees and hourly
      hours (overtime included) at the rate in force on each day (salary and withholding use the end-of-period settings). Texts held while
      texting is paused for billing wait and go out once it's back (retried every 30 minutes, given up after 48 hours). Quiet hours follow
      the client's location (the visit's, else their usual one). `POST /api/v1/appointments/:id/cancel` requires `reason` or `reason_id`
      (422). Online bookings save the cancellation policy the client saw ("By booking, you agree to this policy"), when, and from which
      address; staff see it on the appointment as "Cancellation policy agreed". A class blocks its service's cleanup time; a 24:00 close
      ends at midnight (no lost last slot). Tests: core `payroll.test.ts` and `availability.test.ts`, `booking-guards`, API scope tests.
- [x] Review per-area batch 3, 2026-10-17: the web import (Settings → Import) commits every 500 rows, so a long file can't time out and
      roll everything back, and a re-run skips what landed (the Vagaro script stays one all-or-nothing transaction on purpose). Payroll
      runs have overtime on unless the run turns it off (also the export). Emails and texts link to the salon's own domain once it's live
      (`siteUrl`; unsubscribe links stay on ours). Catalog: a blank cost in bulk edit keeps the cost; category, supplier and location ids
      from forms must be the business's own (`server/own-ids.ts`); a flat deposit can't exceed the price; a service's old picture is
      deleted only after the save; a count keeps what sold while it was being taken (the sheet and scanner send when counting began).
      `/suspended` has the support email (when set), "Your other businesses" and Sign out. Tests: `import-clients`, `catalog-fixes`,
      `custom-domain`.
- [x] Review per-area batch 4, 2026-10-17: dragging a visit to a new time in the same column moves the whole visit (each service keeps its
      place); dropping it in another stylist's column still hands over just that service. Adding time off or custom hours lists the booked
      visits that now fall outside them ("Move or cancel them on the calendar"); the bookings are left alone. Activity log: settings saves
      record what changed (business, booking policy and fees, tax, receipt, loyalty), plus custom domain add/remove, Stripe disconnect,
      clock PIN set/clear (never the PIN) and payroll exports; the log filters by area and person (`lib/audit.ts`). Tests: `booking-guards`.
- [x] Deliberate double-booking, 2026-10-17: when a desk booking clashes with another visit or a class, anyone with "Manage any
      appointment" gets "Book anyway (double-book)"; the new services are saved with `allow_overlap` (the DB constraint already skips
      those rows), blocked time still wins, online booking never sets it, the log records `appointment.double_booked`, and the calendar
      hover card says "Double-booked on purpose". Single visits only (a series still skips clashing dates). Test: `double-booking`.
- [x] Review per-area batch 5, 2026-10-17 (agents in worktrees, merged): online booking offers the times that day when the whole visit fits
      when an added service doesn't fit after the picked time; creating a client warns about likely duplicates (same phone, email or full
      name) and offers "Create anyway" (`server/client-duplicates.ts`); the mobile app's server comes from `EXPO_PUBLIC_API_URL` (else
      production / localhost by build), and sign-out from the app works (Better Auth needs an Origin: the `expo-origin` header is copied in,
      still checked against trustedOrigins); CI runs a lint step (non-blocking: eslint isn't installed or configured yet); docs-ops.md
      explains making Render wait for CI.
- [x] 2026-10-17: online store orders authorize, then capture only if the stock is still there (`capture_method: manual`). Sold out
      meanwhile: the authorization is released, the order voided and the buyer told their card wasn't charged. Orders whose page closed
      after authorizing are settled by the 5-minute jobs run after 15 minutes (`sweepAuthorizedOrders`); checkouts never paid are
      canceled and voided after 24 hours. The 60-minute cart hold stays. Test: `store-capture` (Stripe mocked). Checked in the Stripe sandbox
      2026-10-17: authorize → capture (full amount), a capture replay with the same key, and cancel-after-capture / capture-after-cancel
      both refused with `payment_intent_unexpected_state` (which the code handles). Not yet checked: manual capture with a platform fee on
      a real connected account (the demo sandbox is a standalone account and takes no fee).
- [x] 2026-10-17: payroll adjustments have "Bonus or pay for work" (migration 0112); ticked ones count toward the overtime regular rate
      like commission ("OT on commission and bonuses"). The client picker's quick add offers likely duplicates first (pick the existing
      client, or add anyway), and it now works inside other forms (it used to submit the page's own form, e.g. on Sales).
- [ ] Still open from the review (2026-10-17 audit): no client merge tool (the duplicate warnings are there; the client page could show
      "possible duplicate"); eslint + config for apps/web (then make CI lint blocking); mobile has no two-factor screen; store capture with
      a platform fee untested on a real connected account; Render "Auto-Deploy: After CI Checks Pass" is the owner's setting.
- [x] "Fix first" table from `REVIEW-2026-10-16.md` is done, including Resend pacing/per-tenant fairness, except the items listed as still open above.
      Next: the per-area lists in that file.

### Platform admin app (`apps/admin`, built 2026-10-14: tenant list with filters and CSV, usage metrics, price book and custom pricing, suspend / comp / extend trial, audit log, health page, TOTP login)
- [x] Deployed 2026-10-14 as Render service `angelic-admin` (srv-db7vr98n74is73d85io0, starter) at https://admin.angelicbooking.com
      (Cloudflare `CNAME admin`, DNS only). Production web deploy 236c5ed ran migrations 0067-0075. Login secrets are in the local `.env`
      (`PROD_ADMIN_*`, `# prod admin password:`). The authenticator-code step is supported but turned off in production (removed 2026-10-14: Cloudflare Access is the second factor); set `ADMIN_TOTP_SECRET` on the service to turn it back on.
- [x] `admin-role.sql` applied to production 2026-10-14 (role without BYPASSRLS, read policy on all 60 tenant tables, write only to pricing, audit log and the suspend/comp/trial columns). Re-run it after any migration that adds a tenant table.
- [x] Cloudflare Access in front of the admin app (2026-10-14): Zero Trust team `plain-tooth-40f9`, app "Angelic platform admin", policy "Owner only" (your email, one-time code), 8h sessions, `admin` DNS record proxied. Add a second email there if someone else ever needs access.
- [x] Password reset (emailed link) and Google sign-in are live on the admin service (2026-10-14; migration 0079 applied, env vars set, redirect URIs added to the Google client). Try both once from the real site: Google can take a few minutes to accept new redirect URIs. The service's `onrender.com` address is disabled so only the Cloudflare-protected `admin.angelicbooking.com` reaches it.
- [x] New-business guardrails are live (2026-10-15, migration 0082, commit c862f4f; see docs-ops.md): Turnstile keys on the web service, production free trial 14 days, email cap default 100/day. The one existing business (angelic-beauty) is grandfathered. Still open: file-storage limits for unsubscribed businesses; a reserved brand-name list; try a real sign-up end to end once (verification email, trial banner, locked screen via Extend trial in the admin app).
- [ ] **Test the price-book billing against the Stripe sandbox** once keys exist (built 2026-10-14, only the planning logic is unit-tested):
      `server/billing.ts` now starts subscriptions from the price book (base + extra locations + extra staff, metered texts) and
      `reconcileSubscription` (daily, in the 07:00 UTC run of the reminders job) keeps quantities in line with locations and active staff.
      Run `scripts/billing-smoke.ts <slug>` (it now exercises reconcile). Platform-wide price changes do NOT re-price existing subscribers on purpose;
      a business with its own pricing deal is re-priced. Decide if you want an "apply to existing customers" button.
- [ ] Suspend closes the staff app, booking page, client self-service links, calendar feeds, clock kiosk, mobile API and outgoing messages, and the daily sweep pauses the Stripe subscription (untested against Stripe). Stripe/Twilio webhooks still process.
- [ ] Read-only view-as / impersonation was **not** built: it needs a read-only mode enforced across every server action in `apps/web`. The admin app
      shows locations, staff and logins instead. Worth doing only if support needs it.
- [x] Settings → Billing shows what the business pays, 2026-10-19: a "This month" card (plan with its allowances, extra staff and
      locations as count × unit price, the text number, texts sent against the allowance and the 2¢ overage, the projected total with the
      billing period, next charge date, card on file, trial end or "No card on file"), an "Add-ons" card (each number with its status,
      fee and a link to Text messaging, plus "Your pricing" when the platform set a per-business price) and an "Invoices" card (Stripe
      invoices newest first, 12 a page, number, date, amount, status, row opens the PDF, "Manage payment method" to the Customer Portal,
      empty state before a customer exists). With a subscription the figures come from Stripe's upcoming-invoice preview
      (`server/billing-overview.ts`, lines told apart by product id); on trial, or when Stripe is unreachable, from the price book and
      today's counts with a quiet notice (`lib/billing-breakdown.ts`, unit-tested; `billing-page.test.ts` renders the Invoices card with
      Stripe stood in). The Settings directory's "Your plan" row carries the fixed monthly figure from the price book; a manager with
      business settings but not billing sees that row read-only (title, blurb, figure, no link); `billing.manage` still gates the page.
      Known limits: the directory figure is the price-book estimate, so a subscription started under an older price book (prices are
      not re-applied to existing subscribers on purpose) shows a different amount there than on the Billing page; a number bought while
      the fee was $0 keeps that fee on its line (the add-on shows the current list price beside it); the Stripe path was verified with a
      script against the sandbox subscription of `angelic-salon`, not in the browser (its owner login is not the demo one).
- [ ] Platform billing overview (real MRR, failed payments) once Stripe keys exist.

- [x] Render Postgres upgraded 2026-10-17 from the free tier to `basic_256mb` (about $6/month: daily backups and point-in-time
      recovery; 15 GB disk). Move to `basic_1gb` if the instance's memory graph sits high after the Vagaro import.
- [x] Unhandled errors reach someone without a Slack webhook, 2026-10-17: with `ERROR_WEBHOOK_URL` unset, `lib/report-error.ts` emails
      the summary to `ERROR_EMAIL_TO` (default `SUPPORT_EMAIL`) through Resend, throttled (one per distinct error per 10 minutes, 20 an
      hour). Setting a Slack/Discord webhook later switches it back to POSTs. Sentry still optional.
- [x] Uptime check, 2026-10-17: `/api/health` now also fails (503 `reminders: "stale"`) when the 5-minute cron has not called
      `/api/jobs/notifications` for 20 minutes (heartbeat row in `job_markers`), so one check covers app, database and cron. A
      DigitalOcean Uptime check (check `b36fc184-f0d2-44b2-9105-0b4dea55e2ef`, us_east + us_west) polls it with a "down" alert emailed
      to the owner.
      (Render emails on failed runs if enabled in the cron job's settings).
- [ ] Rate limiting is in-memory (fine on one instance). Move to Upstash Redis before scaling to 2+ instances;
      the notification claim logic is already safe for multiple instances.
- [ ] Google consent screen: add a logo (triggers Google brand verification) once a logo exists.
- [x] Logo upload (profile currently takes URLs only). Done 2026-10-10: stored in Postgres, served from `/api/files/<id>`.
- [ ] Migrate Angelic Beauty's real data from Vagaro and switch the public booking link. 2026-10-10: the full
      export (`data/vagaro-export`, git-ignored) loads with `apps/web/scripts/import-vagaro.ts` (staff + hours +
      services performed, 125 services + add-ons + classes, 9.5k clients, 4.5k appointments incl. 152 upcoming,
      future blocked time, 188 products with stock, packages + 56 client packages, 10 plans + 113 live memberships,
      120 gift cards, 1 promo code). Done locally; run it against production once the pending deploy is out
      (`DATABASE_URL=<prod, sslmode=require>`), then assign staff to locations, enable the imported classes, and
      set each location's address/phone/opening hours and name the second site "Angelic Lashes by Tiffany" (its own legal entity; the website lists it as Angelic Beauty – Fairfax) (taken from angelicbeautyva.com on 2026-10-10: Sterling
      Mon/Wed/Thu 10–6, Fri 10–7, Sat/Sun 10–5, Tue closed; Fairfax Mon–Fri 9–6, Sat 8:30–6, Sun 9–5).
- [ ] Write a short privacy/terms review with a lawyer before accepting other businesses. 2026-10-17: `LEGAL-REVIEW-2026-10-17.md` is the
      brief for the lawyer (what the product holds, subprocessors, the 13 gaps, the owner's open questions); the privacy page now names the
      subprocessors, the processor role for client data, photos/forms/notes and the texting rules. The lawyer's pass itself is still to do.
- [ ] Stripe Tax on the platform subscription: code is ready behind `STRIPE_TAX_ENABLED=1` (2026-10-17: products carry the SaaS tax code
      `txcd_10103000`; Checkout collects the billing address and tax id and turns on `automatic_tax`). Before setting the flag: in the
      Stripe dashboard, Settings → Tax, enter the head-office address and add the registrations for the states where the platform must
      collect; have the accountant confirm the SaaS code for the text-message items. Existing subscriptions are not re-priced.

### Public REST API (built 2026-10-14, migration 0076)
- [x] Business-scoped API keys (Settings → API access; hashed, shown once, scopes, expiry, revoke, 120 req/min per key), `/api/v1`
      for business, services, staff, products, availability, clients (read/create/update), appointments (read/book/update/cancel),
      sales (read). Public docs at `/developers`. Cross-tenant isolation tests in `lib/__tests__/api-isolation.test.ts`.
- [ ] Run migration 0076 on production (deploys do this) and try one key against production.
- [x] Second round 2026-10-14: locations, categories, packages, plans, staff schedule, reviews, waitlist, blocks, reschedule, client notes/packages/memberships,
      service and product create/update, inventory read and stock adjustments (scopes catalog:write, inventory:read/write, reviews:read).
- [x] Done 2026-10-14: the rate limit is counted in Postgres (`api_rate_limits`, migration 0081), so it holds across instances (falls back to
      per-process counting if the database is unreachable); every response carries `X-RateLimit-*`; lists say `has_more` exactly (one extra row is
      fetched); bodies over 100 KB are refused as they stream in (413); the spec is `public/openapi/v1.json` (`pnpm openapi` regenerates it, a test
      fails when it is stale), linked from `/developers`.
- [x] Finer scopes 2026-10-14 (migration 0084): 50 exact scopes (write no longer includes read; separate delete, book/change/cancel, campaigns:send,
      clients:consent, client-notes:*, pricing:write, policies:write, time:*, purchasing:*, forms:void, messages:resend); prices/consent/notes/switching an
      automation on need an extra scope when the field is sent; client notes and balances are left out of responses without theirs; per-key allowed IP
      addresses (the proxy's last X-Forwarded-For entry) and per-key requests per minute. Keys made before this keep every ability (scope_version 1,
      expanded on use; checked route by route: none lost, none gained). Rule for new routes: pick the narrowest scope that fits; a body field that
      sets money, consent or private data goes in `fields` of `route(...)`.
- [ ] Not done: limiting a key to one location or one staff member (every query would need the filter); a per-key usage log. (The first-entry
      `clientIp` was fixed 2026-10-16: every rate limit and recorded form IP now uses the last X-Forwarded-For entry.)
- [ ] Later: webhooks to subscribers, idempotency keys, per-plan gating of the API if wanted. Rule for new API tests: import `packages/db/src/env` first (guarded by api-test-guard.test.ts).

## 3. Product backlog

### App-wide evaluation (2026-10-10)
- [x] 2026-10-11: `DESIGN.md` added (page anatomy, lists, forms, disclosure, colour, copy, done-checklist). Full-row
      clickable lists everywhere (products, packages, memberships, clients, sales, automations, locations, services)
      via `components/row.tsx`; one `Checkbox`, `Textarea` default height, `ImageField` for every picture.
- [x] Design pass (2026-10-11): progressive disclosure across the owner app. Secondary controls now sit behind
      "details" sections that open on demand (Disclosure component): add-a-service / cancel on the appointment page;
      add-to-ticket, discount/promo and gift-card/package/membership sales on the sale page; edit details, adjust
      points and texting on the client page; clock-in PIN and calendar feed on the staff profile; cards/no-shows and
      policy on Booking rules; overtime on Payroll; custom range and exports on Reports. The setup checklist is one
      line (expandable, hideable per device); Settings is a grouped directory with status chips and business basics
      moved to Business profile; staff pay shows only the fields for the chosen pay model.
- [x] Clean-UI pass 2026-10-17 ("only what applies is on screen", rule added to DESIGN.md → Progressive disclosure), 65 files.
      Sale page: one "Add to this ticket" chooser (product / service / gift card / package / membership; kinds with nothing
      to offer are not listed), one Discount select (none / $ / % / promo code) that shows only that kind's fields, one
      "Pay by" chooser (card on file / reader / typed, cash, gift card, store credit, points; only the methods this client can
      use), refunds behind a "Refund…" button, note / late tip / goods-back as disclosures. Elsewhere: dependent fields
      hidden until their switch is on (online booking, loyalty, store shipping, late-cancel fee type, overtime rule, time-off
      custom hours, bookable-online, product retail/stock/supplier fields, membership sessions, service timing, promo
      limits, campaign audience, EIN by business type, who-completes-a-form); feature-off / empty / permission-gated
      controls hidden with at most one grey line and a link (Stripe, texting, store, referrals, suppliers, packages,
      memberships, forms, exports, finalize, send campaign, delete role, status buttons, checkout on the visit); single-option
      and empty selects replaced by hidden inputs or text; disabled-with-excuse buttons removed; public site: "Any provider"
      only with 2+ providers, gift-card recipient fields behind "it's a gift", past visits on the manage page.
      Left for a product decision: a `Radio` component (cancel-form deposit choice, store pick-up/ship still hand-written);
      an inset `Disclosure` variant for panels inside a Card (client page, booking settings use hand-rolled details);
      reopening a completed visit (every other status button still shows); skipping the provider step when one person
      offers the service; the weekly-hours grid still greys out closed days' time boxes; Settings → Payments webhook card
      is platform-operator text shown to every owner.
- [ ] Work through `ENHANCEMENTS.md` (full page-by-page review, ~250 items, P1/P2/P3). P1s first: public
      `/api/files/[id]`, checkout refund/credit/discount math, reminders after cancellation, open redirect via
      `?next=`, role sync, waitlist/time-off UTC "today", client picker cap, calendar hours/overlap/drag validation,
      booking-page waitlist and provider filter, promo validated after deposit, import staging on tmpdir.
- [x] Landed 2026-10-10 (batch 1): private form/signature files, open-redirect guard, waitlist/time-off "today" in
      the business timezone, payroll commission on package/membership-covered services, reminders dropped on
      remove-last-service and series cancel plus a sweep before every delivery run, promo dates in the business
      timezone, Better Auth invite/role/remove hooks enforce our `members.manage`, permission errors survive
      production builds, `clients.read` on client pages, import staging stored in the database.
- [x] Landed 2026-10-10 (batch 2, public booking): full days on the calendar are tappable to join the waitlist (closed
      days excluded), the provider step only lists staff who perform the service, month availability runs one query
      set per provider instead of per day, promo codes are validated before a deposit is charged, token pages
      (confirmed/manage/forms/review/unsubscribe/order/account) are `noindex`, the order page needs a signed key and a
      paid sale, review opt-out and unsubscribe confirm on POST instead of mutating on GET, slot re-validation uses the
      location's clock.
- [x] Landed 2026-10-10 (batch 3, checkout money; migration 0046): the discount is stored as entered (percent or
      amount) and re-applied as lines change; promo codes only discount their named services and never stored value
      (gift cards, packages, memberships); "Remove code" on the sale page and a typed discount replaces a promo;
      removing a credited line or voiding the sale gives the package session / membership credit back; expired
      packages and lapsed memberships can't be redeemed; gift-card balance updates are atomic; two same-amount gift
      cards (or packages) on one ticket both issue; refunds put money back on gift cards, trim the payment's tip, and a
      full refund takes back earned points (it no longer restocks products; see the 2026-10-13 inventory entry), releases the promo use, deactivates unused gift cards
      and removes untouched packages; "Sell a gift card…" errors show as a toast instead of an error page.
- [x] Landed 2026-10-10 (batch 4; migration 0047): form questions that depend on an unticked box show from the start;
      an untouched signature pad never posts a blank image; an open time-clock entry older than 14 h is auto-closed at
      the cap and marked; client search matches "Jane Doe", "Doe, Jane" and phone digits in any format (list, ⌘K);
      calendar check-in/complete buttons show on touch screens and keyboard focus, touch no longer starts a drag (tap
      opens the visit), the staff filter is week-only, view switches keep the location, "Expected" excludes no-shows;
      Rebook link on the appointment and sale pages (same client/service/provider, four weeks out); failed sends retry
      up to 3 times with backoff and Settings → Messages has "Send again" on failed/skipped rows.
- [x] Landed 2026-10-10 (batch 5, calendar grid): time outside each provider's hours (and whole days off / closed
      days) is hatched in day and week view, the grid widens past 7am–9pm to fit early/late hours or bookings,
      overlapping cards share the column side by side, and a drag is refused with a clear message when it lands
      outside the provider's hours or on a provider who doesn't perform the service (the same qualification check now
      applies when adding a service to a ticket).
- [x] Landed 2026-10-10 (batch 6, front desk): New appointment has a client type-ahead (name, phone or email, any
      number of clients) with inline "New client", an exact-time field for walk-ins that already started (works even
      when no slot is open), and "Add another service" to book a cut + colour back to back with the same provider
      (slots are computed for the whole chain); a Sales page (Money → Sales: open tickets, today, all, search by
      number or client) with "Start sale" for retail/gift-card tickets without an appointment; an open walk-in ticket
      can attach or detach a client; Reports keeps its own nav entry.
- [x] Landed 2026-10-10 (batch 7; migration 0048): Block time from the calendar (lunch, late start, "do not book")
      as `appointments.kind = block` with a hatched card, its own create page and a Remove button; checkout prompts
      for outstanding required forms ("Complete forms now" / "Check out anyway"); services can be added to an open
      ticket at the desk and any line's price, quantity or staff credit edited; a voided ticket no longer blocks
      checking the visit out again. All P1 items in `ENHANCEMENTS.md` are now ticked.
- [x] Landed 2026-10-11 (menu + booking page; migration 0049): service categories nest (Hair › Colour › Balayage) and
      carry a description and image; services have a photo; Services in the sidebar opens a category browser
      (tiles → category page with sub-categories and services → All services list); category create/edit pages
      with image upload. Public booking page redesigned: hero with cover/logo/rating, step progress bar, category
      tiles with drill-down, service cards with photos, provider cards, grouped time slots, a summary card on every
      step. Pay models combine (hourly or salary + service commission; commission + hourly base) in payroll math,
      the Payroll page and the workbook. Forms have a shareable link + QR (`/book/<slug>/forms/<id>`; the client
      identifies themself, or is signed in). Demo tenant: `apps/web/scripts/seed-demo.ts` (see docs-ops.md).
      Form validation errors always show a top banner (never silent). Staff profile save could not be reproduced
      locally (profile, PIN and hours all save); production was 39 commits behind at the time, so retest after deploy.
- [x] Landed 2026-10-11 (migration 0050): reviews store the visit's location (backfilled from appointments); the
      Reviews page filters by location, provider and date range (quick ranges), with a star breakdown, answer rate
      and per-provider averages that follow the filters.
- [x] Landed 2026-10-11 (workflows; migration 0051): automations are workflows (trigger → filters → ordered steps)
      with guardrails in code (consent, STOP notice, 9am–8pm quiet hours for marketing triggers, once per occasion,
      stop-on-rebook, runs re-timed on reschedule and dropped on cancellation). Ten pre-built templates per business
      (pre-visit, rating request, rebook, no-show follow-up, aftercare, welcome, birthday, we-miss-you, membership
      payment failed, low-rating alert); the old fixed automations and the review-request switch were converted once
      into them. Triggers: booked, completed, cancelled, no-show, new client, form submitted, review received,
      membership payment failed, birthday, no visit for N days. Steps: wait (delay / before / after the visit), text,
      email, rating request, tag, points, notify owner or provider. Filters: category, service, provider, location,
      tag, rating range, first visit only. Marketing → Automations lists them with 30-day send counts; each workflow
      page has the step editor and a run log that explains every step. Still to do: a "send me a test" button, a
      projected-sends estimate before enabling, and dropping the unused `automations` table after a deploy.
- [x] 2026-10-18: automation engine fixes from REVIEW-2026-10-18 Part 1b (items 1–9) and 1f. Marketing vs transactional is decided
      per message step (`lib/workflows-logic.ts` messageConsent): aftercare / welcome texts within 72 h of the visit or sign-up need only
      text consent and no STOP notice on every message (STOP is still honored at send); later steps and birthday / no-visit stay
      marketing; quiet hours 9am–8pm now hold every text except the reminder and the booked / cancelled confirmations; the step editor
      says under each text or email which consent it needs; transactional emails go through `transactionalEmail` (no unsubscribe link).
      Stop-on-rebook counts any future booked / confirmed visit (pre-booked at the desk included), checked before every step, and every
      booking path (desk without confirmation, series, API notify:false, import) runs `afterAppointmentBooked` (booked workflows + stop
      the client's rebook runs); API notify:false, reminders:false still starts the booked workflows without a reminder step. API
      reschedule / move / cancel / item delete / cancel-series resync runs with or without notify, and a visit-timed wait is re-derived
      from the appointment's current time when the cron wakes it. Each run advances in its own transaction (`advanceOne`; the cron
      leases due runs for 10 min): a throwing step marks that run `failed` (error in its log, reported) and never touches other runs or
      tenants; the trigger entry points report and swallow errors so a workflow bug can't fail a booking. `firstVisitOnly` counts only
      completed visits before this one. Run logs say "queued" at queue time and delivery appends sent / skipped / failed (`runOutcome`
      drives the badge and the API's `outcome`); log times read in the business's zone; the run page shows the whole log. Dropped:
      `renderWorkflowText`, the `void isNull` placeholder, the `pre_visit` conversion branch. Tests: `lib/__tests__/workflows-logic.test.ts`,
      `server/__tests__/workflow-engine.test.ts`, `reminder-timing.test.ts`. Not verified live: Twilio / Resend sends (the log append
      runs on the real send path, exercised in tests with no provider configured). Follow-ups: `server/import.ts` perRow uses a raw
      savepoint inside one transaction, which postgres.js rethrows at commit (same trap the engine just left); review items 10–12 (client
      time zones, DST, `cancelRuns` log races, placeholders) are still open.
- [x] Landed 2026-10-11 (migration 0052): "Before your visit" prep notes on services and categories ride on the
      confirmation and reminder (email box + text suffix) for the services booked; the reminder is the
      "Appointment reminder" workflow template (wait N h before → reminder step with the standard wording), created
      with each tenant's existing lead time, restarted when an appointment moves and dropped when it is cancelled.
      The pre-visit template and the separate reminder-hours settings are gone. `businesses.reminder_hours` is only
      read once, at template creation; drop it after a deploy.
- [x] 2026-10-11: second demo tenant `demo-twosites` (Glow Collective, two locations) via `seed-demo.ts --profile glow`.
- [x] 2026-10-11: staff weekly hours take any number of blocks per day (press + for a lunch break or split
      shift; blocks must not overlap); time off / custom hours take a first and last day and write one override per
      date, listed as one range with a single Remove.
- [x] 2026-10-11 (migration 0055): rotating schedules. Hours repeat every 1–4 weeks (`staff.rotation_weeks`,
      `rotation_anchor` = Monday of a Week 1 week; `staff_schedules.week_index`). The hours page shows Week tabs,
      "This week is Week N" and Copy Week 1; availability, calendar shading, booking location and the per-weekday
      location index all pick the active week (`rowsForDate` / `rotationWeekIndex` in core).
- [x] 2026-10-11: findability pass. Schedule → Staff hours overview (business hours per location with Edit, who
      works when with rotation weeks and sites, time off in the next 90 days, Block time); Marketing opens with
      link cards for Automations, Loyalty and review requests, Loyalty links back; Payroll, Sales and
      Reviews link to the matching report slice (period + location carried), Reports → Payroll; sidebar, Settings
      directory and ⌘K pages come from one definition (`lib/nav.ts`, see DESIGN.md → Navigation).
- [x] 2026-10-11: sidebar groups: Money is Sales, Reports, Payroll; new Grow group holds Marketing, Automations and
      Reviews (Automation group and Reviews-under-People retired).
- [x] 2026-10-11: Schedule → Appointments list (Upcoming / Today / Recently booked / Past; filter by how it was
      booked, status, provider, location; search client, phone or service; rows open the appointment; online
      bookings carry an "online" chip with when they came in). "New online booking" automation template (team
      group, on by default) emails the owner and the provider when a client books online; automations gain a
      "Booked online only" filter and templates added later are topped up on the next trigger.
- [x] 2026-10-11: appointment page shows the visit's rating (stars, date, comment, link to Reviews) or that a rating
      was requested and not yet answered.
- [x] 2026-10-11: client page History is one timeline: past visits with their ticket total (open tickets flagged
      "due") and the rating + comment inline; sales with no visit (retail, gift cards, open tickets) as rows of
      their own; separate Sales and Ratings cards removed; average rating in the History header.
- [x] 2026-10-11: client page opens with an at-a-glance strip: client since (first completed visit, else record
      created), visits with upcoming / no-shows / cancellations, spent (paid tickets net of refunds, excluding tips)
      with average ticket and tips, next or last visit with an overdue flag against their usual cadence, and
      usual service, provider and visit frequency (`clientStats` in server/clients.ts).
- [x] 2026-10-11: Loyalty & referrals page shows activity under the rules: this month vs last (points issued and
      redeemed, referrals joined and converted), top referrers and recent referrals, each linking to client pages
      and Reports.
- [x] 2026-10-11: referrals made visible. Client page: referral code with "Text it" / "Email it" (consent-aware,
      one-off notification), the referrer's name on referred clients with the bonus date, and the list of clients
      this person referred with first-visit status. Reports → "Referrals" (who referred whom, joined, first paid
      visit). Codes are created at checkout for anyone once referrals are on, printed on the emailed receipt, and
      available to automations as {referral_code}; new "Refer a friend" template (off by default) after a first
      paid visit.
- [x] 2026-10-13 (migration 0066): image storage on Cloudflare R2, live locally. Buckets `angelicbooking-public`
      (served at images.angelicbooking.com) and `angelicbooking-private` exist; `scripts/r2-check.ts` passes and a real
      upload, delete and one-file migration were verified. Uploads are resized (1600 px, 2000 for covers, 800 for
      logos and staff) and re-encoded as WebP, dropping EXIF/GPS. Without the `R2_*` variables everything stays in
      Postgres. Old `/api/files` links redirect to the CDN. Deployed 2026-10-13: all six `R2_*` variables are on Render and the
      production migration job found nothing left in the database (production holds no pictures yet), so new uploads there
      go straight to R2. Restart the local dev server to pick up the R2 variables.
- [x] 2026-10-15 (migration 0085): clients have a profile photo (new client form, Edit details, avatar on the client page) and
      product categories have an image (new and edit pages; the list shows thumbnails). Not yet shown on checkout or booking.
- [x] 2026-10-13 (migration 0067): before/after photos and a Gallery. Photos belong to the appointment (and its service and
      stylist), with tags and a "client agreed to public sharing" record per pair; added from the appointment's Photos
      card (tap, shoot, uploads at once), stored privately with thumbnails. Gallery page (People) filters by service,
      stylist, tag, time, client, location, complete pairs and shareable; client page shows that client's pairs. Not
      built: a public portfolio page or booking-page gallery (consent is recorded, nothing is shown publicly), photos
      from the stylist-only (own calendar) view, and client-visible photos in the client portal.
- [x] 2026-10-13: demo data refreshed and made refreshable. Both demo tenants now show time off and blocked time, waitlist,
      referrals, classes with seats, standing appointments, client memberships and packages, notes, submitted forms,
      campaigns, texts, refunds, payroll runs and Gallery photos; staff have different days and hours so coverage differs
      by category and day (and by site on the two-site tenant). Run `pnpm demo:refresh` (about 30 s) before a demo and
      monthly; everything is relative to the run date. Automated: the macOS launchd job `com.angelicbooking.demo-refresh` runs it every Monday
      at 6:00 (log: ~/Library/Logs/angelic-demo-refresh.log; if the Mac is asleep it runs on wake).
- [ ] 2026-10-13: hosted demo refresh on Render. Code done and committed (demo businesses never send email or text,
      DEMO_PASSWORD, DEMO_ALLOW_REMOTE guards; settings in docs-ops.md "Hosted demo"). Left: push, create the cron job
      `angelic-booking-demo-refresh` (my Render API call was blocked by the safety classifier, so it needs the user or a
      permission rule), set its env vars, trigger the first run, and check `/book/demo-salon` on app.angelicbooking.com.
- [x] 2026-10-13: Staff hours has a People / Coverage switch: People shows who is in each hour (as before), Coverage only tints each
      stretch by whether every service category is covered and names what is missing. `?view=coverage`, kept when other filters change.
- [x] 2026-10-13: no more long service dropdowns. The Gallery, appointment "Add a service", membership plan and embed builder use the
      searchable ServicePicker (Gallery lists only services that have photos); the picker now shows its choice immediately and has
      `compact` / `onPick`. A test fails on any plain select of all services; DESIGN.md has a "Choosing a service" section.
- [x] 2026-10-13: the Gallery's service filter also takes a whole category ("All of Lash Extensions", includes sub-categories) from the same picker;
      Appointments and Reports now have the same service / category filter (Reports = sales that include it; pay, store credit, refund
      reasons, referrals and stock are hidden while it is on; CSV exports follow it). The Gallery picker offers every service and category,
      not only those with photos.
- [x] 2026-10-13: calendar hover card on every appointment, block and class (client, phone, status, all services with staff and times, price,
      how booked, deposit, forms due, tags, notes); content in `lib/calendar-tip.ts`, tested.
- [x] 2026-10-13: calendar week view opens on an Everyone overview of plain coloured blocks (no text; hover for details, click to open) with a colour legend,
      and a picker for one stylist's full week; the staff picker applies on change (no Go button).
- [x] 2026-10-13: calendar header is identical in Day/Week/Month (week-only picker and legend moved to their own row); the way back to now is Today /
      This week / This month; Block time and appointment pages use the shared BackLink on the left (test fails on a hand-written back link); LinkButton now
      passes aria-label through, so icon-only link buttons have names.
- [x] 2026-10-13: Roles is in the People section of the sidebar (people who can manage members); Settings steps aside on its pages.
- [x] 2026-10-13: Provider role works: their calendar is only their own column and appointments, they can open and update their own appointments (status, notes,
      photos, checkout), the day strip's Expected revenue needs the reports permission, and the hover cards follow because the calendar does. Dev-only "View as"
      pill to test any role (and Provider as a given stylist). The owner can also grant a Provider (or any role), under Roles & permissions, three more abilities that are off by default: book on their own
      calendar, change their own bookings (services, moving, dragging), cancel their own (with fees and series), and block time on their own calendar. All of it is table-driven
      (`APPOINTMENT_CAPABILITIES`) and decided by permissions, never by role names (test fails on a role-name check); the invite form and invitation acceptance follow what a role
      can do. Existing businesses' stored roles do not gain new permissions automatically: the owner opts in under Roles. Still to do: a linked login for each stylist (invite from Staff).
- [x] 2026-10-13: Staff hours: People view drops the colored coverage strips (they stay in Coverage view with their legend), and an "Edit hours" menu in the header lists each provider and opens their Weekly hours.
- [x] 2026-10-13: Inventory, built out (migration 0068). Stock is per location (`product_stock`; `products.stock_qty` stays the total) and changes only through
      `server/inventory.ts` (a test fails otherwise). Refunds no longer restock: the product may be gone (never arrived, goodwill), so a client's return is recorded on purpose
      ("Goods back on the shelf" on the sale, capped at what the sale took). A sale never stops at the desk for a wrong count: the register warns ("only N in stock"), the count may
      go negative and shows as "Count is off", and a correction is allowed; by hand, stock can't go below zero. New permission `inventory.manage` (Manager by default, stored Manager roles
      updated by the migration; owners grant it to others). New Inventory section (sidebar, with a count of what needs attention): Stock (search or scan a barcode, per-location,
      value at cost/retail), Reorder (suggestions to each product's "order up to" level, counting what is on order, grouped by supplier, drafts an order), Orders (draft → ordered →
      partly/fully received with cost updates, email the supplier), Suppliers, Count (blind or not; only differences are corrected), Report (running out, best movers, not moving,
      damage/theft/expiry losses, value by month), Receive stock (no order). Products gain barcode, size/shade options (same name + an option label), back-bar kind (counted, never sold; each service
      lists what a visit uses and the sale takes it off), usual supplier, order-up-to; Edit all, Import (check first, matches by barcode/SKU/name) and Export spreadsheets. Write-off reasons: damaged,
      stolen, expired, lost, sent back; transfers between locations. Online store holds stock for unpaid carts (30 minutes) and locks while checking, so two buyers can't both take the last one.
      Daily low-stock email to owners and inventory managers (after 8am local, from the reminders job). Demo data has suppliers, four orders, back-bar and a history.
      `pnpm --filter @angelic/web inventory:check` exercises the logic against the demo data. Refund form: "Did the client bring goods back?" puts chosen units back on the shelf in the same step (off by default). Alerts and reorder suggestions are per location (a location with none that never sold or used the product there stays quiet; back-bar products alert where the services were done); each location's shortfall is its own draft order, delivered there. Not built: serial/lot tracking and expiry dates per batch, automatic supplier ordering (orders are written, not sent), counting
      by scanning each unit.
- [x] 2026-10-14: Supplies used (migrations 0069, 0070). Staff log what they use: **Log usage** (Inventory tab, and "Log supplies" in the sidebar for roles that only log) is a search box: type part of a name, press Log (whole
      units; it shows what you logged recently first; the location defaults to the person's own site), and each visit's page has a "Supplies used" card with a searchable picker and "Take back". New permission
      `inventory.log` (Provider, Front desk, Manager by default). Logging may take a count negative (never stop work mid-service). The per-service "Products used" list (automatic or suggested amounts) was removed: nothing is
      taken off by itself when a service is rung up, and `service_products` is dropped. A product can be both sold and used; one stock, and the report separates them. Every movement keeps its unit cost, and Inventory → Report
      splits cost of goods sold from supplies used. Not built: fractional units, an "open box" area.
- [x] 2026-10-14: Log usage, faster (migration 0071): the search matches name, category, barcode and SKU, and Enter logs a scanned code (or a single match) then clears the box and keeps the focus; a category dropdown; star
      products to pin them per person (above "recent"); "Take back" on your own entries in the team list (once; anyone's if you manage inventory; entries logged on a visit are taken back on that visit); bigger tap
      targets, a sticky search bar and Units + Log side by side on a phone. Inventory → Report gains "Supplies by service" (cost per logged visit, share of the price, how many visits were logged) and
      "Supplies by stylist" (average per logged visit against the team, shown as too few under 3 visits); a visit's supplies are shared evenly across its services. Demo data has supplies logged on visits.
      Not built: profit per service in the main sales reports, in-transit transfers, supplier pack sizes and lead times, expiry and lots.
- [x] 2026-10-14: Scan to receive and scan to count. **Receive stock** is now a scan screen (the typed-quantities form is under "Type quantities instead"): point the scanner, each scan adds 1 (or type the number), a beep says it
      registered, the box keeps the focus, nothing is saved until "Add to stock". An unknown barcode asks which product it is and remembers it (a product keeps one barcode; replacing it is deliberate). Orders have
      "Scan the delivery": each line shows how many came and how many are still to come, extras and items not on the order are flagged, and what came earlier is counted. **Count → Scan to count**: each scan is one
      unit, with the book's number and the difference shown as you go; products you didn't scan are left alone unless "anything I didn't scan is none" is ticked. UPC-A and EAN-13 forms of a code match each other.
      Works with USB and Bluetooth scanners that type like a keyboard.
- [x] 2026-10-14: Scanning, round two (migration 0072). **Camera scanning** on every scan screen and on Log usage: the phone's camera reads barcodes (the browser's own reader where it has one, otherwise a reading library loaded only
      when the camera is opened), the same code is ignored for 2 seconds, it vibrates, and a blocked or missing camera says so. **More than one barcode per product** (a case, another pack size): a scan of it adds that many
      units; teach it when an unknown code is scanned ("Add as another barcode", with the pack size) or on the product's page ("Other barcodes"); a code can belong to only one product (barcode, other barcode or SKU).
      **A scan that matches nothing can make a new product**: name, sold or back-bar, category, price and cost, created tracked with the scanned barcode, counted into the delivery. Log usage now beeps (and buzzes on a code
      it doesn't know, with a message), reads other barcodes, and has the camera. Camera reading was not tried with a real camera here (the preview blocks it); the reader's setup is tested against drawn EAN-13 and UPC-A
      barcodes. Not built: torch/zoom controls, scanning on the register's own add-product box beyond the existing barcode field.
- [x] 2026-10-14: Real product options (migration 0073). A product can come in sizes or shades: a parent (`product_groups`) holds the shared name, category, kind, photo, description, tax, online store and supplier; each option is its own product (label,
      price, cost, SKU, barcode, stock, low-stock and order-up-to levels). New product: type the options one per line, and a second list to make every combination (7N / 50 ml…). A product on its own can become one ("Comes in sizes
      or shades?" on its page). The group's page edits what they share (every option follows), lists the options, adds more (duplicates skipped; a new option takes the first option's price), and hides or shows them all. The product list folds
      options under their product (price range, total stock, worst standing; expand to see each); Stock groups them under a heading with their total; the online shop shows one card per product with its options beneath;
      an unknown scan can become a new size or shade of a product; spreadsheet rows with an Option join (or create) the product of that name. Existing products that were already "same name + label" were grouped by the migration.
      Option photos and the shop dropdown (2026-10-14, later): an option can have its own photo (on its page); without one it uses the product's and follows it, and one with its own keeps it when the product's changes; removing it goes back to the product's. The shop shows one card per product with a dropdown of its options (sold-out ones marked, the first buyable one chosen), the chosen option's price, stock note, photo and quantity, and chips for options already in the cart. Not built: per-option supplier shown on the group page, deleting a group (hide it instead).
- [x] 2026-10-14: Review fixes. (1) One rule for codes: typing a barcode or SKU on a product now checks it against every product's barcode, other barcodes and SKU, ignoring case and leading zeros, the same as scanning (only when the
      code is being set or changed, so older data that already shares one can still be saved). (2) A wrong delivery can be undone: from the order ("Deliveries received") or a product's history; the stock and the order's received
      count and status go back and it can be entered again; refused once some of it has gone (correct the count instead); once only. (3) The Products list has a search (name, option, SKU, barcode, another barcode, category; a scanner
      works in it) and a filter (out/low/off, back-bar, hidden); a product with options stays whole when any option matches. Still open from the review: closing a partly delivered order, supplier on options vs the group, the
      option heading total on the filtered Stock page, barcode labels, printable orders, in-transit transfers, expiry/lots, kits, costing by average.
- [x] 2026-10-14: Stock history page (Inventory → History, `inventory.manage`). Every stock movement newest first, 50 a page: change, product (opens it), reason in words, location (when there are several), who, note, and links to the sale, order or visit behind it; undone and "takes back" lines are marked. Filters: search (product, option, SKU, barcode, note), period (7/30/90 days, all time, or custom dates read in the business's time zone, end date included), reason (a whole group - coming in / going out / corrections - or one reason), person (or "nobody (automatic)"), location. Totals for what is filtered: units in/out and value at cost (the line's unit cost, else the product's). Export CSV (up to 10,000 lines, same filters). The product page's ledger links to "See all history" for that product; also in ⌘K. Pure parsing in `lib/history-filter.ts`; query `stockHistory`/`historyPeople` in `server/inventory.ts`; integration checks 44-46.
- [x] 2026-10-14: Service form timing in plain words: Hands-on time, Waiting (client waits, you're free), Then finish, Clean-up, with a live line saying what the numbers do to the calendar and a warning when a wait has no finish
      time (the booking rules only free the stylist during a wait when a finishing block follows it).
- [x] 2026-10-13: every upload is optimized, enforced in one place (`optimizeUpload`) and guarded by a test; form photos
      resized, GIFs become WebP, signatures recompressed, SVG capped at 512 KB; rule added to DESIGN.md. Limits: HEIC form
      photos stay as sent (the image library cannot read HEIC); SVG is not minified.
- [x] 2026-10-13: stylist prices and durations. Each stylist can charge their own price and take their own time
      for a service (`staff_services` overrides, already filled by the Vagaro import); blank = the service's own.
      Fixed: saving a stylist's Services tab used to delete every override (it now keeps them, and a value equal to
      the base is stored as "use base"). Edit them on the stylist's Services tab (price + minutes beside each ticked
      service, bulk "add $ / add %") or on the service's page ("Prices by stylist" table). Public booking: service
      rows say "from $X" when providers differ; each provider tile shows their price and length; "any provider"
      time chips show the price; the details step quotes the exact stylist's price and the server refuses the
      booking, before any deposit, if that price changed meanwhile. Open times use each stylist's own length
      (public, series, add/move service). New appointment lists each stylist's price/length when they differ.
      `server/stylist-pricing.ts`. Not changed: deposits stay per service; packages and memberships still cover a
      line whatever its price; classes use the service's price per seat.
- [x] 2026-10-15: "Any available provider" rule is a salon setting (migration 0089, `businesses.any_provider_mode`, also
      `any_provider_mode` in the settings API). Settings > Online booking: show who is free and let the client choose
      (default: the time list says "2 available · from $45" and tapping it opens "Who would you like?"), or give it to
      the first in Staff order / the lowest price / the fewest bookings that day. `getPublicSlots` now returns `free`
      (everyone open at each time) and picks `staffId` by the rule. Fewest-bookings counts non-finish items on that day.
- [x] 2026-10-15: booking order is a salon setting (migration 0088, `businesses.booking_order`). Settings > Online booking >
      "Order of steps" (needs `business.manage`; also `booking_order` in the settings API). Provider first (default):
      service, provider, time, details. Time first: service, a calendar across everyone, then only the providers free at
      that time, then details. Clients cannot switch; `?order=` in a URL is ignored.
- [x] 2026-10-15: booking flow navigation and provider order. A "Back" button on every booking step (goes to the fixed
      previous step, keeps the chosen day). Staff page has up/down arrows: that order is the provider order on the
      booking page (`moveStaffAction`, numbers active staff 0,10,20…); the staff list now shows active people first.
      Provider step has Sort: Recommended (salon order) / Soonest / Lowest price (when prices differ), shown above 2
      providers. Not walked live: the staff arrows (needs a signed-in session) and the sort pills.
- [x] 2026-10-15: booking page, client-trust pass (migration 0087). Provider cards show rating + review count, next opening,
      title and up to three work photos (tap to enlarge; edited on the staff profile, `staff.work_photo_urls`); signed-in
      clients get "Book with <last stylist> again"; the deposit reason and the free-cancel window / late fee show before
      a time is picked; clients can add more services to one visit with the same stylist, back to back
      (`planExtras`, extras booked in the same transaction as the first; the deposit/"pay in full" amount uses the visit
      total). Not walked live: the paid (Stripe) path with extra services. Demo prices and photos are SQL, not in the seed.
- [x] 2026-10-15: stylist title on the booking page. The existing staff `position` (was only on the Pay page) now also has a
      "Title" field on the staff profile and shows under the name in the provider list, the "With" line, and the
      higher-price note, so a higher price reads as seniority.
- [x] 2026-10-15: booking self-service fixes. Reschedule uses the same month calendar as booking (`book/[slug]/calendar.tsx`),
      can change provider (single service) or move a whole multi-service booking together (`rescheduleAppointment`), and
      shows the free-change deadline; Cancel states the deadline, deposit refund and late fee up front. Confirmation shows
      total, deposit paid / due, address, phone and policy. Class list shows description and price; going back to Edit in
      the paid form cancels the unpaid Stripe intent; calendar-shaped loading skeleton. Not walked live: an actual
      reschedule/cancel submit, multi-service move, and the Stripe edit-cancel (needs live keys).
- [x] 2026-10-15: booking page review fixes. Service search (shown above 8 services); the Provider step is always shown, even with
      one provider (owner decision); multi-location salons get a "Change" location line on every step; one shared
      `ContactFields` for the free and paid forms, with promo/referral codes behind "Have a code?"; paid form labelled
      Step 1/2 and 2/2 and uses the shared `Button`; waitlist pre-fills for signed-in clients; dead ends link to another
      service or a tel: link. Not yet walked live: the details form and the Stripe payment steps.
- [x] 2026-10-16: no guessing who gets credit. Adding a product, a service or a package at the desk now needs a deliberate "Who gets credit?" (no default; "No staff credit" is its own
      choice; scanning a barcode uses the same choice, the scan field is now inside the product form), the "Tip for" choice on a tip nobody is credited for has no default, and a late tip
      needs a person. `setTips` refuses an unassigned tip when nobody is credited instead of dropping it. FOUND AND FIXED: packages sold at the desk never earned commission (the Sell
      a package form had no seller, and payroll mapped a package/membership sale-line to "fee", which is excluded from commission); the form now asks who sold it and payroll maps
      package/membership lines properly (test in `sales-checkout.test.ts`). Packages sold BEFORE this have no seller and paid nobody; closed sales cannot be corrected (no "change who
      gets credit" on a paid sale).
- [x] 2026-10-16: tips know how they were handed over (migration 0092 `sale_lines.tip_method`). Each tip on the Tips card has "Paid in": Same as sale / Card / Cash; payroll
      (`splitTips` in core, used by `server/payroll.ts`) sends a marked tip where it was marked and splits an unmarked one by how the sale was paid. The card-tip fee now
      applies only to tips paid through a real card (`CARD_FEE_METHODS`: card, card on file, terminal): gift card, store credit and points no longer count as card.
      Test: `sales-checkout.test.ts` (payroll cases). Follow-ups built the same day (migration 0093 backfills old tips on sales paid wholly one way; mixed ones stay unmarked):
      Reports "Tips" tile shows cash/card and the by-method tips are real (`salesReport`, `tipsPerPayment` in core); the API sale has `tip_cash_cents`, `tip_card_cents`,
      per-line `tip_method` and each payment's `tip_cents` is its real share (this CHANGES that number for API users: it used to be a proportional share); "Add a tip" on a
      paid sale (`addTipAfterPayment`: a cash payment, or a charge to a saved card; the sale stays paid and nothing that ran at close runs again); the pay sheet's
      Cash column now means "not paid by card" (gift card, store credit, points count as cash, only a real card is Credit Card). Still open: a late tip cannot be charged to a
      NEW card or the reader (cash or a saved card only); clients cannot tip themselves (online or from the receipt); a mixed-payment sale from before 0092 is still estimated.
- [x] 2026-10-16: shop and gift-card checkout now use the plain card field too (`PayStep` in `book/[slug]/shop/checkout.tsx`, `confirmCardPayment`); walked on demo-salon:
      order #1521 paid with the test Visa. The booking manage page no longer assumes a live first service (`firstStaff`), so a fully cancelled booking cannot crash
      it. Browser-pane note: after a while a long-lived pane tab stops hydrating pages (HMR websocket fails); a fresh tab works, so check there before suspecting the app.
- [x] 2026-10-16: cancellation reasons (migration 0094, `server/cancellation-reasons.ts`). Per-business list seeded with Client is sick / Schedule conflict / Changed their mind /
      Found another salon / Salon cancelled (our side, staff only) / Other; managed under Settings → Cancellation reasons (rename, reorder, retire, "Shown to clients" vs "Staff only").
      The staff cancel dialog now REQUIRES a reason (plus the old free-text note); the client's online cancel page offers an optional one-tap reason (staff-only reasons hidden).
      `setAppointmentStatus` records reason id, who cancelled (client/staff) and whether it fell inside the cancellation window (at that moment, so policy changes don't rewrite history).
      Appointment page shows it; the API has `cancellation_reason_id`, `cancelled_by`, `cancelled_late` and `POST /appointments/:id/cancel` takes optional `reason_id`. Reports: "Cancellations by
      reason" (count, by client, inside window, booked value lost, deposits kept, late fees collected). Test: `cancellation-reasons.test.ts`. Still open: cancellations made by other paths
      (calendar quick status, API without `reason_id`, class/series cancel) record no reason id (the mobile API requires one since 2026-10-16) and show as "No reason given"; old cancellations have none; no-shows are not in this report.
- [x] 2026-10-16: staff cancel with a paid deposit now asks what to do with it (appointment page -> Cancel): keep all of it, keep only the late fee it
      covers and refund the rest (inside the window, "deposit counts toward the fee" policy, deposit larger than the fee), or refund all (default outside the
      window). Refunding needs `reports.view` or `checkout.refund`; without it the deposit stays. `refundDeposit` takes an optional partial amount (the
      appointment's `deposit_cents` becomes what was kept, status stays "paid"). The amount is worked out on the server, not read from the form; if the refund
      fails the appointment is still cancelled and the message points to "Refund deposit". Walked in the browser on demo-salon (a $50 deposit booking inside the window, fee $25): the dialog
      shows the three choices with "keep $25 for the late fee, refund $25" preselected, the confirm text repeats it, the appointment cancelled, `deposit_cents` became
      2500 (status paid) and a $25.00 Stripe refund succeeded. "Keep all" is the old behaviour and "Refund all" uses the same full-refund path tested earlier; neither
      was clicked separately, and the no-refund-permission view of the dialog was not looked at. Also seen once in the console: ManagePage "Cannot read properties of undefined (reading 'staffId')" around a client cancel.
- [x] 2026-10-16: demo Stripe account. `DEMO_ACCOUNT_STRIPE_SECRET_TEST_KEY` / `..._PUBLISHABLE_TEST_KEY` (local `.env`, test keys only, ignored in
      production) belong to a separate sandbox ("Angelic Beauty sandbox") that is NOT connected to the platform, so `lib/stripe-demo.ts` routes any request
      for that account through its own key (an HTTP-client shim used only when the vars are set) and hands the browser its publishable key.
      `scripts/link-demo-stripe.ts` (run by `pnpm demo:refresh`) points demo-salon at it (account ids are unique per business, so demo-twosites is not linked).
      Verified server-side with a simulated reader: card-present Visa 4242 succeeded. **Found:** Stripe's newest API version (2026-09-30.endive) rejects
      `payment_method_types`, and card-reader PaymentIntents need `card_present`, so they are created with API version 2025-09-30.clover
      (`TERMINAL_API_VERSION` in `server/sales.ts`). Restart the web dev server after changing these vars. The Payments page's Refresh/Connect buttons
      do not work for the demo account (it is not a Connect account). Walked in the browser 2026-10-16 on demo-salon: product-only sale, simulated reader, paid in full (terminal · VISA), then a full
      card refund ("Goodwill") through the demo account. Typed card (2026-10-16): the Stripe card form loads with the demo keys and accepts a
      test card number; a PaymentIntent confirmed with Stripe's test Visa through the API was recorded by the app and closed the sale (the UI
      could not fill expiry/CVC/ZIP reliably through browser automation, so the click-through is not done). Fixed: every "Enter card" or reader
      attempt used to leave a "Pending" payment row; starting a new attempt now cancels the old PaymentIntents and drops those rows (one that cannot be
      cancelled, e.g. it just succeeded, is kept). Fixed: the desk's typed-card form listed Klarna, Affirm, Cash App Pay, Amazon Pay, bank and Link
      signup (Stripe's dashboard-managed methods). Desk PaymentIntents now use `payment_method_types: ["card"]` (older API version, `PINNED_API_VERSION`) and the
      form is Stripe's plain `CardElement` (the Payment Element also draws Link's offers), confirmed with `confirmCardPayment`. Walked in the browser on demo-salon:
      typed Visa 4242 -> "card · VISA •••• 4242 · Succeeded", sale paid. Also walked: an online booking with a $50 deposit (Classic Full Set, Any available
      provider): the Payment Element (card + bank, a Link prompt) took the test card, the confirmation page showed deposit $50 / due at the salon $95, the
      appointment is booked with deposit paid (VISA 4242) and the PaymentIntent succeeded on the demo account. The online deposit form still shows Bank
      and a Link prompt (dashboard-managed; not changed). 2026-10-16 follow-ups, all walked on demo-salon: desk and reader PaymentIntents use
      `allowed_payment_method_types` (the newest API version's name; the older-version pin is gone); the online booking card form is the plain `CardElement`
      too (`confirmCardPayment` / `confirmCardSetup`; the Payment Element drew Bank and Link); a client cancelling an online deposit booking more than 24 h out
      refunds the deposit (Stripe refund succeeded, deposit_status refunded); inside the window a staff cancel keeps the WHOLE deposit even when the late fee is
      smaller (a $50 deposit vs a $25 fee kept $50; the staff dialog says "the $25.00 deposit covers it": decide whether the excess should be refunded);
      staff "Refund deposit" (`refundDeposit`) works. Reader checkout can save the card to the client (consent checkbox -> `allow_redisplay: always`,
      the reader's generated card appears in the client's saved cards). Text receipts: the app queues the SMS correctly (+1 normalised, body ok) but demo
      businesses never send; a direct Twilio send from the account's own local numbers came back undelivered (error 30034, unregistered 10DLC), so a real text
      needs a verified toll-free number on a non-demo business. Found and fixed: the booking details form (and the shop checkout's) submitted as a plain GET, putting
      name/phone/email in the address bar, when submitted before the page had hydrated; they are now `method="post"` with the submit button disabled until
      hydration (`lib/use-hydrated.ts`). Still untested: a real reader. The shop/gift checkout still uses the Payment Element.
- [x] 2026-10-15: platform admin accounts moved into the database (migration 0091 `admin_users`). Login, password reset, Google sign-in and the audit
      actor all use the table; the session cookie names the admin and `requireAdmin()` rechecks they still exist and are enabled. New Admins page
      (add by email with an emailed set-password link, disable/enable; not yourself, not the last one). `pnpm --filter @angelic/admin create-admin
      <email>` makes the first account (replaces `hash-password`). `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH` / `ADMIN_GOOGLE_EMAILS` are gone; until the
      first account exists the old pair still signs in once and creates it. **Production rollout done 2026-10-16:** deployed (b47c501), granted `admin_users` to `angelic_admin` (SELECT/INSERT/UPDATE),
      signed in with Google, deleted `ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH` from the `angelic-admin` Render service and redeployed it. Production had one
      admin row, copied from `admin_credentials` by the migration.
      Existing sessions end at deploy (old cookies name nobody). `admin_credentials` is now unused (row copied by the migration).
- [x] 2026-10-15: checkout review (migration 0090: `sales.notes`, `sales.tax_exempt`, `businesses.receipt_footer`). Sidebar entry is "Sales & checkout"
      with + Appointment / + Sale buttons (also in the phone menu; replaced by + New on 2026-10-18). An empty ticket opens "Add to this ticket" with a searchable product
      list (`sale-product-picker.tsx`, pictures, stock, Enter adds a single match; staff credit defaults to the person at the desk). Cash shows
      "cash received" shortcuts and the change due (kept on the payment note and printed on the receipt). Tips: 15/20/25% presets, and they work
      on a products-only ticket (an unassigned tip follows who is credited on the products; with nobody credited you pick the person).
      A ticket with nothing due closes with "Complete sale"; "Save for later" explains open tickets are the pay-later route. Private note per
      sale; "Tax exempt" per ticket (`taxRateForSale` returns 0). Receipts: "Send receipt" by email or text to the client's details or any
      address/number (paid sales, walk-ins too), receipt footer under Settings → Payments, address/tax rate/staff on the printed receipt, the
      app sidebar no longer prints. New "Refund payments" permission (`checkout.refund`; `reports.view` still allows refunds too).
      Card reader: `terminal-payment.tsx` + `server/stripe-terminal.ts` (Stripe Terminal JS loaded from js.stripe.com, internet readers or the
      simulated reader in test mode; card-present PaymentIntent, recorded by the same `finishCardPayment`). NOT tested against Stripe or a
      real reader (no keys locally): try the simulated reader in test mode first. Not built on purpose: voiding a ticket after a payment
      (refund instead: loyalty points, gift cards issued and stock have already moved). Test: `server/__tests__/sales-checkout.test.ts`.
- [x] 2026-10-13: public booking page. Header: the logo straddles the cover with the name below it (it was painted
      over by the photo); once a client starts choosing, the cover collapses to a slim bar with a small logo
      and name so the choices sit near the top. Category tiles: description clamp no longer shows a sliver of
      the third line (padding moved off the clamped text). Service rows show "$50.00 deposit"; the provider and
      time summaries list the deposit; the no-card wording is "This service has a $50 deposit. The salon will
      contact you to arrange it." Tapping a calendar day lands on that day's times; month arrows keep the scroll
      position. "Online booking" link became "Start over" (hidden on the landing view). Placeholders in normal
      case, First name marked required, a note that a mobile number or email is needed. Policy: the late fee
      sentence is skipped when the owner's text already states the same fee, and Settings warns when the policy
      text quotes a different amount (`policyFeeCheck`). Demo policy text no longer says 50%.
- [x] 2026-10-13: location control scales past two sites. `LocationSwitch` (behind `LocationFilter` and the
      calendar's `LocationPills`): buttons for up to three sites; from four a dropdown showing the current site with
      "All" on top, opening toward the side with room; from eight a search box. Same links as before, so every page
      keeps its filters. Site labels drop the shared business prefix unless that would make two look alike.
- [x] 2026-10-13: Reports staff and location pay. The "By staff" and "Pay & commissions" cards are one "Staff"
      table: services, products and tips for everyone (plus the Unassigned row), and service commission, product
      commission, hourly/salary, total pay and cost of revenue for people with payroll permission. "By location" gains
      the same pay columns and a total row: commission follows the sale's site, hourly pay the time-clock site,
      salary the person's primary location (`payrollByLocation`, ties to the whole-business figures to the cent).
      The location filter on Reports now apportions wages the same way (`runPayroll(..., { split: true })`), fixing
      overstated wages for people who clock in at two sites; the Payroll page itself still shows each person whole.
- [x] 2026-10-14 (migration 0080): platform fee is part of the price book. Default in admin → Price book, override per
      business on its Billing tab (percent, 0–20, stored as basis points); card checkout, online deposits and shop
      orders read the business's effective fee (`platformFeeBpsFor`), the salon's Payments page shows it. Starts at
      nothing (0) until a price book is saved. Not run against live Stripe; apply 0080 in production.
- [x] 2026-10-14 (migration 0077): online payment per service. Each service collects nothing, a fixed deposit, a
      percent of the price (of the stylist's own price) or the full price when booked online; the amount rides the
      existing deposit flow, so it comes off the bill at checkout and refunds on in-window cancellations. A mobile
      number is now required for every online booking, waitlist entry and client-account profile (0078 dropped the
      short-lived per-business switch). Not run against live Stripe
      (`depositAmount`/`depositLabel` in `server/online-payments.ts`); check with a test card before relying on it.
- [x] 2026-10-11 (migration 0065): late cancellation fee. Settings → Online booking: none / flat / percent of the
      booked services, and whether a paid deposit counts toward the fee or is kept on top. Cancelling from the
      appointment page inside the window shows the fee, what the deposit covers, and offers to charge the rest to a
      saved card (fee ticket + `appointment.late_fee` in the activity trail); without a card it notes the amount
      to collect next visit. Booking page, confirmation and reminder state the fee next to the window. Online
      cancellation inside the window stays closed, so nothing is charged without staff. Demo salon: $25 flat.
- [x] 2026-10-11 (migrations 0063–0064): pay-rate history. `staff_pay_rates` holds every pay-settings change with
      an effective date (backfilled from each staff record); the staff row mirrors the settings in force today
      (`syncCurrentRates`, run on the Pay tab and every payroll run so scheduled changes land on their date).
      Payroll resolves each person's settings as of the period end, so re-running an old period reproduces its old
      figures, and the sheet notes anyone whose settings changed inside the period. Pay tab: "Takes effect from"
      (future date = scheduled, shown as a notice) and a note; "Rate history" card with who/when/why; changes are
      logged as `staff.pay_change` with the fields that differ.
- [x] 2026-10-11 (migration 0062): Forms overhaul. Templates on New form (intake, lash, PMU, waxing, facial/peel,
      photo release, minor consent; `lib/form-templates.ts`) and Duplicate. Builder: Yes/No, Phone, Email, Initials,
      Section heading and Agreement box types; options survive a type switch; conditions key off yes/no too and are
      dropped with a warning when their driver is removed or reordered; live "Preview"; "Saves to" maps an answer to
      the client's email / phone / birthday / notes / a tag (added on Yes, removed on No) and the fill prefills from
      the client record and last answers. Submissions inbox (Settings → Forms → Submissions: filter by form and name,
      paginated) with "Still to sign before a visit this week"; a submission can be voided (kept, struck through,
      no longer counts), moved to another client, or emailed to the client; CSV uses the signed snapshots, file links
      and local time. Fill page: errors under the question, hidden questions drop stale answers, signature pad
      survives rotation, "Next: <form>" after saving at the desk.
- [x] 2026-10-11: form consistency. New/edit pages for products, packages and services share one fields component
      (`components/{product,package,service}-fields.tsx`, like `PlanFields`); per-page form widths removed (default,
      `max-w-md` for tiny forms, `max-w-3xl` for builders, rule in DESIGN.md); `MoneyInput` (currency symbol, decimal
      keypad, 0.00) replaces bare amount inputs; validation errors show under the field only, the top banner is kept
      for errors no field can show and is worded with the visible label; the first failing field scrolls into view;
      leaving a form with unsaved edits asks first (browser close and in-app links).
- [x] 2026-10-11 (migration 0061): packages get a photo and a description (form, list thumbnail, served publicly
      like product pictures); product and package lists show a small thumbnail. Demo tenants: every product has a
      drawn SVG packshot (`scripts/demo-art.ts`, picked by name: bottle, tube, dropper, brush, mask, pillow, box) and
      each package one of the studio's facial photos; `scripts/demo-images.ts` applies them to existing demo data and
      the seed does it from scratch.
- [x] 2026-10-11 (migration 0060): flexible memberships. Plans are billed "every N weeks / months / years" (any N up to a
      year apart, Stripe's limit; `interval` + `interval_count`, calendar months so the 31st doesn't drift); unused sessions can
      carry over up to `rollover_cap`; `cycle_count` makes a fixed-length plan that ends on its own ("1 of 6 paid",
      Stripe subscription gets a cancel-at date). Freeze until a date from the client page (Stripe pause_collection
      void; resumes on its own, or "Resume now"; members without card billing get the frozen time back). A membership
      paused by a failed card can have auto-renew turned on again. Price/cadence edits clear the Stripe price so the
      next setup makes a new one. Status enum gains `ended`. Demo seed has Fill Club (2-weekly, 1 carries over),
      Glow Year and a 12-Week Lash Course (6 × 2 weeks).
- [x] 2026-10-11: who-did-what on appointments and tickets. Both pages end with one grey line ("Booked by Demo
      Owner, Oct 11 · Ava cancelled it, Oct 11 (client sick) · Paid by Demo Owner, Oct 11") and a "Full history"
      disclosure listing every logged action newest-first (booked, confirmed, checked in, rescheduled, services
      added/removed, notes, ticket opened/paid/voided, each payment and refund with amount, deposit returns).
      Self-service actions (online booking, online cancel/reschedule, class sign-up) are logged as "the client";
      seeded or imported appointments that predate the log get a reconstructed "booked" and "cancelled" entry
      from the row itself. `server/activity.ts`, `components/activity-trail.tsx`.
- [x] 2026-10-11: sidebar Grow group gains "Loyalty & referrals" (links to the settings page; Settings item excludes
      it so one entry lights up).
- [x] 2026-10-11 (migrations 0058–0059): refund reasons. `refund_reasons` per business (seeded with Service issue,
      Client changed mind, Duplicate charge, Late cancellation, Goodwill, Other), managed under Settings → Refund reasons
      (Payments & billing group; rename, reorder, add, retire/restore). The refund form requires a reason plus an optional note; each refund
      line on a ticket has "Edit reason" (managers; amount and destination stay fixed; change logged in the activity
      log). Reports → "Refunds by reason" (money back and store credit).
- [x] 2026-10-11 (migrations 0056–0057): store credit. `store_credit_ledger` + cached `clients.store_credit_cents`;
      refund form offers "To original payment" or "As store credit" (money stays, client gets a balance; credit
      given counts against what is still refundable); "Store credit" payment method at checkout (refunding it
      restores the balance); client page card with history and manager adjustments; Reports "Store credit issued"
      card; Settings → Booking rules "Returned deposits go: back to the card / to the client as store credit",
      honoured by online cancellation and the staff deposit refund; client-facing copy follows the policy.
- [x] 2026-10-11: Staff hours → "Add time off" button opens a team-wide form (pick the person, first/last day, type,
      hours, note) that returns to Staff hours after saving; the per-person Time off tab is unchanged.
- [x] 2026-10-11: Reports: "Pay & commissions" card (payroll.view): service commissions, product commissions,
      hourly & salary and total pay for the period with change vs the prior period, and a per-person table with
      service revenue, tips and cost of revenue. Same calculation as Payroll (overtime off, before adjustments).
- [x] 2026-10-11: Reports: revenue by service category (leaf categories rolled up to top level with the second level
      underneath, services count, share of service revenue, change vs the previous period, share bar). Reports open
      on month to date instead of today.
- [x] 2026-10-11: Staff hours is a coverage grid: time down the side, the week across, opening hours as the white
      area, every provider on duty as a lane, and a strip per day that says whether the services in scope (all, a
      category or one service) are covered, partly covered or nobody is in; "Needs attention" lists the gaps in
      words. Week navigation and a site picker; rotations, time off and custom hours are already applied
      (`server/coverage.ts`, `staff-hours/coverage-grid.tsx`). The provider × weekday table is gone.
- [ ] Booking page follow-ups: service photos on the Shop/gift pages; a search box on the service step for large
      menus; show provider photos (staff have no photo field yet) and a short bio on the provider step.
- [ ] Automations: decide between the fixed recipes (today) and a user-built trigger → delay → message builder
      (GoHighLevel style). Recommendation in the 2026-10-11 session notes: keep recipes, add "custom" entries later.

- [x] Membership auto-billing (recurring charges on the business's Connect account). Done 2026-10-10 (client page → Auto-renew with saved card; Connect webhook `invoice.paid` / `invoice.payment_failed` / `customer.subscription.deleted`). Untested against Stripe until keys exist.
- [ ] Tap to Pay / card reader support.
- [ ] Run the Expo mobile app on a device against `/api/mobile`.
- [x] Inbound SMS: store client replies (currently acknowledged and dropped) and show them on the client page. Done 2026-10-10 (client page thread + reply, Settings → Messages inbox, STOP/START update opt-in).
- [x] Inbox v1 (SMS) built 2026-10-15: People → Inbox lists every text conversation (unread dot, newest first); a conversation shows the
      whole thread and a reply box. Unknown numbers show read-only. Needs no migration (reads `inbound_messages` + `notifications`).
- [x] Inbox unread badge in the sidebar (desktop + mobile menu), 2026-10-15.
- [x] Messaging gaps fixed 2026-10-15 (migration 0086): delivery receipts (Twilio status callback `/api/twilio/status`; "Delivered" badge, undelivered texts become Failed with a plain reason and "Send again"); picture texts (MMS) stored and shown; client matched by last 10 digits; STOP in short messages ("please stop"), CANCEL/END/QUIT/YES only as the whole message; HELP answered on non-toll-free numbers; owner emailed when a conversation first goes unread; Inbox has search, paging, "not a client" / "opted out" / "not delivered" markers and "Add as client" for unknown numbers; reply box shows the text count; the old replies box on Settings → Messages is gone. Untested against live Twilio.
- [x] Inbox v2 for the front desk, 2026-10-18 (migration 0113: `businesses.quick_replies`, `notifications.media`). Walked as a
      receptionist on demo-salon first (gaps in the session notes). Two panes from `lg` (list left, conversation right; two pages on a
      phone). The list is unread-first, shows "You:" previews, each client's next visit, "needs reply", opted-out and not-a-client markers,
      filters (All / Unread / Needs reply / Opted out), search, and keeps itself live (feed route polled every 30 s and on each open);
      ↑ ↓ / J K switch conversations, / jumps to search. A conversation reads as a chat (day separators, newest at the bottom, composer
      pinned) with the client's number, next visit, last visit and visit count above it and Client page / Book / Mark unread beside;
      automated texts (reminder, confirmation…) sit in the thread with a small label; every outgoing text shows its state in words
      (Waiting to send, Sending, Sent, Delivered, Not delivered · reason, Not sent · reason, Trying again) with "Send again" where it
      stopped; the thread refreshes itself every 20 s. Composer: Enter sends (Shift+Enter newline), quick replies as one-press chips with
      {first_name} {next_appointment} {service} {staff} {business} filled in, one picture attached per text (stored as a public JPEG,
      sent as MMS via Twilio MediaUrl), text count. "New message" (header) opens a client picker that lands on the conversation; the
      client page's Text messages card shows the last three and links into the Inbox (its duplicate reply form is gone). Quick replies
      are edited under Settings → Text wording (starter set until the business saves its own). No verified number, no phone, opted out
      or STOP each collapse the composer to one grey line (owner gets the Settings link). The sidebar badge updates itself every 30 s.
      The demo seed now gives demo-salon a verified (fake) number plus a sent reminder and two desk replies, so the Inbox can be walked;
      demo sends are still skipped ("Not sent · Demo business: nothing is sent"). Tests: `lib/__tests__/inbox-logic.test.ts`,
      `server/__tests__/inbox.test.ts`. Untested against live Twilio (MMS fetch of `/api/files/<id>` needs the public app address).
- [x] demo-twosites (Glow Collective) holds a real Twilio toll-free number, +1 (866) 329-2807 (PN7edaa389…), bought 2026-10-18 with
      `apps/web/scripts/demo-number.ts --slug demo-twosites --buy` at the owner's request (`--release` gives it back). It stays
      unverified (carrier verification is for real businesses) and its inbound webhook points at app.angelicbooking.com, so a text to
      it only lands once a demo lives in that database. `DEMO_TWOSITES_TWILIO_NUMBER` / `_SID` in .env let the seed re-attach it after
      a refresh; demo-salon keeps a placeholder "verified" number. A demo business may use any number it holds (`numberUsableFor`),
      since its texts are skipped anyway; real businesses still need a verified one.
- [ ] Inbox follow-ups: email in the same thread (needs inbound email via Resend), assign or snooze a conversation (needs a
      conversations table; not built), a turn-off for the new-reply email, quiet hours for staff replies, more than one picture per
      text, delivery receipts for MMS pictures sent from a number without MMS support (Twilio returns 21623/21620 as a plain
      "Carrier error").
- [x] A separate permission for reading client texts: `clients.messages` gates the Inbox (list, conversation, feed, new message),
      a client's text thread and the unread badge; replying, resending and adding a sender as a client also need `clients.write`.
      Done 2026-10-18 with the client-data permission split (migration 0114).
- [x] Per-business SMS templates / tone; include "Reply STOP" wording on the first message only. Done 2026-10-10 (Settings → Messages → Text wording).
- [ ] Usage allowance per plan tier if pricing moves to tiers.

### Treatment charts / SOAP notes (built 2026-10-22, migration 0140)
- [x] Settings → Chart templates: the salon's templates, built with the forms builder (heading, short and long answer, checkboxes,
      choose one, yes/no, number, date, face or body diagram, visit photos, instructions), each optionally set as the chart that opens
      first for some services. Starters ship ready to use without adding them: SOAP note, Facial treatment, Lash service, Permanent
      makeup, Massage; "Add and edit" copies one (ticking the services whose names suit it). Managed with `forms.manage`.
- [x] "Chart this visit" on the appointment (Charts card) and "New chart" on the client's Charts tab. Opens on the service's template,
      else the starter that suits the service's name, else SOAP; the client's last signed chart for the same service is folded away
      above it, with "Start from its answers". Diagram: tap to drop numbered marks, a note per mark. Photos: tick the visit's own
      photos. A chart keeps a copy of its template, so editing a template never changes a chart.
- [x] Save draft or Sign. Signing needs the fields marked "Needed to sign", records the signer's name and time, and locks the chart:
      the app refuses changes and a database trigger refuses them too (`chart_notes_signed_lock`). Later changes are addenda, each
      with its author and time, never edited (`chart_addenda_append_only`). Drafts are changed or deleted only by whoever started them
      (or someone who charts every client); signed charts are never deleted (only with the client).
- [x] Client page tabs Profile / Charts: "Last time, by service" cards, then every chart with service, chart, provider and status
      filters and paging. Print or PDF view (`/print/charts/…`) with the addenda.
- [x] Permissions `charts.read.own` / `charts.read.any` / `charts.write.own` / `charts.write.any` ("own" = clients they have a visit
      with). Defaults: Owner and Manager everything, Provider own, Front desk none (charts are clinical; `clients.notes` doesn't imply
      them). Migration 0140 back-fills stored roles the same way. Every chart opened, listed, printed, signed or added to is in the
      activity log (`chart.*`). A guard test keeps charts out of the booking site, embed, client accounts and both APIs.
- [x] Tests: `packages/core/src/__tests__/charts.test.ts` (templates, answers, lock, scope), `server/__tests__/charts.test.ts`
      (Postgres: lock in app and DB, addenda, own vs any, isolation), role matrix (who sees the Charts tab and charts), `charts-guard`.
      Checked in the browser at 768×1024 as the owner: chart a facial, mark the face, sign, addendum, Charts tab, print, add a starter.
- [ ] Deleting a client deletes their charts with them (cascade). Medical and spa record rules in many states want charts kept for
      years: decide on archive-instead-of-delete for clients with signed charts before medspa customers use this.
- [ ] Signing is the signed-in person's name and time; no PIN or password re-entry, no drawn signature, no co-signature by a
      supervising provider (medspa). Add those if a customer needs them.
- [ ] Not in the mobile API or the iOS app, the client data export, or the public API (deliberately, for now).
- [ ] A chart can only include photos already on the visit; there is no upload from the chart itself.
- [ ] The chart page doesn't show who has viewed it; that is only in Settings → Activity log (filter "chart").
- [ ] Not tried on a real tablet or with a provider login yet (only the role matrix checks a Provider), and the demo seed has no charts.

### Email designs (built 2026-10-22, migration 0132)
- [x] Marketing → Email designs: saved designs built from blocks (heading, text with **bold** / *italic* / links, image, two images,
      button, divider, space, footer note), with the logo and brand color applied, merge fields ("Insert field"), a live desktop / phone
      preview and "Send me a test" (sample details, 20 an hour). Campaigns and workflow email steps pick one as their layout.
- [x] Settings → Email designs: the business's own design of confirmation, reminder, moved, cancelled, forms due, review request,
      receipt, gift card and store order. Each keeps its own content as a required "Message details" block; an empty subject keeps the
      usual one; "Reset to the standard design" removes it. With no design every email goes out exactly as before.
- [x] Rendering (`lib/email-design`): tables and inline styles at 600px with an Outlook (MSO) wrapper, a phone media query, bulletproof
      buttons, a hidden preview line; marketing emails always carry the postal address and the unsubscribe link. Pictures placed in a
      design are stored as JPEG / PNG / GIF (Outlook for Windows can't show WebP). Tests: `render.test.ts`, `email-designs.test.ts`.
- [ ] Not yet opened in real Gmail, Apple Mail and Outlook: demo businesses never send. Send a test from a real business with Resend on
      and check all three (Outlook desktop especially: rounded corners and the phone layout don't apply there, by design).
- [ ] Business logos are stored as WebP, so Outlook for Windows shows no logo in any email (designed or standard). Keep a PNG copy of
      the logo for email.
- [ ] The standard (undesigned) emails still use the old div-based wrapper (`shell` in `lib/notify/templates.ts`), which Outlook lays
      out full width. Move it onto the table renderer.
- [ ] Not designable yet: staff alerts, team invites, form copies, referral-code emails and workflow "notify staff" emails.
- [ ] The campaign form's Layout picker was checked by the send-path test, not clicked through in the browser (the hidden in-app
      browser pane can't drive native dropdowns).

### Add-ons at online booking (built 2026-10-22, migration 0133)
- [x] Service page → Add-ons: up to 3 services suggested with this one, each at its usual price, a fixed add-on price, or an amount off
      the stylist's own price, and optionally a shorter add-on time (`service_addons`, `server/addons.ts`).
- [x] Booking page details step: "Add to your visit?" with the suggestions this stylist performs that fit right after the first
      service (others hidden), unticked by default, a cheaper add-on showing its usual price crossed out; ticking updates the total.
- [x] Booked at the add-on price and time with the "(add-on)" label, which carries through to the ticket, deposit (visit total),
      payroll (commission on what was charged) and reports (grouped under the service). Booking the service on its own uses its usual terms.
- [x] Removing the service an add-on came with puts the add-on back to the stylist's usual price; the activity log says so.
- [ ] Not offered when staff book at the desk (they add services as usual); no per-salon switch for the crossed-out price.

### Booking codes: verify the client before an online booking (built 2026-10-20, migration 0131)
- [x] Settings → Booking rules → "Confirm the client's mobile number with a code before they book" (on by default). The booking form
      sends a 6-digit code by text, or by email when the business can't text yet or the client asks; signed-in clients skip it.
      The code yields a signed 2-hour token the form carries (works in the embedded iframe, where a cookie wouldn't).
- [x] Enforced on the server for free and paid bookings, before any card is charged or saved. The bot check moved to sending the code
      (each code is a text we pay for), and a booking proven by code skips it (its token may expire while the client fetches the code).
- [x] A proven phone (or email) attaches the booking to the client who has it on file, whatever name was typed; an unproven one only
      matches with the same name (otherwise a new client, as before). Marketing-text consent counts only from a phone proven by code.
- [x] After a proven booking the client is signed in on that device (only where client accounts are on).
- [ ] Not tried end to end in a browser: the in-app browser never gets a Cloudflare bot-check answer. Covered by tests
      (`booking-verification*.test.ts`, 8 tests) including the server action; try one real booking on production.
- [ ] Texting a code needs the business's toll-free number verified; until then codes go by email.

### Helcim as a second card processor (built 2026-10-20, migrations 0128–0130; plan in `HELCIM-PLAN-2026-10-20.md`)
- [x] Settings → Payments → Card processor: connect the business's own Helcim account (API token, tested before saving; webhook
      verifier), switch back to Stripe any time. Tokens are encrypted (`lib/secrets.ts`, `APP_ENCRYPTION_KEY`).
- [x] Smart Terminals paired by device code (per location, "Test" pings the screen). Checkout → Card reader sends the amount to the
      terminal; a signed webhook per business (`/api/helcim/webhook/<id>`) settles it, with a 2-second poll as fallback; a cancel
      on the terminal fails it; "Stop waiting" still records a payment that lands later.
- [x] Type it in at the desk: HelcimPay.js; the result's hash is checked against the payment's secret, then confirmed with Helcim.
- [x] Saved cards (Helcim customer per client): card on file, no-show and late-cancel fees, late card tips, client portal list and
      remove (blocked while a card holds a booking or pays a membership). Refunds of Helcim payments go back through Helcim
      (reverse when same-day and not settled).
- [x] Booking page deposits (purchase) and card holds (verify) through HelcimPay.js; the booking is made only after the result is
      verified; a paid checkout nobody booked with is refunded after 20 minutes (jobs run). Deposits refund through Helcim, and a
      deposit carried onto the visit's ticket stays refundable there.
- [x] Online store and gift cards: preauth at checkout, stock checked again, then capture or reverse; the order sweep settles
      abandoned ones.
- [x] Memberships: auto-renew on Helcim is run by the app (jobs run charges the saved card when the period ends, once per period;
      a decline pauses it and starts the payment-failed automation).
- [ ] Not run against a real Helcim account yet: tested against a fake Helcim API (`helcim.test.ts`, 11 tests) and endpoint paths
      checked against devdocs.helcim.com. Needs a Helcim developer test account (tier2support@helcim.com) and a Smart Terminal
      for an end-to-end pass, especially the HelcimPay.js hash format and the webhook payloads.
- [x] `APP_ENCRYPTION_KEY` generated 2026-10-20: in local `.env` and on Render (same value), redeployed.
- [ ] Join the Integration Partner Program and set `HELCIM_PARTNER_TOKEN` (revenue share is only credited on tagged requests).
- [ ] Ask Helcim: how to flag merchant-initiated charges on saved cards; dispute webhooks (none today: Helcim emails the merchant);
      tips on the terminal; Apple Pay in HelcimPay.js; importing saved cards from Stripe.
- [ ] Gaps: Helcim is per business, not per location (Stripe allows a location its own account); no platform fee on Helcim
      payments (revenue share instead); the terminal tip prompt isn't used (tips are entered in the app, Option B screen).

### Checkout: client tip screen and own card machine (built 2026-10-20, migration 0127)
- [x] Client-facing tip screen: on a ticket, Tips → "Ask the client" fills the screen in the business's brand color with the
      salon's tip choices, "Other amount" (keypad) and "No tip", a confirm step with the new total, then "hand the device back".
      Saves through the same `applyTips` (one stylist gets it; several split by revenue), so it works with any way of charging.
- [x] Tip choices: Settings → Checkout & tips (`businesses.tip_percents`, default 18/20/25, one to four), used by the tip screen
      and the staff tip form (which had 15/20/25 hard-coded).
- [x] "Card (own terminal)" (`payment_method` `external_card`): Card → "Own card machine" records a card charged on any card
      machine, with optional last 4. Counts as a card for payroll card tips and fee sharing (`CARD_FEE_METHODS`); refunds are
      recorded only and the confirm says to refund on the machine too. Card is offered even without Stripe connected.
- [ ] Not verified on a real tablet: fullscreen is requested where the browser allows it (iPad Safari ignores it; the overlay
      still covers the page).

### App color (built 2026-10-19, migration 0126)
- [x] Owners and managers (`settings.business`) pick the staff app's primary color under Settings → Business profile → App color:
      eight presets, the booking page's brand color when it differs, or any custom color. The whole app recolors as you pick and the
      pick saves itself after a 0.5 s pause (toast with Undo); too-light picks are not saved. Stored as
      `businesses.app_color` (null = default violet), separate from `brand_color`, which still colors only the booking page and emails.
      Every `brand-*` utility now reads `--brand-50…900`; the app layout writes them on `:root` (`appColorCss` in `lib/brand.ts`, shades
      mixed toward white/black) so portaled dialogs follow. Colors too light for white button text (contrast under 3:1) are refused.
      This also defines brand-200/300/400/800/900, which were used in ~30 places but missing from the theme (they rendered no color).
- [ ] The Expo mobile app and the admin app keep the default violet; the logo mark stays violet on purpose.

### Mobile and tablet review (2026-10-20, `MOBILE-REVIEW-2026-10-20.md`)
- [x] All 151 staff, booking and public pages measured at 375, 390 and 768 wide; none scrolls sideways now (Settings was 708px,
      Reports 1005px, Locations 555px, Appointments 445px, Gallery 446px, Form submissions 491px, Developers 438px).
- [x] Shared fixes in `globals.css`: single-column grids can't grow past their container; table scrollers contain their sr-only
      labels; fields are 16px below `md` (no iOS zoom on focus; 85 pages had 14px fields); `data-segmented` controls are 40px
      tall on phones and scroll inside themselves. `size="sm"` buttons are 40px below `md`.
- [x] Clients and Appointments lists are stacked rows on phones; opening hours, category rows, appointment Move / Add a service and
      the Time clock range stack or wrap; the calendar's stat cards are two per row; seven more tables sit in scroll boxes; the
      compact service picker opens leftward near the right edge.
- [x] Tablets (768×1024 and 1024×768, §3 of the review): the phone shell (top bar, drawer, bottom tabs) runs until `lg`, so
      portrait tablets get the full width; side-column layouts go two-column at `xl` (pages whose side holds the primary
      action keep a 300px side at `lg`); touch sizes follow the pointer (`lg:pointer-fine:`, coarse-pointer CSS), so an
      iPad keeps 40px buttons and 16px fields; Appointments folds columns until `lg`; Weekly hours with two locations is
      two lines per day until `xl`; the inbox composer and automation save bar sit above the tab bar.
- [x] Third pass (§5 of the review): text links and small controls get a 40px hit box on touch (`hit`, and underlined links
      automatically); "Recently booked" reads "New" on phones; Reports, Payroll, Audit, Messages, Gift cards, Time clock
      entries, Form submissions and Inventory report tables stack on phones (`StackTable`); calendar card buttons are 32px in
      the bottom corner on touch; phone numbers print as "(703) 555-1024" (`phone()` in lib/format.ts); sign-in / sign-up
      measured signed out; the automation save bar sticks again; the Reports "Custom" popover stays on screen.
- [ ] Check on a real iPad and iPhone (everything so far is browser emulation, touch sizes included).

### Vagaro parity gaps (added 2026-10-10; all built 2026-10-10 — Stripe-dependent ones are untested until keys exist)

**Booking**
- [x] Deposits and card on file at online booking: collect the service deposit (or a SetupIntent for
      card on file) on the business's Connect account during `/book/[slug]`; today the page only says a
      deposit "may be required" and no-show fees are charged by hand from the appointment page.
- [x] Recurring / standing appointments ("every 4 weeks with Maria"): create the series, edit one vs all,
      stop at a date or count; respect availability per occurrence.
- [x] Class and group bookings: services with a capacity, several clients per appointment slot,
      per-seat pricing and check-in.
- [x] Provider calendar sync: two-way Google/Outlook/Apple calendar sync per staff member (at minimum a
      per-staff subscribable ICS feed; today only the client gets a one-off `.ics` download).

**Clients**
- [x] Intake / consent / waiver forms: form builder, send before the visit (link in the confirmation),
      signed copies stored on the client, required-form flag per service.
- [x] Review requests: text/email after a completed visit with a link to Google (or an internal rating),
      opt-out per client, shown on the client page.
- [x] Client accounts: client login on the booking site with upcoming/past appointments, saved cards,
      packages/memberships balance and rebook-in-one-tap (today only per-booking manage links).
- [x] Loyalty and referrals: points per dollar or visit, redeem at checkout, referral credit.

**Marketing**
- [x] Email/text campaigns: one-off blasts to a filtered client list (last visit, service, staff),
      unsubscribe handling, send-count against the SMS allowance.
- [x] Automated marketing: birthday message, "we miss you" after N weeks, rebook reminder after a
      visit; each with a per-business template and on/off switch.
- [x] Promo codes: percentage/fixed discount, expiry, usage limit, service restriction, redeemable
      online and at checkout.
- [x] Instagram / Facebook / Google "Book now" buttons: documented links or embed snippet for the
      booking page (the custom domain already exists).

**Point of sale and retail**
- [x] Online store: sell gift cards and products from the booking page (gift cards first: buy for
      someone else, delivered by email), then products with pickup or flat-rate shipping.
- [x] Inventory: on-hand quantity per product, decrement on sale, low-stock alert, receive stock /
      simple purchase orders, stock-on-hand report.

### Added 2026-10-10 (evening)
- [x] Embeddable booking: `public/embed.js` + chromeless `/embed/<slug>` flow (inline or pop-up button), configurator
      with live preview under Settings → Embed, `frame-ancestors *` only on `/embed/*`.
- [x] Automations now cover the whole visit: confirmation (info), reminder timing, a new pre-visit message
      (hours before, scheduled at booking and cancelled/moved with the appointment), rebook, birthday, win-back.
- [x] Settings → Locations: edit page for existing locations.

### Locations as a first-class dimension (planned 2026-10-10; one tenant = one Stripe account, locations inside it)
Decisions with the owner (2026-10-10): the two sites are two legal entities (Angelic Beauty in Sterling, Angelic
Lashes by Tiffany in Fairfax), each with its own Stripe account; providers work fixed days per site; Fairfax does
not offer facials, prices are the same everywhere; clients, gift cards, packages and memberships are shared across
sites. Model: ONE tenant, and the location is the money boundary (own Stripe account, tax rate, receipt identity),
everything else shared. Clients are never siloed per location inside a tenant; owners who must keep client data
apart use separate tenants.

**Phase 1 (unblocks Sterling + Fairfax) — built 2026-10-10, migrations 0038/0039**
- [x] Staff schedules per location: each weekly-hours row carries a location (Staff → Weekly hours shows a
      picker per day when the business has more than one site). Availability caps each block with that site's
      opening hours; the calendar's location pills show who works there that weekday (day view) or on any day
      (week/month) plus anyone with a visit booked there. A row without a location means the staff member's
      primary site, else the default site, so "unassigned shows everywhere" is gone. Day-off overrides stay per staff.
- [x] Location on every sale: from the appointment's location (itself from the provider's schedule that weekday,
      else their primary site, else the default), online orders and gift cards at the default site, membership
      renewals at the site that sold the membership. Sales report, CSV exports and payroll take `?location=`;
      the report has a "By location" table. Payroll filtered by location can't be finalized (hours and
      adjustments are per person, not per site).
- [x] Per-location booking link and QR on Settings → Online booking (`?location=` deep link).
- [x] Services "offered at": tick boxes on the service page (none/all = everywhere); the booking page, the
      staff-side New appointment page and `bookAppointment` itself honour it. The services list shows
      "Sterling only" style markers. No per-location pricing.
- [x] Per-location Stripe account: Settings → Payments lists each location with "Connect its own Stripe
      account" / "Use main account"; a location without its own account uses the business's main account.
      Checkout, saved cards (one Stripe Customer per client per account: `client_stripe_customers`), online
      deposits/card-on-file, refunds, deposit refunds, membership auto-renew and the Connect webhook all route
      by the sale's / appointment's location. Own sales-tax rate per location (blank = business default).
      Receipts and Stripe descriptors name the location when it has its own account. The Sales report shows
      "Redeemed here, sold elsewhere" lines for gift cards, package sessions and membership credits that
      crossed sites (gift cards, packages and memberships now remember where they were sold; sale lines
      covered by a credit remember which package/membership and how much).
- [x] Clients: derived "home location" (last non-cancelled appointment) on the client list (filter + badge),
      CSV export and campaign audiences ("Usually visits").
- [x] Review fixes (2026-10-10, migration 0041): removing a location no longer deletes staff hours (rows keep
      their times, location falls back to primary/default); the appointment page, sale page and client visit
      history show the location; texts and emails name the location when it has its own Stripe account; moving
      a visit to a day the provider works elsewhere re-derives the location (refused if a service on the ticket
      isn't offered there) and adding a service checks "offered at".
- [x] Follow-ups closed (2026-10-10, migration 0042): the client's account page lists saved cards from every
      Stripe account the business runs (labelled by site) and can remove any of them; the shop and gift card
      pages take `?location=` with a "Buying from" switch so the chosen site takes the money; legacy
      `clients.stripe_customer_id` dropped; `import-vagaro.ts` keeps per-day locations across re-runs and stamps
      appointments from the provider's day; the staff list shows "Sterling Mon–Wed · Fairfax Thu–Sat"; the
      calendar's New appointment button keeps the location filter; the waitlist records the location and the
      Book link carries it; home location refreshes on cancellation/no-show. (Per-location embed snippets
      already existed in Settings → Embed.)

**Phase 2 — built 2026-10-10, migration 0040**
- [x] Per-location text number: Settings → Text messaging lists the business number plus one optional number per
      location ("Get its own number"); texts about a visit go out from that location's verified number, else the
      business number, else the platform fallback (`notifications.location_id` picks the sender per row). Carrier
      verification for a location's number is prefilled with the location's name and address. Replies still
      route by the number texted. Messages (email and SMS) use the visit location's phone and address.
- [x] Per-location tax rate override (Phase 1).
- [x] Location timezone: `tzFor(business, location)`; availability computes each location's blocks on its own
      clock, the public booking page / confirmation / manage page, the staff-side New appointment page and the
      appointment page show the visit location's time, reminders/pre-visit texts format times in it, and the
      calendar switches clocks when filtered to one location ("All" stays on the business clock).
- [x] "Valid at" on gift cards (manual issue), packages and membership plans: tick boxes on the create forms
      (empty/all = any location); redemption at checkout refuses and the sale page hides credits that aren't
      valid at the sale's location. Online-bought gift cards are valid anywhere.
- [x] Follow-ups closed (2026-10-10): packages and membership plans have edit pages (name, price, sessions,
      validity, "valid at"); the today strip and month grid already follow the filtered location's clock.

**Phase 3 — dropped (2026-10-10).** The planned cross-tenant roll-up / shared client directory / one platform
invoice per owner was built and then reverted (commit 70435d9 and its revert): the owner's two entities are one
tenant with two locations, so tying separate businesses together is not needed. Revisit only if a customer
runs several salons on separate accounts.

### Forms enhancements (built 2026-10-10, migrations 0044–0045)
- [x] Front desk completion: "Complete here" on the appointment page (outstanding forms) and the client page
      (any active form) opens the same form on the salon's device; the record notes who assisted.
- [x] Drawn signature pad (PNG kept in `files`) alongside the typed name; print / save-as-PDF view per signed
      form at `/print/forms/<slug>/<submissionId>`.
- [x] Prefill from the client's last answers to the same form; staff see "changed" badges against the previous
      copy on the submission page.
- [x] New question types: number, choose-any (multi-select), photo/PDF upload (5 MB, served from `/api/files`).
- [x] Conditional questions ("Only show when" an earlier yes/no or choice answer matches); builder reorders
      questions with up/down.
- [x] Forms can be required only at chosen locations ("Required at").
- [x] Morning-of nudge: the jobs run queues one text/email per visit that still has a form outstanding
      (after 08:00 local, visits at least an hour away; template `forms_nudge`, editable under Settings → Messages),
      and the day calendar marks "forms due" with a "Forms due" strip cell that filters to those visits.
- [x] CSV export of a form's submissions (one column per question) from the form's edit page.
- [ ] Follow-ups: uploads and signature images are served by unguessable id without login (same as logos);
      class seats aren't marked "forms due" on the calendar (the class card stands in for the seats); no
      multi-language forms; no per-question help text.

### Time clock kiosk (built 2026-10-10, migration 0043)
- [x] QR clock-in: Time clock shows a printable QR code per location (`/clock/<token>`, rotatable). Staff scan
      it, type a 4–6 digit PIN (set or generated on their staff profile, stored hashed, unique per business) and
      are clocked in or out; no app login needed. Entries record the location and are noted "Kiosk". The page
      is rate limited (10 posts/min per IP). Logged-in staff can still clock in from Time clock as before.
- [ ] Follow-ups: no photo/geofence check (anyone with the PIN can punch from anywhere the QR is known); no
      break tracking; a manager can't see who is currently clocked in at a glance (only via the open entries).

### Lash maps (built 2026-10-17, migration 0110)
- [x] Per-client lash maps: an eye-patch diagram cut into 6 or 7 zones (inner to outer corner), each with length
      (4–20 mm, half-mm steps), curl (B, C, CC, D, DD, J, L, L+, M, U) and thickness (.03–.20 presets or typed),
      plus style name and notes. Client page shows the latest map and older ones; appointment page shows it on
      any visit where the client has one or a lash service is booked ("Update for this visit" starts a new map
      from the last one, tied to the visit). Desk (`clients.write`) and the provider who has seen the client can
      write; providers otherwise can't edit client details.
- [x] Spikes and lash type (2026-10-17): a + on each zone divider adds a spike (longer lashes between two zones,
      for wispy / spiky styles) with its own length, curl, thickness and type; it starts 2 mm longer than its
      neighbours. Zones and spikes take a type (Classic, Hybrid, 2D–10D); a type every zone shares shows once as
      "3D volume throughout". Stored inside the zones JSON, so no migration and older maps load unchanged.
- [x] Right eye set differently (2026-10-17, migration 0111): "Right eye is set differently" copies the map to a
      right eye with its own zones and spikes; a Left / Right switch picks which eye the editor shows. Saved maps
      show left above right. Demo seed has five lash maps (classic, hybrid, wispy with spikes, volume with a
      different right eye, and an older version of one).
- [x] Premade fans, flat lashes and colour (2026-10-18): type is grouped as Classic, handmade fans (2D–10D) and
      premade fans (YY, 3D W–6D W, Spike); new spikes start as Spike. Type is picked as Classic, Fans or Hybrid, then
      the fan; a hybrid mixes classics with that fan, saved as e.g. "Hybrid 3D" (a bare "Hybrid" from earlier maps
      stays valid). Shape is its
      own Round / Flat setting per zone and spike, so flat works with any type ("Use for all zones" covers spikes
      too); maps saved with the earlier "Flat" type read as Classic + Flat.
      Each zone and spike has a colour (blank is black; presets or a typed name), drawn on the lashes and listed
      under the diagram ("Blue: zones 6, 7"). Still in notes: hybrid ratio, layering, lift, lash brand/material,
      adhesive, lower lashes.
- [x] Editor layout (2026-10-18): one "Copy to all zones" (everything but length) replaces the per-field links; shape and
      colour fold into a section that opens on zones using them; "Fill lengths from a style" (Natural, Cat eye,
      Doll eye, Squirrel, Open eye) from a longest length; bigger + markers for spikes.
- [x] Spike editing (2026-10-18): a "Spikes" row under the zone buttons ("3–4 · 12 mm") opens each spike; the spike
      panel shows its length against the longer neighbouring zone, has previous / next spike, and "Copy to all
      spikes" (everything but length).
- [x] + New and blank checkout (2026-10-18): the sidebar's + Appointment / + Sale pair is one "+ New" menu (Appointment,
      Sale, Client, Blocked time, each by permission; also in the phone menu). "+ Sale" and Sales → Start sale open
      `/sales/new`, a blank ticket that saves nothing until the first item goes on (client and location ride along in
      the address); a failed first add deletes the empty ticket and its "opened" entry so the number comes back.
- [ ] Not built on purpose: spikes inside a zone (dividers cover wispy styles; notes cover the rest); lash maps
      in the client portal (notes can hold remarks a client shouldn't see, so showing them should be a per-salon
      choice) and the public API (nothing asks for it yet).

### Client photos on booking (built 2026-10-18, migration 0117)
- [x] Clients can attach up to 5 pictures on the booking form (inspiration, a reference style, their current lashes or brows): an
      "Add photos" tile with previews and an (x) each, camera roll and multiple select on a phone, works in the embed at 375 px.
      Big pictures are shrunk in the browser first; the server runs them through `optimizeUpload` as kind "visit" (working size +
      thumbnail, EXIF dropped) and files them as `visit_photos` rows with phase "client" on the visit's first service and provider, so
      `/api/files/<id>` applies the appointment's own rule (whoever may open the appointment; another provider gets 404). Shown on
      the appointment's Photos card as "From the client" with a lightbox and remove, in the Gallery and the client's Photos as a
      third group of the pair ("2 from the client"), in the calendar hover card ("2 photos from client"), in the "New online booking"
      automation and the business alert email ("2 photos from the client are on the appointment"), and in the activity log
      ("the client attached 2 photos to the booking"). A picture that cannot be used (an unreadable HEIC, not a picture, over 10 MB)
      is left out by name on the confirmation page; the booking never fails because of a photo. Settings → Online booking: "Let
      clients attach photos when booking" (on by default). Tests: `booking-photos.test.ts`, `calendar-tip.test.ts`, `visit-photos.test.ts`.
- [ ] Limits and open questions: HEIC that the phone does not convert is refused, not stored (the image library cannot decode HEIC;
      iPhones normally hand the browser a JPEG). The client cannot see or change their photos afterwards (nothing on the manage
      page or in the client account). Photos stay with the appointment when the client record is deleted (`client_id` goes null, like
      staff photos); decide whether a client's account deletion should also delete what they sent. Not built: photos on the waitlist
      form, on a reschedule, or from the SMS inbox straight onto the appointment.

### Needs a real Stripe/Twilio run before relying on it (2026-10-10)
- [ ] Online deposit + card on file at booking (test cards on a connected test account), including the
      automatic refund when a slot is taken after the charge and the refund on online cancellation.
- [ ] Online store and gift card purchase (`/book/<slug>/shop`, `/book/<slug>/gift`): pay, order email,
      gift card email, pickup status on the sale page. Includes authorize-then-capture: the card shows as authorized, the capture
      happens on return, sold out after authorizing releases it (no charge), and a closed page is captured by the jobs run.
- [ ] Membership auto-renew: subscription created on the connected account, renewal invoice → period
      extended + sale recorded, failed invoice → paused.
- [ ] Inbound texts and STOP/START with a verified toll-free number.
- [ ] Client sign-in codes by text (email path works once Resend is live).

## 4. Recurring upkeep

**Weekly**
- Check the Render cron job's run log (`angelic-booking-reminders`): each run prints
  `processed/sent/failed/skipped` and `verifications`. Investigate any `failed`.
- Settings → Messages in the app for each active business: anything stuck in `failed`/`skipped`.
- Stripe dashboard → Developers → Webhooks: no failing deliveries on either endpoint.

**Monthly**
- `pnpm update --interactive` for dependencies (Next.js, Stripe SDK, Better Auth, Drizzle); run
  `pnpm typecheck && pnpm test` and the Playwright smoke test before deploying.
- Twilio: balance, carrier verification states, any numbers in `rejected`.
- Render: DB disk usage, service metrics, deploy failures.
- Rotate nothing by default, but if `JOBS_SECRET` is rotated, change it on the web service **and** the cron job.

**Every time an env var is added or changed**
- Set it on Render **and** add it to the local `.env` (the user's rule); document it in `.env.example`
  and `docs-ops.md`. Render env changes do not redeploy by themselves: trigger a deploy.

**Every deploy**
- Migrations run in Render's pre-deploy step; a failed migration fails the deploy. Check the deploy
  status after pushing to `main`.
