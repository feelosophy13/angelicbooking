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
