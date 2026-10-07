# Angelic Booking

Multi-tenant scheduling and point-of-sale for salons and spas. Each business connects
its own Stripe account. See [PLAN.md](PLAN.md) for the full product and technical plan.

## Layout

```
apps/web          Next.js 16 app: staff dashboard, auth, (later) public booking pages
packages/core     Pure domain logic: availability engine, time helpers, permissions. Unit-tested.
                  (packages/db also has DB integration tests for RLS; `pnpm test` runs both.)
packages/db       Drizzle schema, migrations, Row-Level Security, tenant-scoped query helper
```

## Local setup

Requires Node 22+, pnpm, and a local Postgres 16 (Homebrew works).

```bash
pnpm install
createdb angelic_booking
psql -h localhost -d angelic_booking -f packages/db/sql/roles.sql   # creates the non-superuser app role
cp .env.example .env                                               # then set BETTER_AUTH_SECRET
pnpm db:migrate
pnpm dev                                                           # http://localhost:3000
```

## Tenancy model

- A Better Auth **organization** is a tenant. `businesses` extends it 1:1 (same id).
- Every tenant table carries `business_id` and has a forced Row-Level Security policy.
- The app connects as `angelic_app`, which cannot bypass RLS. Migrations use `DATABASE_ADMIN_URL`.
- All domain queries run through `withTenant(businessId, tx => ...)`, which sets
  `app.business_id` for the transaction. Without it, tenant tables return zero rows.
- The tenant id is derived server-side only, from the signed-in user's membership
  (`apps/web/src/lib/tenant.ts`). Never from the client.

## Scheduling integrity

`appointment_items` has a GiST exclusion constraint: one staff member can never hold two
live (non-cancelled) items that overlap in time, even under concurrent requests.
Services with processing time create two items (active + finish) so the gap stays bookable.

## Operations

See [docs-ops.md](docs-ops.md) for CI, environments, monitoring, rate limits, and backups.

## Commands

| Command | What |
|---|---|
| `pnpm dev` | Start the web app |
| `pnpm test` | Run unit tests (core) |
| `pnpm typecheck` | Typecheck all packages |
| `pnpm db:generate` | Generate a migration from schema changes |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm --filter @angelic/web e2e` | Playwright smoke test (install browsers first: `pnpm --filter @angelic/web exec playwright install chromium`) |
| `apps/web/scripts/payroll-check.mts` | Dev check: run payroll for a slug and period, write the workbook, print the Summary tab (see file header) |
