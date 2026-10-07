# Angelic Booking — Product & Technical Plan

A multi-tenant salon/spa booking and point-of-sale platform intended to replace Vagaro.
Each business (tenant) connects its **own Stripe account** and is paid directly; the
platform never holds the business's money.

---

## 1. Goals and non-goals

**Goals**
- Fast, uncluttered staff experience: calendar first, two clicks to book or check out.
- Multi-tenant from day one: one deployment serves many businesses with strict data isolation.
- Each business accepts payments through its own Stripe account (Stripe Connect).
- Cover the things Vagaro does badly or not at all (see §3).

**Non-goals for v1**
- Marketplace/discovery (Vagaro's consumer app). Businesses bring their own clients.
- Inventory management beyond simple retail product sales.
- Native mobile apps (web-first, mobile-responsive; native comes in Phase 5).

---

## 2. Recommended tech stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript everywhere** | One language for web, API, jobs, and later mobile (Expo). Shared types for the domain model. |
| Web framework | **Next.js 15 (App Router)** | Server components for the dashboard, server actions / route handlers for the API, static+ISR for public booking pages. |
| UI | **Tailwind CSS + shadcn/ui** | Clean, consistent, fast to build. Calendar via a headless scheduler component (e.g. Schedule-X or a custom grid). |
| Database | **PostgreSQL 16** | Row-Level Security for tenant isolation, `tstzrange` + exclusion constraints to prevent double-booking, rock-solid for money. |
| ORM / migrations | **Drizzle ORM** | SQL-close, type-safe, no codegen step, easy to run raw SQL for RLS and range constraints. |
| Auth | **Better Auth** (self-hosted) or **Clerk** (hosted) | Both support organizations/memberships natively. Better Auth keeps users in your own DB; Clerk is faster to ship and handles MFA, magic links, orgs. Pick Clerk if you want to move fastest. |
| Payments | **Stripe Connect (Standard accounts)** + Stripe Terminal | Business owns its Stripe account and dashboard; direct charges; optional platform fee. Terminal / Tap to Pay for in-person. |
| Background jobs | **Inngest** (or Trigger.dev) | Reminders, SMS/email sends, webhook processing, nightly reports, retries with no infra to run. |
| SMS | **Twilio** | Confirmations, reminders, two-way "reply C to confirm". |
| Email | **Resend** + React Email | Transactional email with templated components. |
| File storage | **S3-compatible** (Cloudflare R2 or DO Spaces) | Logos, client photos, consent forms. |
| Cache / rate limit | **Upstash Redis** (or DO Managed Redis) | Availability-slot cache, rate limiting on public booking endpoints. |
| Hosting | **Vercel + Neon Postgres** (fastest) or **DigitalOcean App Platform + Managed Postgres** (cheaper at scale, you already use DO) | Either works; the app is a standard Node/Next deploy. |
| Observability | Sentry + PostHog | Errors and product analytics. |
| Testing | Vitest + Playwright | Unit for scheduling/pricing logic, E2E for booking and checkout flows. |
| Mobile (Phase 5) | **Expo (React Native)** | Shares TypeScript types and API client. Needed for Tap to Pay on iPhone via Stripe Terminal SDK. |

**Why not Rails / Django / Laravel?** They'd be fine for the CRUD parts, but you'd end up
with two languages once the mobile app and rich calendar UI arrive. A single TypeScript
codebase with shared types is the lowest-friction path for a small team.

**Why not a DB-per-tenant?** Operationally heavy (migrations × N, connection pooling,
backups). Shared schema + `tenant_id` on every row + Postgres RLS gives strong isolation
with one database. Revisit only if a huge enterprise customer demands physical isolation.

---

## 3. Feature set (what beats Vagaro)

**Core (v1)**
- Calendar: day/week/staff views, drag-to-reschedule, color by service category, buffers.
- Appointments: single/multi-service, multi-staff, recurring, waitlist, notes, status flow
  (booked → confirmed → checked-in → in-progress → completed / no-show / cancelled).
- Clients: profile, history, notes (private vs shareable), formulas, allergies, tags,
  saved cards (on the business's Stripe account), consent forms.
- Services: categories, duration, price, per-staff overrides (price/duration), add-ons,
  processing time (e.g. color develop) so staff can book another client in the gap.
- Staff: schedules (weekly template + overrides), time off, services they perform,
  commission rules, permissions (owner / manager / provider / front desk).
- Online booking page: `book.yourdomain.com/{business-slug}` or custom domain; service →
  staff → time → deposit/card-on-file → confirm. Mobile-first.
- Checkout / POS: services + products + tips (card tips split by provider), discounts,
  gift cards, packages, memberships; card present (Terminal), card on file, cash, split.
- Notifications: confirmation, reminder (24h / 2h), "running late", review request.
- Reports: sales by staff/service/day, tips, product sales, payroll export
  (commission per provider, product sale %, cash vs card tips, CC-tip fee, 1099 vs W-2).

**Differentiators**
- Payroll built in, in the format you actually use (per-provider commission sheets).
- Clean UI: one calendar screen does 90% of the day; settings out of the way.
- Real client timeline (every visit, note, formula, payment in one scroll).
- Fast search (⌘K) for clients/appointments.
- Flexible deposits / no-show policies per service.
- Multi-location under one business with shared clients.

---

## 4. Architecture

```
┌──────────────┐   ┌─────────────────────┐   ┌──────────────┐
│ Staff web app│   │ Public booking pages│   │ Mobile (P5)  │
│ app.domain   │   │ book.domain/{slug}  │   │ Expo         │
└──────┬───────┘   └──────────┬──────────┘   └──────┬───────┘
       └──────────────┬───────┴───────────────────┬─┘
                      ▼                           ▼
            Next.js (server actions + route handlers)      ◄── Stripe webhooks
                      │                                    ◄── Twilio webhooks
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
   Postgres (RLS)   Redis       Inngest (jobs)
                                   │
                                   ├─► Twilio (SMS)
                                   ├─► Resend (email)
                                   └─► Stripe (off-session charges, reports)
```

### 4.1 Tenancy model
- `businesses` is the tenant table. Every tenant-owned table has `business_id NOT NULL`.
- Users belong to businesses via `memberships (user_id, business_id, role)`. A user can
  belong to multiple businesses (e.g. a stylist renting at two salons).
- Tenant context is derived **server-side only** from the session + membership, never
  from a client-supplied id. The public booking page resolves tenant from the URL slug.
- Postgres RLS on every tenant table:
  ```sql
  ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON appointments
    USING (business_id = current_setting('app.business_id')::uuid);
  ```
  Each request runs `SET LOCAL app.business_id = '<id>'` inside its transaction. The app
  connects as a non-superuser role so RLS can't be bypassed accidentally.
- Composite indexes always lead with `business_id`.

### 4.2 Stripe Connect design (each business = its own Stripe account)

**Account type: Standard connected accounts.**
- Business signs up / links via Stripe-hosted onboarding (Account Links, `type: standard`).
  They keep full access to their own Stripe dashboard, payouts, and tax forms.
- Stripe, not the platform, holds the liability for disputes/refunds on Standard accounts.
- Store `businesses.stripe_account_id`, `stripe_charges_enabled`, `stripe_details_submitted`.

**Charging: direct charges on the connected account.**
```ts
await stripe.paymentIntents.create(
  { amount, currency: 'usd', customer, payment_method, application_fee_amount },
  { stripeAccount: business.stripeAccountId }
);
```
- Money goes straight to the business. `application_fee_amount` is optional if you want
  a per-transaction platform fee; otherwise charge a SaaS subscription instead (§4.3).
- **Stripe Customers and saved PaymentMethods live on the connected account**, not the
  platform. Store `clients.stripe_customer_id` scoped to that business.
- Card on file at booking: create a `SetupIntent` on the connected account; charge later
  `off_session: true` for no-show/late-cancel fees.
- Deposits: PaymentIntent at booking; remainder at checkout (or `capture_method: manual`
  for pre-authorizations within the 7-day window).
- In-person: Stripe Terminal (readers) and Tap to Pay (mobile, Phase 5), both on the
  connected account.
- Tips: collected in the same PaymentIntent, recorded per provider in your DB for payroll.
- Refunds: `stripe.refunds.create({payment_intent}, {stripeAccount})`.

**Webhooks**
- One **Connect** webhook endpoint on the platform. Every event includes `account`
  (the connected account id) → look up the business → process under that tenant.
- Handle: `account.updated`, `payment_intent.succeeded/failed`, `charge.refunded`,
  `charge.dispute.created`, `setup_intent.succeeded`, `terminal.reader.*`.
- Idempotency: store `stripe_event_id` in a `webhook_events` table; process via Inngest
  so retries are safe.

**Account removal**: businesses can disconnect; you just drop the account id. Their Stripe
account and history remain theirs.

### 4.3 Billing the businesses (platform revenue)
Separate from Connect. Use Stripe Billing on the **platform's own** Stripe account:
`businesses.stripe_customer_id_platform`, a subscription per business (tiers by staff
count), trial period, dunning. Gate features by `businesses.plan`.

### 4.4 Scheduling engine
- Store all times as `timestamptz`; each business/location has an IANA timezone.
- `appointments` has `time_range tstzrange` with an **exclusion constraint** per staff
  member so two bookings can never overlap at the DB level:
  ```sql
  ALTER TABLE appointment_items ADD CONSTRAINT no_double_booking
    EXCLUDE USING gist (staff_id WITH =, time_range WITH &&)
    WHERE (status NOT IN ('cancelled','no_show'));
  ```
- Availability = staff weekly schedule + date overrides − time off − existing items −
  buffers, snapped to the business's slot interval (e.g. 15 min). Computed in a pure,
  heavily unit-tested TypeScript module; cached in Redis per (staff, day) and invalidated
  on any write.
- Processing/gap time: a service can be `[active 30m][gap 30m][active 15m]`; the gap is
  bookable by another client for that staff member.

### 4.5 Core data model (abridged)
```
businesses(id, name, slug, timezone, currency, stripe_account_id, plan, ...)
locations(id, business_id, name, address, timezone)
users(id, email, name, ...)                         -- global identity
memberships(user_id, business_id, role)
staff(id, business_id, user_id?, display_name, color, commission_rule_id, active)
staff_schedules(staff_id, location_id, weekday, start, end)
staff_schedule_overrides(staff_id, date, start?, end?, is_off)
service_categories(id, business_id, name, sort)
services(id, business_id, category_id, name, duration_min, gap_min, price_cents, deposit_cents, ...)
staff_services(staff_id, service_id, price_override, duration_override)
clients(id, business_id, first, last, phone, email, notes, stripe_customer_id, tags[])
client_notes(id, client_id, author_id, body, visibility)
appointments(id, business_id, location_id, client_id, status, source, created_by, notes)
appointment_items(id, appointment_id, staff_id, service_id, time_range tstzrange, price_cents)
products(id, business_id, name, price_cents, sku)
sales(id, business_id, appointment_id?, client_id, subtotal, tax, tip, discount, total, status)
sale_lines(sale_id, kind service|product|gift_card|package, ref_id, staff_id, amount, tip_amount)
payments(id, sale_id, method card|cash|gift_card|other, amount, stripe_payment_intent_id, status)
gift_cards(id, business_id, code, balance_cents) ; packages ; memberships
commission_rules(id, business_id, service_pct, product_pct, cc_tip_fee_pct, pay_type 1099|w2)
notifications(id, business_id, client_id, channel, template, scheduled_at, sent_at, status)
webhook_events(id, provider, external_id UNIQUE, payload, processed_at)
audit_log(id, business_id, actor_id, action, entity, entity_id, diff, at)
```

### 4.6 Permissions
Roles: `owner`, `manager`, `provider`, `front_desk`. Providers see only their own
calendar and clients' service-relevant info by default (configurable). Enforced in a
single `can(user, action, resource)` helper used by every server action.

---

## 5. Delivery phases

**Phase 0 — Foundations (1–2 wks)**
Monorepo (`apps/web`, `packages/db`, `packages/core`), Postgres + Drizzle + RLS, auth +
organizations, business creation/onboarding, CI, staging + prod environments.

**Phase 1 — Calendar & appointments (3–4 wks)**
Staff, schedules, services, clients, appointment CRUD, calendar UI, availability engine
with tests, exclusion constraints, audit log. *Usable internally as a Vagaro replacement for
scheduling only.*

**Phase 2 — Payments & checkout (3 wks)**
Stripe Connect onboarding, direct charges, card on file, tips, cash, gift cards,
discounts, refunds, receipts, Connect webhooks, Stripe Terminal reader support.

**Phase 3 — Online booking & notifications (2–3 wks)**
Public booking pages, deposits/no-show policy, SMS/email confirmations and reminders,
two-way confirm, cancellation links, waitlist.

**Phase 4 — Reports & payroll (2 wks)**
Sales reports, tips, product sales, commission rules, per-provider payroll sheets
(1099 commission and W-2 hourly/salary formats), CSV/PDF export.

**Phase 5 — Mobile + polish**
Expo app (calendar, checkout, Tap to Pay), memberships/packages, multi-location,
custom domains, marketing (campaigns, review requests), data import from Vagaro CSV.

---

## 6. Key risks and mitigations
- **Tenant data leak** → RLS + non-superuser DB role + integration tests that assert
  cross-tenant queries return zero rows.
- **Double booking under concurrency** → DB exclusion constraint, not just app logic.
- **Stripe webhook ordering/duplication** → idempotent handlers keyed on event id.
- **Timezone bugs** → store UTC, convert at the edge, test DST transitions explicitly.
- **Migrating off Vagaro** → build a CSV importer (clients, services, future appointments)
  in Phase 5, and run both systems in parallel for two weeks.

---

## 7. Decisions to make before Phase 0
1. Hosting: Vercel+Neon (fastest) vs DigitalOcean (you already have an account).
2. Auth: Clerk (hosted, fastest) vs Better Auth (own your user table).
3. Platform revenue model: SaaS subscription only, per-transaction application fee, or both.
4. Product name / domain (affects booking-page URL scheme).

---

## 8. Status (updated 2026-10-05)

**Done — Phase 0 and Phase 1**
- pnpm monorepo: `apps/web` (Next.js 16), `packages/core` (pure logic, 15 unit tests), `packages/db` (Drizzle, 5 DB integration tests).
- Postgres schema with forced Row-Level Security on every tenant table, a dedicated
  non-superuser app role, and a deferrable GiST exclusion constraint preventing double
  booking. Isolation and conflict behaviour are covered by `packages/db` integration tests
  that run as the app role.
- Better Auth with email/password, organizations and custom roles (owner, manager,
  provider, front desk). Organization = tenant. Creating a business also creates its
  default location, the owner's staff row and hours. Invitations produce a shareable link
  (no email provider yet); accepting one links the invitee to their staff row.
- Calendar: day view (columns per staff) and week view (columns per day, optional staff
  filter), drag-to-reschedule across time and staff with DB-enforced conflict rejection,
  click-through to the appointment page.
- Appointment page: status flow, cancellation with reason, notes, add a second service
  (slots after the current booking listed first), move a service to another time/staff,
  remove a service. Processing-time services stay as active + finish segments.
- Staff: weekly hours, service assignment, days off / custom hours per date, invitations.
- Services, clients with search, business settings, activity (audit) log viewer.

**Done — Phase 2: payments (2026-10-06)**
- Stripe Connect with **Standard** accounts: Settings → Payments starts hosted onboarding,
  stores the account id and syncs `charges_enabled` / `details_submitted` on return and via
  the `account.updated` webhook. Each business is paid directly on its own account.
- One Connect webhook endpoint (`/api/stripe/webhook`) with signature verification and an
  idempotent `webhook_events` ledger; handles payment succeeded/failed and account updates.
- Checkout: an appointment opens a numbered sale seeded with its services; add retail
  products (taxable, with staff credit), $/% discounts, per-provider tips or a ticket tip
  split by service revenue, sales tax on taxable lines; split payments until the balance is
  zero. Paying in full marks the appointment completed.
- Payment methods: cash / other; new card via Stripe Payment Element scoped to the
  connected account (optionally saved to the client's Stripe Customer on that account);
  saved card charged off-session. Optional platform fee via `PLATFORM_FEE_BPS`.
- Refunds (full or partial, Stripe or cash), void, printable receipt, and a Sales report
  (by staff, by payment method, closed sales) for any date range.
- Pure pricing math in `packages/core/pricing.ts` with unit tests (totals, proportional
  discount before tax, tip allocation, money parsing).

**Verified locally without Stripe keys:** product → checkout → discount → tip → two cash
payments → paid, appointment completed, report totals correct. Stripe paths are implemented
and typechecked but need real test keys to exercise (see `.env.example`).

**Done — Phase 3: online booking & notifications (2026-10-06)**
- Public booking page at `/book/[slug]`: service → provider (or "any") → month calendar
  showing only days with openings → time → details → confirmed page with a manage link.
  Enforces the business's minimum notice and max-advance window, re-validates the slot at
  submit, and matches or creates the client by phone/email. Waitlist sign-up when a day is full.
- Client self-service at `/book/[slug]/manage/[token]` (unguessable token per appointment):
  reschedule to another open time or cancel, allowed until the cancellation window closes.
- Notifications: confirmation, rescheduled, cancellation and reminder messages by email
  (Resend) and SMS (Twilio) via plain fetch; opt-in respected; reminders scheduled N hours
  before and re-queued on reschedule / cancelled on cancellation. Immediate sends run after
  the response via `after()`; due reminders are delivered by `POST /api/jobs/notifications`
  guarded by `JOBS_SECRET` (call it from any scheduler). Without provider keys, messages are
  recorded as "skipped" and visible under Settings → Messages.
- Staff invitations are emailed when email is configured; the link is still shown in the UI.
- Settings → Online booking: toggle, notice/advance/cancellation windows, reminder hours,
  no-show fee, address, policy text, and the booking link. Waitlist page for staff.
- No-show fee: charge a saved card from the appointment page (needs Stripe).

**Verified locally without provider keys:** book online as a new client → confirmation page →
reschedule → cancel; notification rows, reminder scheduling/cancellation and audit entries
all correct; job endpoint rejects bad auth and processes due rows.

**Done — Phase 4: reports & payroll (2026-10-06)**
- Pay rules per staff member (Staff → Pay): position, pay type (commission 1099 / hourly W-2 /
  salary W-2), main-service %, product/package % (default 5), card-tip fee % (default 3),
  hourly rate, salary per period, overtime override, optional withholding ($ or %).
- Time clock: staff clock in/out on their own row; managers add or remove hours manually;
  per-period totals. Hours feed hourly pay with optional 1.5× overtime over 40h per workweek.
- Payroll page for any period: summary table (Employee, Position, Pay type, Rate,
  Commission, Wage, Cash tip, Card tip, Card-tip fee, Total, Service revenue, Service
  profit), per-employee breakdown with the full transaction list, adjustments
  (training pay, transfers), finalize (frozen snapshot per period), and downloads:
  the full workbook (Summary tab + one tab per employee in the salon's commission or simple
  layout) and the accountant's W-2 summary (hourly/salary only, no performance columns).
- Math lives in `packages/core/payroll.ts`, unit-tested against the salon's own validated
  examples (Raina's Total 1099, Maria's and Dasia's Total Check) to the cent. Lines are
  credited to the appointment date (so deposits land in the right period), discounts and
  tax are allocated per line, tips are split cash/card by how the sale was paid, fully
  refunded sales are listed but not paid, partial refunds reduce goods proportionally.
- Sales report gained top services/products and appointment counts by status (no-show rate,
  online share).

**Verified locally:** pay rules saved, hours added and clock in/out, payroll for Oct 1–6
reconciles exactly with sale #1001 (discount, tax, partial refund, cash tip), adjustment
added, period finalized, workbook generated with Summary + per-employee tabs.

**Done — Phase 5 (2026-10-06)**
- **Vagaro import** (Settings → Import): upload CSV or Excel exports (title rows above the
  header are detected), auto-mapped columns with a preview you can correct, then import
  services (existing names skipped), clients (matched by phone/email, then name; updated not
  duplicated; phones normalised to E.164), and appointments (staff matched by name, unknown
  services created as hidden placeholders, exact duplicates skipped, overlaps with existing
  bookings reported row by row). Each run is logged with counts and errors.
- **Gift cards, packages, memberships** (Packages & gifts page): define packages (N sessions
  of a service, optional expiry) and monthly membership plans (included sessions and/or a
  discount); issue gift cards. At checkout: sell any of them as a line (fulfilled when the
  sale is paid: code issued, sessions credited, membership started or renewed), redeem a gift
  card as a payment method, and cover a service line with a package session or membership
  credit. Automatic monthly card billing for memberships is deferred to Stripe subscriptions.
- **Multi-location**: locations CRUD with a default, primary location per staff member,
  location filter on the calendar, location step on the public booking page, appointments
  tagged with the staff member's location.
- **Custom booking domain**: set a hostname under Settings → Locations & domain; the proxy
  rewrites requests on that host to the business's booking page (DNS/SSL steps shown).
- **Mobile**: `apps/mobile` Expo app (Expo Router, Better Auth Expo client with secure token
  storage) with sign-in, today's agenda per business with day navigation, and an appointment
  screen with status changes, backed by `/api/mobile/*` routes on the web app (bearer auth).
  Typechecks; not yet run on a device in this session.

**Verified locally:** services/clients/appointments imports from sample Vagaro-style files
(including a deliberate overlap and a duplicate re-run), package and gift card creation,
a checkout selling a package and paying with the gift card plus cash, locations and import
pages rendering.

**Deferred**
- Stripe subscriptions for membership auto-billing; Tap to Pay in the mobile app
  (`@stripe/stripe-terminal-react-native`); push notifications; Inngest for durable jobs.
- Running the Expo app on a simulator and a device; App Store / Play builds via EAS.

**Polish pass (2026-10-06)** — after the user asked for the app to feel legitimate:
- Design system: logo mark + wordmark, favicon, Inter, Lucide icons, grouped sidebar with a
  user menu, page titles, 404 and loading skeletons.
- Feedback: validated forms with field errors and pending buttons, confirm dialogs on every
  destructive action, flash toasts after server actions.
- Consistency: shared formatters and status badges, human durations, empty states with a
  next action; separate pages for every create flow, categories, staff tabs, client detail.
- Calendar: now-line, quarter-hour guides, one card per service with hatched processing gap,
  month view, phone agenda view.
- Booking page: business profile (logo, cover, brand colour, about, hours, links), Open Graph
  tags for link previews, add-to-calendar (Google + .ics), branded emails.
- Account & security: email verification, password reset, change password, 2FA (TOTP with
  backup codes), signed-in devices with revoke.
- Data: sortable paginated client table with last visit / spend / no-shows, CSV exports for
  clients, sales and appointments, paginated audit log.
- Operations: GitHub Actions CI (typecheck, tests against Postgres, build, Playwright smoke),
  rate limits on auth/booking/API POSTs, security headers, webhook error reporting hook,
  backup script, ops notes in docs-ops.md.

**Deferred polish****Deferred polish**
- Email delivery (Resend) for invitations and, in Phase 3, client notifications.
- Mobile layout pass on the calendar; keyboard accessibility for drag-to-reschedule.
