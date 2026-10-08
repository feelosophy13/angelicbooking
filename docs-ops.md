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
- Custom domains `angelicbooking.com` (apex) and `www.angelicbooking.com` (redirects to apex) are attached to the service.
  Once DNS resolves, change `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` to `https://angelicbooking.com` and redeploy.
- Reminder delivery: nothing calls `POST /api/jobs/notifications` yet in production. Add a Render Cron Job
  (every 5 minutes, `curl -X POST -H "Authorization: Bearer $JOBS_SECRET" https://angelicbooking.com/api/jobs/notifications`)
  or any external scheduler.
