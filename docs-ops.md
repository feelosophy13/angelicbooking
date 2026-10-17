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
It also runs `pnpm --filter @angelic/web lint`, non-blocking until eslint and a config are added to apps/web.

### Make Render wait for CI
By default Render deploys `main` the moment a commit lands, whether or not CI passes. To make
it wait (owner does this; nothing in the repo changes it):

1. Render dashboard → `angelic-booking` web service → **Settings** → **Build & Deploy** →
   **Auto-Deploy** → choose **After CI Checks Pass** → Save.
2. Do the same on the cron jobs built from this repo (`angelic-booking-reminders`, and the demo
   refresh job) so they don't run code the web service refused.

Render then waits for every GitHub check on the commit (here the `CI / check` job) and skips the
deploy if any fails. Manual deploys from the dashboard or the API are not gated. Optionally also
protect `main` on GitHub (Settings → Branches → require the `check` status) so failing code
can't be merged in the first place.

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
  `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`, `JOBS_SECRET`, `GOOGLE_CLIENT_ID/SECRET`,
  `RESEND_API_KEY`, `EMAIL_FROM`, `TWILIO_ACCOUNT_SID/AUTH_TOKEN`. Every variable set on Render must also exist in the local `.env`.
  Prices are not environment variables any more (see "What the Pricing page does").
  Stripe, Resend and Twilio keys are not set yet; add them there when ready.
- The app lives at **`app.angelicbooking.com`** (`BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL`); it is the only custom
  domain on the Render service. Cloudflare DNS: `CNAME app angelic-booking.onrender.com` (DNS only, not proxied).
  The bare domain and `www` are served by the Cloudflare Worker `angelicbooking` (marketing site, proxied Worker records
  in the same zone); a Cloudflare redirect rule sends `angelicbooking.com/book/*`, `/app*`, `/sign-in`, `/sign-up` to
  the app host so links issued before the move keep working. Any other host hitting the app, including the onrender.com
  hostname, is treated as a tenant booking domain and 404s at `/`. That is expected.
  Moving hosts: add the domain on Render, add DNS, wait for "verified", change the two env vars, deploy, update the cron
  job's URL, and add the new origin + redirect URI to the Google OAuth client.
- Changing an env var through the API does not trigger a deploy; POST `/v1/services/<id>/deploys` afterwards.
- Low-stock email: the same job (`/api/jobs/notifications`) emails owners and inventory managers once a day after 8am business-local time, listing what is out, low or off and not already on order. Nothing to set up.
- Reminder delivery: the Render Cron Job `angelic-booking-reminders` (crn-db3hnf6i0phs73a81qcg, same repo, build
  command `echo no build needed`) runs every 5 minutes:
  `curl -fsS -X POST -H "Authorization: Bearer $JOBS_SECRET" https://app.angelicbooking.com/api/jobs/notifications`.
  It has its own `JOBS_SECRET` env var (same value as the web service; update both if it is rotated). Each run's
  output is JSON `{processed, sent, failed, skipped, ms}`; see the cron job's Runs tab or Logs.

## Go-live checklist (remaining as of 2026-10-07)

Every item below is an environment variable on the Render web service (Dashboard → angelic-booking →
Environment). Saving in the dashboard offers "Save, rebuild, and deploy"; take it, because the
`NEXT_PUBLIC_*` values are baked in at build time. Through the API, POST a deploy afterwards.

### 1. Stripe (card payments)
1. Finish activating the platform account at dashboard.stripe.com (business details, bank account, identity).
2. Settings → Connect → Get started and fill in the platform profile. The app creates connected accounts with the
   **Accounts v2** API in the SaaS configuration (`dashboard: full`, Stripe collects fees and carries losses, merchant
   `card_payments`); that is the v2 equivalent of a Standard account, and Stripe rejects v1 `type: standard` creation
   for new integrations. Direct charges with an optional platform (application) fee are unchanged; set the fee in the admin Pricing page (per business on its Billing tab).
