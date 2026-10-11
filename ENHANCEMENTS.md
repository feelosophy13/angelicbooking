# Enhancements

Evaluation of every app feature, UI flow and page as of 2026-10-10 (working tree including the uncommitted forms
work). Produced from a code read of `apps/web/src` plus a browser walkthrough of the owner app and booking page on
desktop and phone widths. Items the app already does were checked and left out. Paths are relative to
`apps/web/src/` unless noted.

Priority: **P1** loses money/data, exposes data, or blocks daily front-desk work · **P2** Vagaro-parity gap the desk
hits in the first week · **P3** polish. Tags: [bug] [gap] [ux] [perf] [a11y] [security].

Track delivery in `TODO.md`; this file is the source list. ✅ marks items that have landed.

## Top priorities across the app

1. ✅ **P1 Lock down uploaded files** — `/api/files/[id]` serves intake attachments and signature PNGs to anyone with the
   id, with `Cache-Control: public, immutable`. Gate `kind in (form, signature)` behind a tenant session or signed URL.
2. ✅ **P1 Money-moving correctness at checkout** — refunds don't restock, revoke loyalty points, promo uses, issued gift
   cards/packages or restore gift-card balances; deleting a credit-covered line loses the package session; expired
   packages/memberships can still be redeemed; two same-amount gift cards on one sale issue one; percent discounts
   freeze to dollars; promos discount ineligible lines; package-covered services pay $0 commission.
3. ✅ **P1 Reminders after cancellation** — removing the last service and cancelling a series skip `notifyAppointment`,
   and `deliverDue` never re-checks appointment status, so clients get texts for cancelled visits.
4. ✅ **P1 Front-desk booking** — single service per booking, a 500-row client `<select>` with no search or inline
   create, no walk-in "now"/custom time, no Rebook button, no block time from the calendar.
5. ✅ **P1 Calendar grid** — no working hours/time-off shading, concurrent cards fully overlap, drag bypasses every
   availability rule, quick actions are hover-only (unreachable on the front-desk iPad), touch drag hijacks scrolling.
6. ✅ **P1 Auth/permissions** — open redirect via `?next=`, system-role edits never sync to Better Auth org roles,
   permission errors render as "Something went wrong" in production, client pages don't enforce `clients.read`.
