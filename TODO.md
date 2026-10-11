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
- [ ] Activate the platform Stripe account (business details, bank, identity) and complete the Connect
      platform profile for Standard accounts. As of 2026-10-10 the live account `acct_1UP3plPmYAh2Q7ir` reports
      charges_enabled=false, details_submitted=false. The restricted live key must have write access to Customers,
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
- [ ] Put **live** keys on Render and in `.env`; redeploy; verify a real card payment + refund from the sale page.
- [ ] Save the Customer Portal configuration once in the Stripe dashboard (branding, cancellation copy).
- [ ] Decide pricing: base plan (`BILLING_BASE_CENTS`, now 0), trial (`BILLING_TRIAL_DAYS`, now 0),
      number fee (`SMS_NUMBER_MONTHLY_FEE_CENTS`, 1500), text usage (`SMS_USAGE_CENTS`, 2) and
      included texts (`SMS_INCLUDED_PER_MONTH`, 0). Optional `PLATFORM_FEE_BPS` on card payments (now 0).

### Twilio
- [ ] Buy the first toll-free number for Angelic Beauty in production (Settings → Text messaging) and submit
      carrier verification. Needs the owner signed in on app.angelicbooking.com; buy it **before** the deploy that
      turns Stripe on (billing then requires an active subscription to buy a number) or set up billing first. Needs EIN (or sole proprietor), address, contact. Approval takes 1–3 weeks;
      status is polled every 5 minutes.
- [ ] Decide whether a platform-wide fallback sender is wanted for businesses without a verified number
      (`TWILIO_FROM` / `TWILIO_MESSAGING_SERVICE_SID`). It would need its own toll-free verification.
- [ ] Keep an eye on the Twilio balance (≈$197 on 2026-10-08) and enable auto-recharge.

### Email
- [x] Add a DMARC record in Cloudflare: `TXT _dmarc.mail1  v=DMARC1; p=none;` (improves Gmail/Yahoo delivery). Done 2026-10-10.
- [ ] Set `SUPPORT_EMAIL` on Render and in `.env` so Help/Privacy/Terms show a contact address.

### Domain move to app.angelicbooking.com (done 2026-10-10)
- [x] Cloudflare DNS `CNAME app → angelic-booking.onrender.com` (DNS only); Render verified, certificate issued.
- [x] Google OAuth client: origin `https://app.angelicbooking.com` + redirect URI `…/api/auth/callback/google` added.
- [x] `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL` switched, deployed, cron job URL updated, redirects verified.
- [ ] Google consent screen: change the home page link from the bare domain to `https://app.angelicbooking.com`
      (cosmetic; the bare domain redirects anyway).
- [x] Marketing site (Cloudflare Worker `angelicbooking`) owns the bare domain and www; root domains detached from Render,
      root redirect removed from `src/proxy.ts`, Cloudflare redirect rule keeps old `/book/*` links working.

## 2. Before real customers

- [ ] Upgrade the Render Postgres from the free `0.1c-256mb` tier to a paid plan with backups and
      point-in-time recovery; until then run `scripts/backup.sh` nightly somewhere and store the dumps off-box.
- [ ] Set `ERROR_WEBHOOK_URL` (Slack/Discord incoming webhook) so unhandled errors are seen; consider Sentry.
- [ ] Add an uptime check on `https://app.angelicbooking.com/sign-in` and on the cron job's run history
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
- [ ] Write a short privacy/terms review with a lawyer before accepting other businesses.

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
      full refund restocks products, takes back earned points, releases the promo use, deactivates unused gift cards
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
- [x] Per-business SMS templates / tone; include "Reply STOP" wording on the first message only. Done 2026-10-10 (Settings → Messages → Text wording).
- [ ] Usage allowance per plan tier if pricing moves to tiers.

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

### Needs a real Stripe/Twilio run before relying on it (2026-10-10)
- [ ] Online deposit + card on file at booking (test cards on a connected test account), including the
      automatic refund when a slot is taken after the charge and the refund on online cancellation.
- [ ] Online store and gift card purchase (`/book/<slug>/shop`, `/book/<slug>/gift`): pay, order email,
      gift card email, pickup status on the sale page.
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