3. Developers → API keys (live mode): copy the secret key and the publishable key.
4. Developers → Webhooks → Add endpoint. Tick **"Listen to events on Connected accounts"** (not
   "your account"). URL `https://app.angelicbooking.com/api/stripe/webhook`. Events:
   `account.updated`, `payment_intent.succeeded`, `payment_intent.payment_failed`,
   `charge.refunded`, `charge.dispute.created`, and for membership auto-renewal
   `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`. Copy the signing secret.
5. Add a SECOND endpoint for your own account (leave "Connected accounts" unticked) at
   `https://app.angelicbooking.com/api/stripe/billing` with events `checkout.session.completed`,
   `customer.subscription.created/updated/deleted/paused/resumed`, `invoice.paid`, `invoice.payment_failed`.
   Copy its signing secret.
6. Render env + local `.env`: `STRIPE_SECRET_KEY=sk_live_…`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_…`,
   `STRIPE_WEBHOOK_SECRET=whsec_…` (Connect endpoint), `STRIPE_BILLING_WEBHOOK_SECRET=whsec_…` (account endpoint). Deploy.
7. Stripe → Settings → Billing → Customer portal: click Save once so a default portal configuration exists
   (the app creates one through the API if none is found, but the dashboard copy lets you brand it).
8. In the app, each business connects its own account: Settings → Payments → Connect Stripe,
   which sends the owner through Stripe's onboarding and returns to `/settings/payments/return`.
9. Test: book and check out a real card for a small amount, then refund it from the sale page.
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
2. Render env + local `.env`: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`. The text-number price comes
   from the price book (admin Pricing page); it is shown to businesses and stored on each number when bought.
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

### 4b. Platform billing (how businesses pay you)
Stripe Billing on the platform account (`apps/web/src/server/billing.ts`). Each business becomes a Stripe
Customer with one subscription:
- **Base plan** (price book `baseCents`, currently 0: the platform is free, a card is only collected
  for add-ons). The price book's trial days add a trial when the base is paid.
- **Dedicated text number** (price book `numberCents`, 1500): a licensed subscription item added when a
  number is bought and removed (prorated credit) when released. Buying requires an `active`/`trialing`
  subscription whenever the number or usage costs money.
- **Text usage** (price book `smsUsageCents` per message, 2, after `smsIncluded`, 0): a metered price on
  Stripe Billing Meter `sms_sent`. Every SMS marked sent produces one meter event, idempotent on the
  notification id, from the delivery job.
- Products (`angelic_platform`, `angelic_sms_number`, `angelic_sms_usage`), prices (lookup keys encode the
  amounts) and the meter are created on first use. To change a price, change it on the admin Pricing page;
  existing subscriptions keep their old price until migrated.
- Owner flow: Settings → Billing → "Add a card" (Stripe Checkout, `payment_method_collection: always`)
  → back to the page, which syncs the subscription from the Checkout session; "Manage card & invoices"
  opens the Customer Portal. `past_due`/`unpaid` shows a red banner across the app.
- **Texts need a subscription.** Every text costs us money and is billed on the subscription, so a business with no `active` or
  `trialing` subscription sends no texts (they are marked skipped with the reason, and Settings → Billing and Text messaging say why).
  Emails are unaffected. Exceptions: comped businesses, a $0 text price, and a platform where Stripe billing is not configured.
  The rule is `smsPausedReason` in `apps/web/src/lib/billing-config.ts`, applied in `lib/notify/index.ts`.
- Card payments salons take from clients still go to their own Connect account; a platform
  (application) fee, set on the admin Pricing page, can be charged on those independently of the subscription.
- Local testing without the webhook: the Checkout return URL syncs state; "Refresh" re-reads the
  subscription. For webhooks locally use `stripe listen --forward-to localhost:3001/api/stripe/billing`.

### 5. Optional
- Google consent screen logo: adding one triggers Google's brand verification review; skip until
  a logo exists.
- `ERROR_WEBHOOK_URL`: a Slack or Discord incoming webhook to get notified of unhandled errors.
- Enable point-in-time recovery on the Render Postgres instance (paid plans).

## Vagaro full import

`apps/web/scripts/import-vagaro.ts --business <slug> [--dir data/vagaro-export] [--dry-run]` loads the whole
Vagaro export (not just the three CSVs the in-app importer takes). Re-runnable: rows are matched on phone/email/
name, service names, staff names and appointment time+staff+service. Past appointments are inserted with
`allow_overlap` (Vagaro allowed double booking); future clashes are kept and listed. Run from apps/web with the
db package's tsx and `--env-file=../../.env`; point `DATABASE_URL` at production to load there.

