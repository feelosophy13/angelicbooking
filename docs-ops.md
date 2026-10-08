# Operations

## Environments
- **Local**: `pnpm dev` against Homebrew Postgres (see README).
- **Staging**: a second deployment of the same app with its own database and
  `*_test` Stripe/Twilio/Resend keys. Point `NEXT_PUBLIC_APP_URL` at the staging host.
  Promote by deploying the same commit to production once smoke tests pass there.
- **Production**: `NEXT_PUBLIC_APP_URL` = your real host; live Stripe keys; `JOBS_SECRET`
  set and a scheduler calling `POST /api/jobs/notifications` every 5 minutes.

## CI
`.github/workflows/ci.yml` runs typecheck, unit + DB integration tests (against a Postgres
service with the non-superuser app role), a production build, and the Playwright smoke test
(`apps/web/e2e/smoke.spec.ts`: sign up → onboard → service → book → checkout → public page).

Run locally:
```bash
pnpm --filter @angelic/web exec playwright install chromium
pnpm --filter @angelic/web e2e
```

## Monitoring
`src/instrumentation.ts` logs every unhandled request error and, when `ERROR_WEBHOOK_URL`
is set, POSTs a JSON summary (message, route, digest, top of stack) to that URL — a Slack or
Discord incoming webhook works as-is. For full tracing and grouping, add Sentry:
`pnpm --filter @angelic/web add @sentry/nextjs && npx @sentry/wizard@latest -i nextjs`.

## Rate limiting and headers
`src/proxy.ts` limits POSTs to `/api/auth/*` (20/min/IP), `/book/*` (30/min/IP) and other
`/api/*` (120/min/IP) with an in-memory store; swap in Upstash Redis for multi-instance
deployments. `next.config.ts` sets nosniff, frame, referrer, permissions and HSTS headers.

## Backups
`scripts/backup.sh` takes a `pg_dump` custom-format backup and keeps 14 days. Schedule it
nightly and sync the directory to object storage. Managed Postgres (Neon, DigitalOcean) also
provides point-in-time recovery — enable it.

## Google sign-in

1. Google Cloud Console → APIs & Services → OAuth consent screen: external, app name "Angelic Booking", your support email, scopes `email`, `profile`, `openid`. Publish it (an unpublished app only allows test users).
2. Credentials → Create credentials → OAuth client ID → Web application. Authorised JavaScript origin: your app URL. Authorised redirect URI: `https://<your-app>/api/auth/callback/google` (and the `http://localhost:3001/...` one for development).
Current state (2026-10-07): the client "Angelic Booking (web)" lives in Google Cloud project `primeval-voyage-384504` under tunityventure@gmail.com. It already has `http://localhost:3001` and `https://angelicbooking.com` as origins with the matching `/api/auth/callback/google` redirect URIs, the consent screen is published to production with angelicbooking.com as the authorised domain, and its home, privacy and terms links point at `https://angelicbooking.com`, `/privacy` and `/terms`. Add a new origin + redirect pair to that client if the app ever moves to another host (for example a staging subdomain).

3. Put the client ID and secret in `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and restart. The button appears on sign-in and sign-up; existing accounts with the same verified email are linked automatically, and users can connect/disconnect Google under Account.

## Render deployment

Production runs on Render (workspace "My Workspace", region Virginia):

- Web service `angelic-booking` (srv-db3eqnqj9qps73fba1rg), Node 22, deployed from `main` of github.com/feelosophy13/angelicbooking.
  Build: `npm install -g pnpm@12 && pnpm install --frozen-lockfile && pnpm --filter @angelic/web build`.
  Pre-deploy: `pnpm db:migrate` (runs Drizzle migrations with `DATABASE_ADMIN_URL`). Start: `pnpm --filter @angelic/web start`.
- Postgres `angelic-booking-prod-database` (dpg-db25eu0m7kps73dic8i0-a). The app connects as the `angelic_app` role
  (created by hand from `packages/db/sql/roles.sql` with a generated password); migrations use the database owner.
  External connections from a laptop need `?sslmode=require` on the URL; the internal URL used by the service does not.
- Environment variables live in the Render dashboard: `DATABASE_URL`, `DATABASE_ADMIN_URL`, `BETTER_AUTH_SECRET`,
  `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`, `JOBS_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `PLATFORM_FEE_BPS`.
  Stripe, Resend and Twilio keys are not set yet; add them there when ready.
- Custom domains `angelicbooking.com` (apex) and `www.angelicbooking.com` (redirects to apex) are attached to the service
  and verified. DNS is on Cloudflare (DNS only, not proxied): `A @ 216.24.57.1` and `CNAME www angelic-booking.onrender.com`.
  `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` point at `https://angelicbooking.com`, so the onrender.com hostname now
  returns 404 at `/` (the proxy treats any non-app host as a tenant booking domain). That is expected.
- Changing an env var through the API does not trigger a deploy; POST `/v1/services/<id>/deploys` afterwards.
- Reminder delivery: the Render Cron Job `angelic-booking-reminders` (crn-db3hnf6i0phs73a81qcg, same repo, build
  command `echo no build needed`) runs every 5 minutes:
  `curl -fsS -X POST -H "Authorization: Bearer $JOBS_SECRET" https://angelicbooking.com/api/jobs/notifications`.
  It has its own `JOBS_SECRET` env var (same value as the web service; update both if it is rotated). Each run's
  output is JSON `{processed, sent, failed, skipped, ms}`; see the cron job's Runs tab or Logs.

## Go-live checklist (remaining as of 2026-10-07)

