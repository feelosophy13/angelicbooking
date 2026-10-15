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
- [ ] Decide pricing on the admin Pricing page (base plan, trial, number fee, text usage, included texts, platform fee on card
      payments). Prices are in the database now, not in environment variables.

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
- [ ] Platform billing overview (real MRR, failed payments) once Stripe keys exist.

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
- [ ] Not done: limiting a key to one location or one staff member (every query would need the filter); a per-key usage log; the shared first-entry
      `clientIp` used by the failed-sign-in throttle still trusts the first X-Forwarded-For entry (harmless with 256-bit keys, but the allowlist uses the last).
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
- [x] 2026-10-15: booking self-service fixes. Reschedule uses the same month calendar as booking (`book/[slug]/calendar.tsx`),
      can change provider (single service) or move a whole multi-service booking together (`rescheduleAppointment`), and
      shows the free-change deadline; Cancel states the deadline, deposit refund and late fee up front. Confirmation shows
      total, deposit paid / due, address, phone and policy. Class list shows description and price; going back to Edit in
      the paid form cancels the unpaid Stripe intent; calendar-shaped loading skeleton. Not walked live: an actual
      reschedule/cancel submit, multi-service move, and the Stripe edit-cancel (needs live keys).
- [x] 2026-10-15: booking page review fixes. Service search (shown above 8 services); the Provider step is skipped when one
      provider does the service; multi-location salons get a "Change" location line on every step; one shared
      `ContactFields` for the free and paid forms, with promo/referral codes behind "Have a code?"; paid form labelled
      Step 1/2 and 2/2 and uses the shared `Button`; waitlist pre-fills for signed-in clients; dead ends link to another
      service or a tel: link. Not yet walked live: the details form and the Stripe payment steps.
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
- [ ] Inbox follow-ups: email in the same thread (needs inbound email via Resend), assign a conversation to a
      staff member, saved quick replies, start a new conversation from the inbox, search, paging past 200 conversations.
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