7. ✅ **P1 Public booking dead ends** — waitlist is unreachable (empty days aren't clickable), provider step lists staff
   who can't do the service, promo codes are validated only after the deposit is charged, month availability runs
   hundreds of queries per render.
8. ✅ **P1 Import staging on `os.tmpdir()`** breaks on Render (ephemeral disk, restarts).
9. ✅ **P2 Findability** — no Sales list page, gift cards capped at 50 with no search, products/memberships/reviews
   unsearchable, ⌘K misses sales, gift cards, products and most settings pages.
10. ✅ **P2 Staff schedules** — one block per day (no lunch/split shift), time off one date at a time, no rotations.
11. **P2 Notifications** — failed sends never retried and no "send again", one reminder only (PLAN promises 24h + 2h),
    no staff notification preferences, no SMS segment counter.
12. **P2 Client record ergonomics** — search misses "Jane Doe" and formatted phones, no duplicate warning or merge,
    saved cards fetched but never shown, history shows only the first service of a visit, no alerts strip.
13. **P2 Forms before rollout** — "is not ticked" conditions never show on first load, blank signatures get stored,
    required forms aren't enforced at check-in/checkout, no public/blank form link.
14. **P2 Membership lifecycle** — failed-renewal state is a dead end, plan price edits never reach Stripe, re-selling
    to a paused member creates a duplicate.
15. ✅ **P3 Setup checklist** can never finish for a solo salon or one without a Vagaro export and cannot be dismissed; on
    desktop it fills the calendar viewport and on a phone pushes the day grid off-screen entirely.

## 1. Calendar home (`app/app/[slug]/page.tsx`, `calendar-grid.tsx`, `month-grid.tsx`, `today-strip.tsx`)

- ✅ **P1 Render working hours, time off and closed hours on the grid** [gap] — grid is hard-coded 7:00–21:00
  (`calendar-grid.tsx:26-27`) and receives no schedules; bookings outside that range are clipped off-grid.
- ✅ **P1 Lane layout for concurrent cards** [bug] — cards are `absolute inset-x-1` by time only
  (`calendar-grid.tsx:280-281`); week view "All staff" stacks every provider into one column and overlaps hide cards.
- ✅ **P1 Validate drag-to-reschedule** [bug] — `actions.ts:27-54` → `server/booking.ts:186-238` checks only that the
  staff is active; a drag can land in the past, off-hours, on a day off or on an unqualified provider. Validate like the
  Move panel, or make it an explicit override with a confirm, and show why a drop was rejected.
- ✅ **P1 Quick actions reachable on touch and keyboard** [a11y][bug] — Check in/Complete are `hidden group-hover:flex`
  (`calendar-grid.tsx:289`). Show on `focus-within` and always on coarse pointers; add Confirm, Start, No-show.
- ✅ **P1 Touch drag hijacks scrolling on iPad** [bug] — `onPointerDown` calls `preventDefault()` for every pointer type
  (`calendar-grid.tsx:170-177`); require long-press for `pointerType === "touch"`.
- ✅ **P1 Block time from the calendar** [gap] — only whole-day time off exists (`staff/[staffId]/time-off`); no lunch,
  late start or "do not book" blocks, and blocks aren't drawn as cards.
- ✅ **P2 Staff filter leaks into day view** [bug] — `staff=` applies in every view (`page.tsx:58,82`) but the select only
  renders in week view; the Day/Week/Month toggle drops `staff`, `location` and `forms` params (`page.tsx:126-128`).
- **P2 "Complete" without a sale** [ux] — calendar ✓ and the detail-page Completed button only set status; the today
  strip counts them as checked out (`page.tsx:170`). Make ✓ open checkout or label it "Done, no charge".
- **P2 Card indicators** [gap] — only "forms due" is shown (`page.tsx:91`); add new client, notes, deposit/card on
  file, booked online, standing series, requested staff.
- **P2 Hide columns for providers not working that day** [ux] — `server/agenda.ts:30` returns all active staff.
- **P2 Resize card to change duration** [gap] — running long means Remove + Add on the detail page.
- **P2 Auto-refresh the calendar** [gap] — no polling/SSE; the desk won't see online bookings or a colleague's check-in
  until they navigate (`calendar-grid.tsx:76` only ticks the now-line).
- **P2 Keyboard shortcuts** [gap] — only ⌘K (`components/command-palette.tsx`); add N new, T today, ←/→ day, D/W/M.
- **P3 "Show cancelled" toggle** [ux] — cancelled cards stay on day/week (`calendar-grid.tsx:38`).
- ✅ **P3 "Expected" revenue includes no-shows** [bug] — `page.tsx:162` filters only `cancelled`.
- **P3 Week staff filter needs a Go button** [polish] — `page.tsx:134-144`; navigate on change like location pills.
- **P3 Month → day links drop location, causing a redirect flicker** [polish] — `month-grid.tsx:30,41`,
  `location-pills.tsx:24`.
- **P3 Silent quickStatus failures and no optimistic drag** [polish] — results ignored at `calendar-grid.tsx:298,314`;
  `useOptimistic` is unused anywhere.
- **P3 Week starts Monday** [polish] — `page.tsx:26`, `month-grid.tsx:12,19`; make it a business setting (US default
  Sunday).
- ✅ **P3 Setup checklist** [polish] — not dismissible/collapsible (`setup-checklist.tsx`); "Add your team" needs >1
  staff and "Import clients" needs >3 clients so solo salons never clear it; runs 5 count queries per calendar load
  (`page.tsx:100-116`).
- **P3 Dead `NextUp` type** in `today-strip.tsx:5`.

## 2. New appointment (`app/app/[slug]/appointments/new/*`)

- ✅ **P1 Multi-service booking** [gap] — one `serviceId` per booking; cut + colour takes three page loads.
- ✅ **P1 Client typeahead with inline "New client"** [bug] — native select `limit(500)` (`page.tsx:38`; same in
  `classes/[sessionId]/page.tsx:31`): clients past #500 can never be booked, and a new walk-in requires leaving the form.
- ✅ **P1 Walk-in now / custom time / outside hours / deliberate double-book** [gap] — `notBefore: new Date()`
  (`page.tsx:55`) hides a walk-in that started five minutes ago; the DB already supports `allowOverlap`.
- **P2 Auto-refresh slots on change** [ux] — GET form requires "Find times" after every change (`page.tsx:65-98`);
  when `time=` from the calendar isn't open, `preselectIso` is silently null (`page.tsx:117`).
- **P2 Price/duration override, "any available", requested-by-client flag** [gap] — `server/booking.ts:23-24`.
- **P2 Series uses business timezone, not the location's** [bug] — `actions.ts:34,69`; later occurrences shift.
- **P2 Series editing** [ux] — clashes are only listed in a flash (`actions.ts:50-51`); `server/series.ts` has
  create/cancel only, no "this and following".
- **P3 Service list ignores the chosen staff; staff list ignores the day** [polish] — `page.tsx:37,44-45`.

## 3. Appointment detail (`app/app/[slug]/appointments/[id]/*`)

- ✅ **P1 Reminders still send after some cancellations** [bug] — only `notifyAppointment(..., "cancellation")` cancels
  queued reminders (`lib/notify/index.ts:78-82`); `removeService` on the last item (`server/booking.ts:287-291`,
  `actions.ts:96-102`) and `cancelSeriesFrom` (`actions.ts:177`, `series.ts:114`) bypass it, and `deliverDue`
  (`lib/notify/index.ts:280`) never re-checks status. The comment at `actions.ts:176` is wrong.
- ✅ **P1 Rebook button** [gap] — prefill client, service, staff, date + N weeks; also on the sale page.
- **P2 Attach a walk-in to a client afterwards** [gap] — no action sets `clientId`.
- **P2 Status buttons allow regressions and can crash** [bug] — `page.tsx:259-268` offers Confirmed on a no-show/paid
  visit; re-activating items can hit the exclusion constraint outside `translate`, surfacing the generic error page.
- **P2 Undo cancel / no-show** [gap] — a mis-click is permanent.
- ✅ **P2 Add/Move service ignores location and qualifications** [bug] — `page.tsx:88-96,108-116` omit `locationId`;
  staff selects (`page.tsx:176,204`) list everyone; `insertServiceItems` doesn't check `staffServices`.
- **P2 Sticky action bar on mobile** [ux] — Checkout/status/no-show fee sit below services, Move, Add, Notes.
- **P2 Client context on the ticket** [gap] — visit count, last visit, no-show/late-cancel count, balances, saved
  card; `pinnedNotes` query (`page.tsx:59`) isn't limited to pinned.
- **P2 Edit price/discount/duration before checkout** [gap].
- **P3 Notes form feedback; detail fetched twice in `generateMetadata`** [polish] — `page.tsx:37-43,227-232`.
- **P3 "Add a service" select renders one character wide** [ux] — seen in the walkthrough at desktop width.

## 4. Waitlist, classes, time clock

- ✅ **P1 Waitlist hides today's entries every evening** [bug] — UTC date compare in `server/public-booking.ts:283`.
- **P2 Staff can add to the waitlist** [gap] — public-booking only (`waitlist/page.tsx:19`).
- **P2 Waitlist "Book" closes the loop** [ux] — auto-mark booked, pass `staffId` (`public-booking.ts:277`), "text
  them the opening", match against cancellations.
- **P3 Waitlist filters and lifecycle** [polish] — no staff/location filter; stale entries never close.
- **P2 Recurring class sessions** [gap] — `createSession` has no repeat.
- **P2 Edit/move a class session** [gap] — `server/classes.ts` is create/enrol/cancel; cards locked from drag
  (`calendar-grid.tsx:29`); `rescheduleService` refuses seats (`booking.ts:200`).
- **P2 Class location/timezone** [bug] — `classes.ts:103` stores the instructor's primary site, not the weekday
  site; classes pages use `business.timezone`.
- **P3 Roster bulk actions** [gap] — no per-seat no-show, check-in-all, bulk checkout (`[sessionId]/page.tsx:55-62`).
- ✅ **P1 Forgotten clock-outs** [bug] — open entries persist; next punch closes with full elapsed time
  (`server/time-clock.ts:78-81`, `time/actions.ts:26-28`). Add max-shift auto-close and manager edits.
- **P2 Time clock management** [gap] — no entry editing, per-staff filter, pay-period presets, "who's in" board
  (`time/page.tsx:61-66`).
- **P2 Kiosk shows the action before committing** [ux] — one "Go" toggles blindly (`clock/[token]/kiosk.tsx:47`);
  10 POST/min per IP (`proxy.ts:22`) is shared by the whole salon tablet.
- **P3 App clock-in records no location; PIN hash is unsalted sha256** [security] — `time/actions.ts:31`,
  `time-clock.ts:15-17,83`; use scrypt/bcrypt or a per-staff salt.

## 5. Clients (`app/app/[slug]/clients/*`, `server/clients.ts`)

- ✅ **P1 Enforce `clients.read` on list and detail** [bug][security] — both use `requireBusiness` only
  (`clients/page.tsx:25`, `[clientId]/page.tsx:40`) while search and CSV gate on it.
- ✅ **P1 Search by full name and formatted phone** [bug] — `ilike` per column (`server/clients.ts:12-14`); "Jane Doe"
  and "555-123" match nothing. Add `pg_trgm` indexes; the ⌘K search also seq-scans all columns per keystroke
  (`search/route.ts:28`).
- **P2 Duplicate warning on create and a merge tool** [gap] — `createClient` inserts blindly (`actions.ts:25-37`)
  though `server/import.ts:63` already has `findClient`; no `mergeClient` anywhere (9.5k imported records).
- **P2 Cards on file section** [gap] — `savedCards` (`[clientId]/page.tsx:80`) only feeds the auto-renew select.
- **P2 Alerts strip under the header** [ux] — allergies/pinned note, no-show count, owes money, opted out.
- **P2 History shows only the first service per visit** [bug] — joins `sortOrder = 0` (`page.tsx:48-55`, also
  `listClients`); show all items and the sale total, plus per-visit notes/formulas inline.
- **P2 Membership payment-failed dead end** [bug] — paused with `autoRenew` still true; UI says "turn auto-renew on
  again" but `enableAutoRenew` requires active (`page.tsx:276-290`, `server/membership-billing.ts:30,119`).
- **P2 Manual package/membership adjustments** [gap] — add a session, extend expiry, pause/resume, transfer.
- **P2 List filters** [gap] — tags, no visit in N months, birthday month, opted-out, has balance; `clients.tags` is
  only settable by import.
- **P2 Edit notes** [ux] — only add/pin/delete (`notes-actions.ts`).
- **P3 Outstanding balance / open sales summary** [gap].
- **P3 Opt-in defaults** [polish] — `createClient` hard-codes `smsOptIn: true, emailOptIn: true` (`actions.ts:31`)
  with no checkbox.
- **P3 New-client fields** [gap] — tags, referral source, home location.
- **P3 Expired packages vanish, used-up ones linger** [polish] — `page.tsx:61`.
- **P3 Referrer name, `reviewOptOut` visibility, editable home location** [polish] — `page.tsx:223`.
- **P3 Thread shows SMS only; inbound not marked read** [ux] — `server/inbound.ts:39`.
- **P3 Mobile layout** [ux] — contact details land several screens down; add a compact header summary and tabs.
  Clients list is a five-column table with a fixed `w-64` search (`clients/page.tsx:44,56`); stack rows below `sm`.
- **P3 Archive/delete client, photo, documents** [gap] — `files`/`storeImage` already exist.

## 6. Forms (`app/app/[slug]/settings/forms/*`, `forms/fill/*`, `components/form-fill.tsx`, `server/forms.ts`)

- ✅ **P1 Public file serving** — see top priority 1 (`app/api/files/[id]/route.ts:5-18`).
- ✅ **P1 "Is not ticked" conditions never show on first load** [bug] — `fieldVisible` compares booleans only when the
  value is boolean; unanswered checkboxes are `undefined` (`lib/forms-logic.ts:4-11`), so the dependent stays hidden
  and the server then rejects it as required. Treat `undefined` as `false`; add a test for `equals: "false"`.
- ✅ **P1 Blank signatures stored** [bug] — `pointerleave` sets `dataUrl` even with no strokes
  (`components/form-fill.tsx:142-146,163`); `storeSignaturePng` only rejects <200 bytes (`lib/files.ts:49-56`).
- ✅ **P1 Enforce required forms** [gap] — `appointmentsMissingForms` only badges; prompt at check-in and `startCheckout`
  ("2 forms outstanding: complete here / skip"); online booking never asks.
- **P2 Public/blank form link** [gap] — forms exist only behind an appointment token or the staff fill page.
- **P2 Chained conditions diverge client/server** [bug] — hidden driver keeps stale state (`form-fill.tsx:26-36`,
  `server/forms.ts:114`); clear answers when a field hides.
- **P2 Signature pad breaks on rotation** [bug] — canvas sized once in `useEffect([])` (`form-fill.tsx:110-122`).
- **P2 Submissions inbox** [gap] — only 20 most recent per form (`[formId]/page.tsx:31`) and per client.
- **P2 Per-field errors; keep the picked file on error** [ux]; **auto-advance to the next due form** after save
  (`forms/fill/[formId]/page.tsx:37-38`).
- **P2 CSV export uses current fields, not snapshots; file answers export as UUIDs; UTC timestamps** [bug] —
  `server/forms.ts:268-296`.
- **P3 Options textarea is uncontrolled** [bug] — `builder.tsx:57` loses typed options on type switch.
- **P3 Warn when moving/removing a driver drops conditions** [ux] — `server/forms.ts:344-349`.
- **P3 Silent 50-question cap** [polish] — `server/forms.ts:332`.
- **P3 Form list counts/preview/duplicate/templates** [ux]; **void/reassign/email a submission** [gap];
  **"Checkbox (must tick)" label vs Required toggle** [polish]; **validate reused `_keep` file ids belong to the
  tenant** [polish] (`server/forms.ts:86-87,129`); **drawn-signature-required toggle** [polish].

## 7. Memberships, packages, gift cards, loyalty, reviews

- ✅ **P1 Expired packages / lapsed memberships can still be redeemed** [bug] — `redeemCredit` doesn't recheck
  `expiresAt`/`currentPeriodEnd` (`server/offers.ts:133-144`).
- ✅ **P1 Removing or voiding a credited line doesn't return the session** [bug] — `server/sales.ts:211-219`; no
  "un-apply credit" either.
- ✅ **P1 Gift-card refund doesn't restore balance; refund doesn't revoke sold packages/memberships** [bug] —
  `server/sales.ts:505-555` reverses loyalty only.
- ✅ **P1 Two same-amount gift cards (or packages) on one sale fulfil one** [bug] — idempotency key is
  `(saleId, initialCents)` (`offers.ts:81,86`); key on the line id.
- ✅ **P1 Non-atomic gift-card balance update** [bug] — read-then-write at `offers.ts:118`; use
  `balance_cents - amount where balance_cents >= amount`.
- **P2 Plan price edits never reach new subscriptions** [bug] — `ensurePlanPrice` returns the cached
  `stripePriceId`; `updatePlan` doesn't clear it (`catalog-actions.ts:59-69`, `membership-billing.ts:19-25`).
- **P2 Re-selling to a paused member creates a duplicate** [bug] — `fulfilOfferLines` matches `active` only
  (`offers.ts:93-100`).
- **P2 Gift cards list capped at 50 with no search** [bug] — `offers.ts:22`; 120 imported cards.
- **P2 Gift card detail: adjust, void, expiry, pre-printed code, transaction history** [gap] — schema has
  `expiresAt`, `active`, `purchaserClientId` with no UI; issued date ignores business timezone
  (`gift-cards/page.tsx:32`).
- **P2 Members roster and prepaid liability views** [gap] — who holds each plan, period end, failed payments;
  outstanding package sessions across clients.
- **P3 Stale copy** — memberships list still says auto-billing "arrives with Stripe subscriptions"
  (`memberships/page.tsx:27`).
- **P3 30-day periods and silent credit reset** [polish] — `offers.ts:94-99`, `membership-billing.ts:97`.
- **P3 Loyalty** — integer points-per-dollar only (`settings/loyalty/actions.ts:13`); no expiry, tiers or exclusions;
  client page shows 10 of 50 with no "see all".
- **P3 Reviews** — no filters, pagination, owner reply, low-rating alert or export (`listReviews` cap 200).

## 8. Checkout and sales (`app/app/[slug]/sales/[saleId]/*`, `server/sales.ts`, `server/offers.ts`)

- ✅ **P1 Walk-in / retail-only sale** [gap] — the only entry is `openSaleForAppointment`; no "New sale" with optional
  client and staff; walk-in sales can't attach a client or carry notes.
- ✅ **P1 Sales list page** [gap] — no `sales/page.tsx`; closed tickets are only reachable from Reports or a client's
  last 20. Add Open / Today / search by number or client.
- ✅ **P1 Refunds reverse side effects** [bug] — stock (the `"refund"` movement in `server/inventory.ts:27` is never
  used), loyalty points, `promoCodes.usesCount`, issued gift cards/packages; Stripe-dashboard refunds and disputes
  are ignored (`server/webhooks.ts:82-86`); `payments.tipCents` not reduced.
- ✅ **P1 Discount and promo math** [bug] — percent discounts stored as cents (`sales.ts:222-224`); promo can't be
  removed and is still counted (`sales.ts:304`); service-restricted promo discounts the whole ticket
  (`packages/core/src/pricing.ts:39-45`); discounts apply to gift card/package/membership lines (`offers.ts:81-83`).
- ✅ **P1 Add or edit service lines on an open ticket** [gap] — price, qty, staff; upsells today go back to the appointment.
- ✅ **P2 `addOffer` errors render the Next error page** [bug] — plain form action with no inline notice.
- **P2 Card reader / Tap to Pay** [gap] — in-person card is a keyed-in Payment Element (`card-payment.tsx`);
  `paymentMethod` already has `"terminal"`.
- **P2 Tip presets and client-facing tip prompt** [ux] — `forms.tsx:30-51` is a text field per provider.
- **P2 Product search / barcode scan** [ux] — one `<select>` of all products (`page.tsx:142-148`).
- **P2 Cash tendered / change due; drawer open/close** [ux] — `recordManualPayment` clamps to the balance.
- **P2 Receipt page** [ux] — renders inside the app shell with no print CSS (`sales/[saleId]/receipt/page.tsx`);
  move under `app/print/`; add address, staff, tax rate, card brand; SMS receipt.
- **P3 Taxable services setting** [gap] — hard-coded `taxable:false` (`sales.ts:116`).
- **P3 Typed "other" tenders** (Venmo/Zelle/check) [ux]; **refund permission is `reports.view`** [polish].

## 9. Services and products

- **P2 Service add-ons, variants, "price from", images** [gap] — one price/duration per service plus staff overrides.
- **P2 Bulk edit, duplicate, delete services** [gap]; **drag reorder** instead of one request per arrow
  (`services/actions.ts:95-115`).
- **P2 Per-service commission rate** [gap] — staff-level `mainCommissionBps` only.
- **P2 Product search, low-stock filter, CSV import/export** [ux] — 188 products grouped by category only.
- **P2 Supplier, purchase orders, reorder point** [gap] — `products/[productId]` has only "Received + note".
- **P2 Low-stock alert** [gap] — display-only in `stockReport`.
- **P3 Margin/COGS reporting** [gap] — `costCents` only feeds stock value.
- **P3 Booking page shows uncategorised services under a "Services" heading** while the owner side says
  "Uncategorized" (seen in the walkthrough).

## 10. Reports and payroll

- ✅ **P1 Package/membership-covered services pay $0 commission** [bug] — `buildPayrollLines` uses `amountCents`
  (`server/payroll.ts:72-76`), which `redeemCredit` zeroes; use `creditCents`.
- **P2 Finalize is not a lock** [gap] — page always re-runs live `runPayroll`; adjustments stay editable; later
  refunds change a paid period (`payroll/page.tsx`, `finalizePayroll`).
- **P2 Missing standard reports** [gap] — sales by category, product margin, tax by rate, gift-card and
  package/membership liability, new vs returning, rebooking rate, no-show per staff, discounts by reason, day/hour
  heatmap.
- **P2 "Sales" KPI** [bug] — total minus tips includes tax and stored-value sales and isn't net of refunds
  (`reports/page.tsx`).
- **P2 Line-level, tips and payments CSVs** [gap] — `reports/export/route.ts` exports headers and appointments only.
- **P2 Pay-period anchor** [ux] — default is "last 14 days ending yesterday" (`payroll.ts:192`).
- **P3 Commission tiers, greater-of hourly vs commission, deductions, backbar** [gap].
- **P3 Product commission on tax-inclusive amount** [polish] — `payroll.ts:76`; make it a setting.
- **P3 Top items grouped by name and capped at 25** [polish]; **tips disagree between by-staff and by-method on
  split tenders** [bug minor]; **year-over-year compare** [polish].
- **P3 Full-table loads per payroll run** [perf] — `payroll.ts:41-43`.
- **P3 `payroll.view` grants finalize/adjustments** [polish].
- **P3 Reports and payroll tables overflow horizontally; mobile reports date row clips the Show button** [ux] —
  seen in the walkthrough.

## 11. Marketing

- ✅ **P1 Promo start/expiry use the server timezone** [bug] — `marketing/actions.ts:108`; a code "expires 10/31" dies
  at 4:59 pm Pacific on Render.
- **P2 `{points}` placeholder never substituted** [bug] — `server/marketing.ts:44,117,243`.
- **P2 Campaign scheduling and quiet hours** [gap] — `sendCampaign` queues immediately; the 9–8 window only applies
  to automations (`runAutomations`).
- **P2 Audience filters** [gap] — exclude "has upcoming appointment", birthday month, visit count/spend, membership
  holders, saved segments.
- **P2 Test send, rendered preview, open/click, booking attribution** [gap].
- **P2 Promo edit/delete, per-client and first-visit limits, product applicability** [gap].
- **P3 `updateCampaign` skips the 320-char SMS check** [bug]; **cross-automation cooldown** (win-back + rebook
  same day) [polish]; **marketing email CTA hard-codes `#6d28d9`** (`lib/notify/templates.ts:143`) [polish];
  **dedicated `marketing.manage` permission** instead of `reports.view` [polish].

## 12. Public booking (`app/book/[slug]/*`, `server/public-booking.ts`)

- ✅ **P1 Waitlist unreachable** [bug] — days without openings are plain divs (`page.tsx:208-219`); make them tappable
  and add "No times? Join the waitlist".
- ✅ **P1 Provider step lists staff who can't do the service** [bug] — uses `staff`, not `staffForService`
  (`public-booking.ts:36-40`); picking one yields an empty calendar.
- ✅ **P1 Month availability N+1** [perf] — `getAvailableDates` (`public-booking.ts:85-93`) calls `getPublicSlots` per
  day, ~6 queries per staff per day (`availability.ts:49-75`); batch per month and skip days past `maxDate`.
- ✅ **P1 Validate promo before charging the deposit** [bug] — `startOnlinePaymentAction` never checks it;
  `createOnlineBooking` validates post-payment and refunds (`public-booking.ts:162-170`).
- ✅ **P1 `noindex` on token pages** [bug] — layout `robots.index` covers confirmed/manage/review/unsubscribe/order
  (`layout.tsx:22`).
- ✅ **P1 Order page by sale id with no secret; unpaid orders say "received"; gift code shown** [bug] —
  `order/[saleId]/page.tsx:11-12`; gate on paid and add a token.
- ✅ **P1 Review opt-out and unsubscribe mutate on GET** [bug] — `review/page.tsx:11-13`, `unsubscribe/page.tsx:9`;
  link scanners will opt clients out. Confirm button + POST.
- ✅ **P2 Multi-service booking and "next available"** [gap][ux] — `actions.ts:26` single service.
- **P2 Show forms, address/maps link, deposit and concrete cancel deadline on confirmed/manage pages** [gap] —
  `formsUrl` only goes in email/SMS (`lib/notify/index.ts:54`); `confirmed/page.tsx:24-27`.
- **P2 Promo/referral inline feedback** [ux] — `page.tsx:257`, `loyalty.ts:106-110` drops unknown referral codes.
- **P2 Timezone label** [ux] — `formatTime(s.at, tz)` with no "Times shown in Eastern Time".
- **P2 Reschedule with an availability calendar and any provider** [ux][gap] — bare date input
  (`manage/[token]/page.tsx:54`); locked to original staff (`:19`).
- **P2 Duplicate clients break passwordless sign-in** [bug] — `findFirst` on phone/email (`client-auth.ts:34-36,75`);
  pick deterministically or merge.
- **P2 Verify new phone/email on the account page; throttle login codes per destination** [gap][security] —
  `account/actions.ts:48-70`; only the IP rule in `proxy.ts:21` guards SMS pumping.
- **P2 Custom domain only serves "/"** [gap] — `proxy.ts:30-33` rewrites to `_host`, which redirects to
  `/book/<slug>`; shop/gift/account 404 and OG URL hard-codes `appUrl` (`layout.tsx:20`). Settings → Domain is also a
  dead end for tenants (instructions mention Vercel/DigitalOcean; duplicate hostname throws raw unique violation).
- **P2 "Any provider" always picks the first by sort order** [ux] — `public-booking.ts:76-79`; round-robin.
- **P2 Service photos, "from" pricing, add-ons; provider photo/title/bio** [gap].
- **P2 Category chips/search on long menus; description on its own line** [ux] — `page.tsx:75-92,84`.
- **P2 Order summary at the card step; "Already a client? Sign in"** [ux] — `payment-form.tsx:90-100`.
- ✅ **P3 `assertSlotOpen` uses business tz not location tz** [bug] — `public-booking.ts:147`.
- **P3 `rescheduleOnline` multi-item guard uses `&&`** [bug] — `public-booking.ts:254`.
- **P3 Cancel copy "up to 0 hours before"** (`forms.tsx:34`); completed visits show the cutoff warning
  (`manage page:39-42`); cancel confirm doesn't restate deposit outcome; orphaned PaymentIntent on Edit
  (`payment-form.tsx:94`); `.ics` uses business address (`calendar.ics/route.ts:27`); account page uses business
  tz (`account/page.tsx:26`).
- **P3 Shop/gift** — categories fetched but not shown (`shop/checkout.tsx:80-102`); custom amount <$5 fails silently
  (`:122`); cart not persisted; no delivery date/from-name; no balance lookup for recipients.
- **P3 Accessibility** — calendar day cells lack `aria-label`/`aria-disabled`; `Notice` lacks `role="alert"`
  (`components/ui.tsx:136`); star rating lacks `aria-pressed`; embed popup has no focus trap (`public/embed.js:56-80`);
  brand colours have no contrast check (`lib/brand.ts`).
- **P3 SEO** — no LocalBusiness JSON-LD, sitemap or robots; sub-pages share the layout title; no `error.tsx` under
  `/book`; brand customisation stops at colour/logo/cover (no welcome copy or CTA labels).
- **P3 Embed** — `postMessage` to `*` and a 1 s interval never cleared (`embed/height-reporter.tsx:8`); inline iframe
  min 640 px only grows (`embed.js:51`); client session cookie invisible in `/embed` (`client-session.ts:47`).

## 13. Settings, staff, roles, auth, onboarding

- ✅ **P1 Open redirect via `?next=`** [security] — `app/(auth)/auth-form.tsx:25-26,50`; restrict to same-origin paths.
- ✅ **P1 Permission errors render "Something went wrong" in production** [bug] — `error.tsx:5` sniffs
  `error.message`, which Next strips in prod; throw a typed error with a digest or redirect to a 403 route.
- ✅ **P1 System-role edits never sync to Better Auth org roles** [security] — `server/roles.ts:104-106`; a Manager
  stripped of `members.manage` can still invite via `/api/auth/organization/invite-member`.
- ✅ **P1 Import staging in `os.tmpdir()`** [bug] — `settings/import/actions.ts:15-16,41`; stage in `importJobs`.
- ✅ **P2 Breaks and split shifts; time-off date ranges** [gap] — one block per day (`staff/[staffId]/hours`,
  `staff/actions.ts:104-139`); one date per submission (`time-off`, `staff/actions.ts:159-190`).
- ✅ **P2 Findability of schedule pages** [ux] — Schedule → Staff hours overview; Marketing ↔
  Automations/Loyalty cross-links; Payroll/Sales/Reviews ↔ Reports with filters; ⌘K indexes every sidebar and
  Settings page from `lib/nav.ts`.
- ✅ **P2 Rotating schedules** [gap] — hours repeat every 2–4 weeks (every other Saturday, early/late weeks):
  `staff.rotation_weeks` + `rotation_anchor`, `staff_schedules.week_index`, Week tabs on the hours page.
- ✅ **P2 Time-off "upcoming" uses UTC today** [bug] — `time-off/page.tsx:12`.
- **P2 Staff can't open their own profile/hours/feed; list shows everyone's email and login to any member**
  [security] — `staff/[staffId]/layout.tsx:19`, `staff/page.tsx:16`. Pay tab gated by `members.manage`, not
  `payroll.view` (`pay/page.tsx:11`).
- **P2 Audit log gaps** [security] — nothing for settings, Stripe connect, role/member changes, invitations, pay
  rates, numbers, domain, client edits, service prices, gift-card adjustments; page has no filters and shows raw JSON
  diff (`settings/audit/page.tsx:50-56`).
- ✅ **P2 Settings index** [ux] — 17 flat cards with no grouping or status; business basics split across index,
  Profile, Booking and Locations; Managers have no nav path to Roles (`layout.tsx:53`, `settings/page.tsx:16`); nav
  shows Catalog/Classes/Waitlist/Time clock regardless of permission.
- **P2 "Require a card on file" silently ignored without Stripe** [bug] — `settings/booking/page.tsx:41-44`,
  `server/online-payments.ts:23-26`; show a warning state.
- **P2 Platform-operator copy in tenant UI** [ux] — webhook/env-var instructions on Payments
  (`settings/payments/page.tsx:40-44,139-147`) and `RESEND_API_KEY` on Messages (`notifications/page.tsx:30`).
- **P2 Stripe status detail** [gap] — `syncConnectAccount` discards `requirements` (`server/stripe-connect.ts:58-69`);
  show payouts status, what Stripe still needs, last sync; success flash on return.
- **P2 Onboarding** [gap] — only name + timezone; "Main location" has no address/phone/hours (feeds booking header,
  emails, Twilio prefill); slug auto-generated with a random suffix and never editable; no email-verification prompt.
- **P2 Invitations** [gap][ux] — no resend/decline/history; email-mismatch screen has no sign-out button
  (`invite/[id]/page.tsx:50,61`); copy says "Send them this link" though it is emailed; email prints the role key.
- **P2 Messages page** [ux] — SMS wording, inbox and a 200-row log on one page; no filter, pagination or resend.
- **P3 Auth pages** — reset success message never shown (`reset-password/page.tsx:24`); signed-in users hitting
  `/sign-in` lose `next` (`proxy.ts:42-44`); no confirm-password/terms checkbox; no lost-device path on 2FA; cookie
  cache keeps revoked sessions live 5 min (`lib/auth.ts:74`); no "require 2FA for owners" policy; Connected accounts
  always says "Connected" (`account/page.tsx:52`); email change is a hard-coded dead end.
- **P3 Deactivating staff leaves the login; no staff delete; staff list lacks readiness indicators** [gap].
- **P3 Twilio verification success notice always addressed to "you"** [bug] — `messaging/actions.ts:80` vs
  `messaging/page.tsx:34,43`; prefill leaves city/state/ZIP blank and uses "Haircut with Jamie".
- **P3 Billing usage period math wrong for trials/annual; no trial messaging** — `settings/billing/page.tsx:34,70-75`.
- **P3 Import** — no staff/product/gift-card/membership import; result round-tripped in the URL.
- **P3 Help text drifts from the UI; `SUPPORT_EMAIL` fallback is a dead end; root page shows raw role key**
  (`help/page.tsx:9,14,15,47`, `app/page.tsx:21`).

## 14. Cross-cutting platform

- ✅ **P1 Notification retries and "Send again"** [gap] — failed rows are never reclaimed
  (`lib/notify/index.ts:241-265`); add `attempts` + backoff and a per-row resend on Settings → Messages.
- **P2 Second reminder (24h + 2h)** [gap] — single `reminderHours` (`packages/db/src/schema/domain.ts:78`).
- **P2 Staff notification preferences** [gap] — alerts go only to `business.email` (`public-booking.ts:301-302`).
- **P2 SMS segment counter** [ux] — template editor and campaign composer.
- **P2 In-app notification center / unread badge** [gap] — new bookings, cancellations, text replies.
- **P2 Job run visibility** [gap] — single cron endpoint runs four jobs serially with `console.log` only
  (`api/jobs/notifications/route.ts:430-446`); record `job_runs` and show "last ran" in the app.
- **P2 ⌘K coverage** [ux] — add sales, gift-card codes, products and all settings pages (`search/route.ts:14-20`).
- **P2 Mobile tab bar quick action** [ux] — no New appointment / Checkout (`layout.tsx:49-54`).
- **P2 One feedback pattern** [ux] — 13 actions use `setFlash` error toasts that auto-dismiss in 4.5 s while
  `ActionForm` shows persistent inline errors; toaster shows one message with no queue or hover pause.
- **P2 Pending states on 11 raw `<form action>` files** [ux] — toggles on Products/Services/Packages/Memberships/Promos,
  invite accept, onboarding double-submit.
- **P2 Error boundaries** [gap] — no `error.tsx` for `/book`, `/account`, `/onboarding`, `/clock`, `/embed`; no
  `loading.tsx` outside `/app/[slug]` and `/book/[slug]`.
- **P2 Tests** [gap] — none for `sales.ts`, `booking.ts`, `notify/index.ts`, `webhooks.ts`, `public-booking.ts`;
  one Playwright smoke test; PLAN §6 promises cross-tenant and DST tests.
- **P2 Client-side error capture** [gap] — `instrumentation.ts` sees server errors only; `global-error.tsx` claims
  "We've been notified".
- **P2 Accessibility** — mobile drawer and ⌘K palette have no focus trap/restore and the drawer ignores Escape
  (`mobile-nav.tsx:38`, `command-palette.tsx:75`); `text-stone-400` at 10–11 px fails AA (`layout.tsx:72,88`);
  icon-only controls rely on `title` (145 uses, zero `sr-only`); `size="sm"` buttons are 32 px on phones
  (`components/ui.tsx:174`).
- **P2 Unsaved-changes guard** on the service editor, form builder and campaign composer [polish].
- **P2 Undo window for destructive actions** [ux] — cancel, void, delete commit immediately.
- **P2 Rate limiting skips server actions** [gap] — `proxy.ts:18-25`; campaigns, exports, gift-card issue unlimited.
- **P2 Idle lock for shared front-desk machines** [gap].
- **P2 PWA manifest, apple-touch-icon, theme-color** [gap]; **offline banner** [gap].
- **P3 Calendar page queries** [perf] — three sequential `withTenant` calls and per-appointment forms checks
  (`page.tsx:40-56`); layout re-queries roles/memberships/locations per navigation (`layout.tsx:21`); automation loop
  inserts per client (`server/marketing.ts:240-252`).
- **P3 `business.currency` ignored by ~90 `money()` calls**; two overlapping formatter modules (`lib/format.ts`,
  `lib/utils.ts`).
- **P3 16 of 80 app pages lack `metadata.title`**; Forms lives at both `/forms` and `/settings/forms`; Marketing under
  "Money" but Reviews under "People".
- **P3 Emails HTML-only with no `List-Unsubscribe` header** (`lib/notify/providers.ts:393-409`).
- **P3 Print styles** — scroll containers clip day sheet and payroll tables (`globals.css:547`); no dark mode.
- **P3 Expo app** (`apps/mobile`) is a 218-line stub against three `/api/mobile` routes that predate locations,
  classes, forms and series; budget a real pass or drop it from TODO.
- **P3 PLAN.md items still unmet** — "running late" notification, private vs shareable notes, card-present
  Terminal, keyboard drag; build or strike.
