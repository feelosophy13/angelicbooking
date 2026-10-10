# To do

Living list of outstanding work and recurring upkeep for Angelic Booking. Keep it current:
tick items off, add new ones at the right level, and date anything time-sensitive.
Operational detail (ids, commands, env names) lives in `docs-ops.md`; product plan in `PLAN.md`.

## 1. Launch blockers (nothing charges or texts until these are done)

### Stripe
- [ ] Put Stripe **test** keys in local `.env` (`STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`) so the
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

### Domain move to app.angelicbooking.com (in progress 2026-10-10)
- [ ] Cloudflare DNS: `CNAME app → angelic-booking.onrender.com` (DNS only).
- [ ] Google Cloud → Credentials → "Angelic Booking (web)": add origin `https://app.angelicbooking.com` and redirect
      URI `https://app.angelicbooking.com/api/auth/callback/google`; set the consent screen home link to the app URL.
- [ ] After Render shows the domain verified: switch `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL`, deploy, update the cron
      job URL, re-check sign-in, Google sign-in, a booking page and the cron run log.
- [ ] Later: put a marketing site on the bare domain and remove the root redirect from `src/proxy.ts`.

## 2. Before real customers

- [ ] Upgrade the Render Postgres from the free `0.1c-256mb` tier to a paid plan with backups and
      point-in-time recovery; until then run `scripts/backup.sh` nightly somewhere and store the dumps off-box.
- [ ] Set `ERROR_WEBHOOK_URL` (Slack/Discord incoming webhook) so unhandled errors are seen; consider Sentry.
- [ ] Add an uptime check on `https://app.angelicbooking.com/sign-in` and on the cron job's run history
      (Render emails on failed runs if enabled in the cron job's settings).
- [ ] Rate limiting is in-memory (fine on one instance). Move to Upstash Redis before scaling to 2+ instances;
      the notification claim logic is already safe for multiple instances.
- [ ] Google consent screen: add a logo (triggers Google brand verification) once a logo exists.
- [ ] Logo upload (profile currently takes URLs only).
- [ ] Migrate Angelic Beauty's real data from Vagaro (Settings → Import) and switch the public booking link.
- [ ] Write a short privacy/terms review with a lawyer before accepting other businesses.

## 3. Product backlog

- [ ] Membership auto-billing (recurring charges on the business's Connect account).
- [ ] Tap to Pay / card reader support.
- [ ] Run the Expo mobile app on a device against `/api/mobile`.
- [ ] Inbound SMS: store client replies (currently acknowledged and dropped) and show them on the client page.
- [ ] Per-business SMS templates / tone; include "Reply STOP" wording on the first message only.
- [ ] Usage allowance per plan tier if pricing moves to tiers.

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