## Locations and money (added 2026-10-10)

A location is the money boundary inside a tenant. `locations.stripe_account_id` (null = the business's
main account), `locations.tax_rate_bps` (null = business default) and the location's name/address/phone
(receipt identity when it has its own account). `apps/web/src/server/locations.ts` → `paymentContext()`
resolves all of that for a sale, appointment or location; every Stripe call goes through it.

- One Connect webhook endpoint still serves everything: `event.account` is looked up on `businesses` first,
  then on `locations` (policy `jobs_read` on `locations`, migration 0039). Nothing to add in the Stripe
  dashboard when a location connects its own account.
- Stripe Customers are per connected account: `client_stripe_customers (client_id, stripe_account_id)`.
  Legacy `clients.stripe_customer_id` was copied into it by migration 0039 and is no longer read.
- Migration 0039 also backfilled `sales.location_id` (from the appointment, else default), `gift_cards` /
  `client_packages.location_id` (from the sale), `clients.home_location_id` (last appointment) and, for
  multi-location businesses, `staff_schedules.location_id` (staff primary, else default). Re-run nothing;
  it is idempotent-safe but only meant to run once.
- Staff hours rows: `staff_schedules.location_id` null = the staff member's primary site, else the default.
- Text numbers (migration 0040): `messaging_numbers.location_id` null = business-wide. A location may hold its
  own number; the sender for each queued message is chosen from `notifications.location_id` (location's verified
  number → business verified number → `TWILIO_FROM`/messaging service). Inbound routing is unchanged (by the
  number texted). Each extra number is billed through the same subscription item flow as the first.
- `locations.timezone` is now applied to scheduling (availability, booking pages, messages, filtered calendar).
- `valid_location_ids text[]` on `gift_cards`, `packages`, `membership_plans`: empty = any location.
- Migrations 0044–0045 (forms): `forms.location_ids`, `form_submissions.signature_file_id` / `assisted_by_user_id`,
  `files.kind` gains `form` and `signature`, and a `jobs_read` policy on `forms` so the cron run can queue the
  morning-of nudge (`queueFormsNudges` in `server/forms.ts`, called from `/api/jobs/notifications`).
- Migration 0043: `locations.clock_token` (kiosk QR secret, `/clock/<token>` is public and rate limited),
  `staff.clock_pin_hash` (sha256 of `businessId:pin`), `time_entries.location_id`.
- Migration 0042: `waitlist.location_id`; `clients.stripe_customer_id` dropped (per-account customers live in
  `client_stripe_customers`). Online shop / gift card pages accept `?location=`; without it the default site sells.

## Stripe webhook setup script

`apps/web/scripts/stripe-production-setup.ts` (run with `packages/db/node_modules/.bin/tsx --env-file=../../.env` from
apps/web) creates or updates both webhook endpoints for app.angelicbooking.com from the keys in `.env`, writes the
signing secrets back to `.env`, and with `RENDER_API_KEY` copies the four Stripe variables to the Render service
(`--stripe-only` skips Render, `--recreate` rotates secrets, `--deploy` triggers a deploy). Secrets are never printed.
Current state (2026-10-10): sandbox endpoints exist and the sandbox keys are on Render.

## Features that depend on external services (added 2026-10-10)

- **Online deposits / card on file, online store, gift cards, membership auto-renew** all run on the
  business's Connect account and need `STRIPE_SECRET_KEY` + `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` plus the
  business connected under Settings → Payments. Pages degrade to a "being set up" notice until then.
- **Inbound texts** (`/api/twilio/inbound`) are stored per business by matching the `To` number to the
  business's toll-free number; STOP/START keywords update the client's text opt-in. The Twilio number's
  messaging webhook is set at purchase time (`smsUrl`), so nothing extra is needed.
- **Automations** (birthday / we-miss-you / rebook) and **campaigns** are queued into `notifications` by the
  same cron job (`POST /api/jobs/notifications`); the job output now includes `automations: {businesses, queued}`.
