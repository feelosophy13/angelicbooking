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
      platform profile for Standard accounts.
- [ ] Create both webhooks in live mode and set their secrets on Render **and** in `.env`:
      Connect endpoint `/api/stripe/webhook` → `STRIPE_WEBHOOK_SECRET`;
      account endpoint `/api/stripe/billing` → `STRIPE_BILLING_WEBHOOK_SECRET`. Events listed in `docs-ops.md`.
- [ ] Put **live** keys on Render and in `.env`; redeploy; verify a real card payment + refund from the sale page.
- [ ] Save the Customer Portal configuration once in the Stripe dashboard (branding, cancellation copy).
- [ ] Decide pricing: base plan (`BILLING_BASE_CENTS`, now 0), trial (`BILLING_TRIAL_DAYS`, now 0),
      number fee (`SMS_NUMBER_MONTHLY_FEE_CENTS`, 1500), text usage (`SMS_USAGE_CENTS`, 2) and
      included texts (`SMS_INCLUDED_PER_MONTH`, 0). Optional `PLATFORM_FEE_BPS` on card payments (now 0).

### Twilio
- [ ] Buy the first toll-free number for Angelic Beauty in production (Settings → Text messaging) and submit
      carrier verification. Needs EIN (or sole proprietor), address, contact. Approval takes 1–3 weeks;
      status is polled every 5 minutes.
- [ ] Decide whether a platform-wide fallback sender is wanted for businesses without a verified number
      (`TWILIO_FROM` / `TWILIO_MESSAGING_SERVICE_SID`). It would need its own toll-free verification.
- [ ] Keep an eye on the Twilio balance (≈$197 on 2026-10-08) and enable auto-recharge.

### Email
- [ ] Add a DMARC record in Cloudflare: `TXT _dmarc.mail1  v=DMARC1; p=none;` (improves Gmail/Yahoo delivery).
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
- [ ] Migrate Angelic Beauty's real data from Vagaro (Settings → Import) and switch the public booking link.
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