Every item below is an environment variable on the Render web service (Dashboard → angelic-booking →
Environment). Saving in the dashboard offers "Save, rebuild, and deploy"; take it, because the
`NEXT_PUBLIC_*` values are baked in at build time. Through the API, POST a deploy afterwards.

### 1. Stripe (card payments)
1. Finish activating the platform account at dashboard.stripe.com (business details, bank account, identity).
2. Settings → Connect → Get started. Choose **Standard** accounts, fill in the platform profile
   (the app creates Standard accounts and, with `PLATFORM_FEE_BPS`, charges application fees).
3. Developers → API keys (live mode): copy the secret key and the publishable key.
4. Developers → Webhooks → Add endpoint. Tick **"Listen to events on Connected accounts"** (not
   "your account"). URL `https://angelicbooking.com/api/stripe/webhook`. Events:
   `account.updated`, `payment_intent.succeeded`, `payment_intent.payment_failed`,
   `charge.refunded`, `charge.dispute.created`. Copy the signing secret.
5. Render env: `STRIPE_SECRET_KEY=sk_live_…`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_…`,
   `STRIPE_WEBHOOK_SECRET=whsec_…`. Deploy.
6. In the app, each business connects its own account: Settings → Payments → Connect Stripe,
   which sends the owner through Stripe's onboarding and returns to `/settings/payments/return`.
7. Test: book and check out a real card for a small amount, then refund it from the sale page.
   The webhook should flip the sale to paid within seconds; Developers → Webhooks shows 2xx responses.

### 2. Resend (email: receipts, reminders, owner alerts)
1. resend.com → create an account, then Domains → Add domain `angelicbooking.com`
   (or a subdomain such as `mail.angelicbooking.com` to keep the apex clean).
2. Resend lists DNS records (DKIM TXT, SPF TXT, MX for bounces). Add them in Cloudflare → DNS,
   proxy off. Click Verify in Resend; it usually passes within minutes.
3. API Keys → Create (sending access only).
4. Render env: `RESEND_API_KEY=re_…`, `EMAIL_FROM="Angelic Booking <bookings@angelicbooking.com>"`
   (address must be on the verified domain). Optional: `SUPPORT_EMAIL=` for the help/legal pages.
5. Test: Settings → Notifications in the app no longer says "Email sending is off"; book an
   appointment with your own email and confirm the receipt arrives.

### 3. Twilio (SMS) — per-business toll-free numbers
The platform owns one Twilio account; each business buys its own toll-free number from inside the app
(Settings → Text messaging), submits carrier verification there, and texts go out from that number once
verified. Until then SMS rows are skipped with "No verified text number yet" and clients still get email.

Platform setup:
1. twilio.com → upgrade the account (trial accounts can only text verified numbers and cannot buy numbers
   for customers). The API returns `account … with status 4 is not active` until the account is activated.
2. Render env + local `.env`: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `SMS_NUMBER_MONTHLY_FEE_CENTS`
   (price shown to businesses; stored on each number for billing once Stripe billing exists).
   Optional `TWILIO_FROM` or `TWILIO_MESSAGING_SERVICE_SID`: a platform-wide fallback sender for businesses
   without a verified number (needs its own verification).
3. The opt-in screenshot attached to every verification is `apps/web/public/tollfree/opt-in.png`, rendered
   from `/tollfree/opt-in` (the booking form's consent step). Regenerate it if the consent wording changes
   (command in `apps/web/src/app/tollfree/opt-in/page.tsx`).

Per business (what the owner does in the app):
1. Settings → Text messaging → Choose a number (search by digits/letters, one click to buy). Twilio charges
   the platform ≈$2.15/month per toll-free number plus per-message fees.
2. Submit verification: prefilled from the profile (legal name, website or booking URL, business type/EIN,
   address, contact, use-case summary, sample messages). Twilio reviews within 1–3 weeks; status is polled
   every cron run (`refreshPendingVerifications`) and can be refreshed by hand. Rejections show the carrier
   feedback and allow a resubmit when Twilio permits edits.
3. Clients opt in via the unticked consent checkbox on the public booking/waitlist form (stored as
   `clients.sms_opt_in`); STOP/HELP are handled by Twilio. Inbound texts hit `/api/twilio/inbound`
   (signature-validated, empty TwiML).

Code: `apps/web/src/lib/twilio.ts` (fetch client), `apps/web/src/server/messaging.ts` (buy/verify/release/poll),
`settings/messaging/*` pages, table `messaging_numbers` (RLS + `jobs_read`).

### 4. Reminder scheduler (done)
Reminders are queued in the database with a future `scheduled_at`; receipts, confirmations and alerts are sent
right after the request that created them. The cron job above wakes the app every 5 minutes to send whatever is due.

How delivery works (`apps/web/src/lib/notify/index.ts`):
- `deliverDue` finds businesses with due rows through `withJobs`, which sets `app.jobs=on` so the `jobs_read`
  RLS policy lets it read `notifications` across tenants (the app role otherwise sees nothing outside a tenant).
- Rows are claimed per business with an atomic `UPDATE ... SET status='sending'` over a `FOR UPDATE SKIP LOCKED`
  subquery, so overlapping runs (cron + after-response sends, or two deploys) never send the same row twice.
- Sends run 8 at a time; outcomes are written back per tenant. Rows stuck in `sending` for 10 minutes
  (process died mid-run) are reclaimed by the next run.

### 5. Optional
- Google consent screen logo: adding one triggers Google's brand verification review; skip until
  a logo exists.
- `ERROR_WEBHOOK_URL`: a Slack or Discord incoming webhook to get notified of unhandled errors.
- Enable point-in-time recovery on the Render Postgres instance (paid plans).