- **Client sign-in codes** go by email (Resend) or text (the business's verified number). In development
  with no Resend key the code is printed to the server log.
- **Uploaded images** (logo, cover, product photos) are stored in Postgres (`files`, max 2 MB each) and
  served from `/api/files/<id>` with immutable caching. Move to object storage if they grow past a few hundred MB.
- **Provider calendar feeds** are public by secret token (`/api/calendar/<token>.ics`); reset from the staff profile.

## Image storage (Cloudflare R2, added 2026-10-13)

Pictures and client files can live in Cloudflare R2 instead of Postgres. Without the `R2_*` variables the app
keeps using Postgres, so local development needs nothing.

- **What goes where.** Public pictures (logos, covers, service, category, product, package and staff photos) are
  resized to web size and stored as WebP in the public bucket, addressed from `R2_PUBLIC_BASE_URL` (a custom
  domain such as `images.angelicbooking.com`, so Cloudflare's CDN caches them). Client form photos and
  signatures go in the private bucket and are only read through `/api/files/<id>` after the permission check.
- **Setup.** Switch R2 on in the Cloudflare dashboard, create an R2 API token (Object Read & Write) to get the S3
  access key and secret, then run `apps/web/scripts/provision-r2.ts` to create both buckets and attach the CDN
  domain. Put the `R2_*` values in `.env` and on Render (PUT the env var, then POST a deploy). Check with
  `scripts/r2-check.ts`.
- **Every upload is optimized,** whether R2 is on or not: resized, re-encoded as WebP, EXIF/GPS removed (see
  "Images and uploads" in DESIGN.md). Form photos and signatures are optimized too before they reach the private
  bucket. Only SVG, PDF and HEIC are stored as sent.
- **Existing images.** After deploying, move what is already in Postgres with
  `scripts/migrate-files-to-r2.ts`, or on the server: `POST /api/jobs/migrate-files?limit=20` with
  `Authorization: Bearer $JOBS_SECRET`, repeated until `left.files` is 0 (`?dryRun=1` only reports). Old
  `/api/files/<id>` links keep working (they redirect to the CDN). Postgres does not hand the freed space back to
  the disk by itself; run `VACUUM FULL files` in a quiet moment when you want the size to drop.

- **Upload size.** Server actions accept request bodies up to 40 MB (`experimental.serverActions.bodySizeLimit` in
  `next.config.ts`) because a visit can add several phone photos at once; each photo is resized on the server.
  Render and Cloudflare in front of the app must not impose a smaller limit.

## Trying the app as another role (development only)

With the dev server running, a small amber "Dev · View as" selector sits at the bottom right of every business page. Pick Manager, Front desk or
"Provider · <stylist>" to see the menu, calendar and permission errors that role gets; pick "Owner (you)" to go back. It is a cookie read by
`requireBusiness` (`lib/dev-view-as.ts`) and is ignored, and the selector not drawn, when `NODE_ENV` is production or `RENDER`/`VERCEL` is set.

## Platform admin app (added 2026-10-14)
`apps/admin` is a separate Next.js app (port 3002 locally: `pnpm dev:admin`) for you, not for salons. It lists every
business with usage metrics, edits default and per-business pricing, suspends / comps businesses, extends
trials, exports CSV and shows platform health and an audit log. It never shares a process or credentials with `apps/web`.

**Database role.** It connects as `angelic_admin` (`packages/db/sql/admin-role.sql`): bypasses row-level security, read-only
except `platform_pricing`, `business_pricing`, `admin_audit_log` and the columns `suspended_at`, `suspended_reason`,
`comped`, `trial_ends_at`, `updated_at` of `businesses`. Run the file as the DB owner after every migration that adds tables,
and change the password before using it in production. `ADMIN_DATABASE_URL` goes on the admin service only.

**Admin accounts.** Operators are rows in the `admin_users` table (migration 0091): email, scrypt password hash, optional name, last sign-in,
and a disabled flag. Nothing about who the admins are lives in environment variables. Make the first one with
`pnpm --filter @angelic/admin create-admin you@example.com "Your Name"` (hidden password prompt; run it against the production database
with `ADMIN_DATABASE_URL` set to the admin role's URL). After that, admins add each other under **Admins** in the app: the new person gets
an emailed link (works once, 30 minutes) to choose a password, or signs in with Google. Disabling an admin signs them out on their next
click; you can't disable yourself or the last enabled admin. Every change is recorded in Activity under the admin's email.

**Env (admin service).** `ADMIN_DATABASE_URL`, `ADMIN_SESSION_SECRET` (32+ random chars; signs session cookies and reset links),
optional `ADMIN_TOTP_SECRET` (`pnpm --filter @angelic/admin totp-secret`, then add the key to an
authenticator app; login then needs the 6-digit code; off in production, where Cloudflare Access is the second factor), optional `STRIPE_SECRET_KEY` (restricted, read-only: shows what Stripe actually billed).

**Moving off `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH`.** Until the first account exists, those two variables still let that one person sign in
once, and the sign-in creates their account (so no one is locked out by the deploy). After that first sign-in, delete both variables from the
service; they are never read again once any account exists. Re-run `admin-role.sql` as the DB owner after deploying (it grants the admin role
access to `admin_users`). The old `admin_credentials` table is no longer read; migration 0091 copied its row into `admin_users`.

**Deploy.** A second Render web service from the same repo: build `pnpm install && pnpm --filter @angelic/admin build`, start
`pnpm --filter @angelic/admin start`, domain `admin.angelicbooking.com`, with a Cloudflare Access policy (your email only) in front.
Sessions last 8 hours; logins are throttled to 5 failures per IP per 15 minutes per instance.

**Forgot the password?** The login page has "Forgot your password?": it emails a link (valid 30 minutes, works once, dies the moment the
password changes) to the address entered, if that is an enabled admin, through Resend (`RESEND_API_KEY` and `EMAIL_FROM` on the admin service).
The form always gives the same answer, so it can't be used to find out which emails are admins'. Needs `ADMIN_BASE_URL`
(https://admin.angelicbooking.com) for the link.

**Google sign-in.** "Continue with Google" appears when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set on the admin service (the same
OAuth client as the web app is fine). Add `<ADMIN_BASE_URL>/auth/google/callback` to that client's authorised redirect URIs (and
`http://localhost:3002/auth/google/callback` for local). Only enabled admins (matched on email) may get in, and the
Google account's email must be verified. It uses authorization code + PKCE + a state cookie. Google sign-in counts as the full login (no
authenticator code on top). Cloudflare Access still sits in front of everything.

**Locked out completely?** Run `create-admin` again with the same email: it sets a new password and re-enables the account.

**What suspend does.** Closes the staff app (redirects to `/suspended`), the public booking page, client self-service links, calendar
feeds, the clock-in kiosk and the mobile API, and skips outgoing texts and emails. Data is kept. The daily billing sweep also pauses
invoice collection on the business's Stripe subscription (invoices are voided) and resumes it after reactivation.

**What the Pricing page does.** (Code still calls it the "price book".) Lives only in the database (`platform_pricing`, `business_pricing`): the old `BILLING_*` / `SMS_*` / `PLATFORM_FEE_BPS` environment variables are gone. Until a price book is saved everything is $0 and the Pricing page and Dashboard say so; `pnpm --filter @angelic/db seed:price-book` copies old env values in once. New subscriptions are
built from it (base + extra locations + extra staff + metered texts); the 07:00 UTC run of the reminders job keeps quantities in
line with each business's locations and active staff. Platform-wide price changes do not re-price existing subscribers; a business
with its own pricing deal is re-priced. Comped businesses are never charged.

## New-business guardrails (added 2026-10-15)
What a new owner goes through, and what stops abuse:
- **Sign-up** has a Cloudflare Turnstile bot check (widget "Angelic Booking sign-up"; `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is baked in at build time,
  `TURNSTILE_SECRET_KEY` is read at runtime; both must be set on Render before a deploy; with no secret the check is skipped, as in CI).
  Running Playwright locally with the keys in `.env` needs them blanked, or the test cannot pass the check.
- **Creating a business** needs the Terms / Privacy / texting-rules checkbox (stored as `businesses.terms_accepted_at` and `terms_version`; the
  version is `TERMS_VERSION` in `lib/terms.ts`, bump it when the documents change), and refuses reserved addresses (`admin`, `api`, `demo-…` and
  other platform paths; the list is in `lib/access.ts`). The same checks run in a Better Auth hook, so calling the API directly cannot skip them.
- **Free trial.** A new business gets `trial_ends_at = now + price-book trial days`. While in trial a banner counts the days down; adding a card
  early carries the remaining trial onto the Stripe subscription (no charge until it ends, if 48 h or more remain). When the trial ends with no
  subscription the staff app closes (everything redirects to `/app/<slug>/locked`; only Settings → Billing opens), the booking page returns 404
  and no messages go out. Cancelled or unpaid subscriptions are locked the same way. Never locked: comped businesses, businesses with an active or
  trialing (or past_due) subscription, a platform without Stripe billing, a platform whose base plan is $0, and **older businesses with no trial
  date (grandfathered)**. Use the admin app's Extend trial or Comp to change one. The rule is `accessState` in `lib/access.ts`.
- **Verified email.** A new business (`publish_requires_verified`) stays off the public web and sends no messages until an owner has verified their email.
  Older businesses are exempt. A banner in the app offers to resend the link.
- **Free-account limits.** Until a subscription exists: texts are paused, emails are capped per day (price book "Emails per day before subscribing", default 100,
  0 = no limit) and at most 2 API keys. Not limited yet: photo/file storage (only per-file size limits apply).
- **Nudges.** One reminder email (15:00 UTC run of the reminders job) to people who verified their email, signed up 1–7 days ago and still have no
  business. A welcome email goes out when a business is created. The admin Dashboard shows how many accounts have no business.
- **Setup checklist** gained "Verify your email", "Add a card" (during the trial) and "Turn on two-factor sign-in".

## Custom booking domains (added 2026-10-15)
Owners connect `book.theirsalon.com` under Settings → Custom domain. Saving it registers the hostname with the Render web service through the
Render API (so a certificate is issued), shows the exact DNS record to add (a CNAME to the service's onrender.com address, or an A record for a bare
domain), and rechecks every 5 minutes (the reminders job) until Render reports it verified: Not set → Waiting for your DNS → Active. "Check now"
and "Remove" are on the page; the hostname must be unique, may not be an IP, a local or Render name, or anything under angelicbooking.com.
- **Needs** `RENDER_API_KEY` and `RENDER_SERVICE_ID` on the web service. Render API keys cannot be limited to one service, so this key can change
  anything in the Render account: treat the web service's environment as that sensitive. Calls are made only when `RENDER` is set (i.e. on Render),
  never from a laptop. Without the key a saved hostname gets status "Being set up by us" and shows up under Needs attention in the admin app.
- Optional `CUSTOM_DOMAIN_CNAME_TARGET` overrides the CNAME value (default: the service's own onrender.com host, asked of Render).
- A custom domain's DNS must not be proxied by Cloudflare ("DNS only") until it is Active; the booking page itself works the same on the custom host.
- Claiming a hostname first blocks anyone else from saving it. If a real owner finds theirs taken, remove the old claim in the database (`businesses.custom_domain`).

## Demo tenant

Two fake businesses for walkthroughs and screenshots, built by `apps/web/scripts/seed-demo.ts` (it never touches any other
tenant). Both use the password `demo-salon-2026`:
- `demo@angelicbooking.com`, business `demo-salon` ("Luxe Beauty Studio"), one studio.
- `demo2@angelicbooking.com`, business `demo-twosites` ("Glow Collective"), two locations (Arlington, Reston) with
  different hours, staff who work at one site on some days and the other site on others, and the booking page asks for a location.

### Keep it fresh

Every date in the data is relative to the day the script runs: eight weeks of history behind you, three weeks of bookings,
time off, classes, waitlist requests and standing appointments ahead. Nothing is a fixed calendar date, so it never
goes wrong, it just ages: after a few weeks the future runs out, the waitlist and time off are in the past and "this month"
reports look thin. To refresh, from the repo root:

```
pnpm demo:refresh
```

It deletes and rebuilds both demo businesses in about 30 seconds (logins stay the same, only demo tenants are touched,
and it refuses to run unless `DATABASE_URL` is a local database). It also runs by itself every Monday at 6:00 through the macOS launchd job
`~/Library/LaunchAgents/com.angelicbooking.demo-refresh.plist` (log: `~/Library/Logs/angelic-demo-refresh.log`). It needs the
Mac awake (a run missed while asleep happens on wake) and local Postgres running, which Homebrew starts at login. Manage it with
`launchctl bootout gui/$(id -u)/com.angelicbooking.demo-refresh` (stop), `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.angelicbooking.demo-refresh.plist`
(start) and `launchctl kickstart -k gui/$(id -u)/com.angelicbooking.demo-refresh` (run now). The Claude desktop app also has a
paused task `refresh-demo-data` that does the same thing; leave it paused so the two don't both run. Run it by hand before a demo. To rebuild one tenant: `../../packages/db/node_modules/.bin/tsx --env-file=../../.env scripts/seed-demo.ts [--profile glow] --reset`
from `apps/web`.

### Hosted demo (production)

The demo salons can also live in the production database so they can be shown from `app.angelicbooking.com`
(`/app/demo-salon`, `/book/demo-salon`), refreshed weekly by a Render cron job. Safeguards, all in code:
- Businesses whose slug starts with `demo-` never email or text anyone: the notification queue marks their messages
  "skipped" (`lib/notify`), so fake clients and staff addresses can't hurt sender reputation or cost SMS money.
- The seed refuses a non-local database unless `DEMO_ALLOW_REMOTE=1` is set, and then also requires a `DEMO_PASSWORD` of your
  own (the repo default is public). Changing `DEMO_PASSWORD` later is fine: the next refresh recreates the demo logins.
- Demo pictures go into Postgres (R2 keys are never given to the job), about 40 MB per tenant per refresh.

Render cron job `angelic-booking-demo-refresh` (same repo and `main` branch as the app, auto-deploys on push):

| Setting | Value |
|---|---|
| Type, plan, region | Cron Job, Starter, Virginia |
| Schedule | `0 10 * * 1` (Mondays 10:00 UTC, 6:00 AM Eastern in summer) |
| Build command | `npm install -g pnpm@12 && pnpm install --frozen-lockfile` |
| Command | `pnpm demo:refresh` |
| Environment | `DATABASE_URL`, `DATABASE_ADMIN_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL` (the same values as the web service), `DEMO_ALLOW_REMOTE=1`, `DEMO_PASSWORD=<a secret of your own>` |

It needs nothing else (no Stripe, Resend, Twilio or R2 keys). To run it now, use "Trigger Run" on the job. The demo logins are
`demo@angelicbooking.com` (Luxe Beauty Studio) and `demo2@angelicbooking.com` (Glow Collective) with that `DEMO_PASSWORD`.
`DEMO_PASSWORD` exists locally too (the default, for the local demo), which is the one deliberate difference from Render.

### What it creates

The menu is Angelic Beauty's real one (angelicbeautyva.com, fetched 2026-10-11), with the studio's own category and service
photos fetched at seed time (a gradient tile if a fetch fails). Per tenant: six staff across every pay model with
**different days and hours each**, so Staff hours coverage varies by category, day and time (facials only when Priya is in, no
brow coverage Tuesdays, no lash artist Thursday mornings, colour analysis and permanent makeup not on Wednesdays or
Fridays); 40 clients; eight weeks of completed visits with sales, tips, reviews and loyalty; three weeks of bookings and a few
blocked-time slots; time off (a week's vacation, single days, a late start, an early finish); time clock; products with
stock; two forms and 30 completed submissions (26 intake, 4 signed consents); packages and membership plans with 10 client
memberships (active, paused, ended, cancelled) and 4 package balances; gift cards; a promo code; a waitlist (open, booked
and closed); referrals (rewarded and waiting); client notes; three campaigns and four texts from clients; four group classes
with seats (one already held); three standing appointments; four refunds (two to store credit); two finalized payroll
periods; and 16 visits with before and after photos for the Gallery.

Demo pictures always stay in Postgres: the script blanks the R2 keys, so nothing reaches the real bucket. Photos alone can be
added to an existing demo tenant with `scripts/seed-demo-photos.ts [slug]`.
