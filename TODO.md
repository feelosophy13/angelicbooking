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
