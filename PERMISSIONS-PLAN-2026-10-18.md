# Permissions: the complete gap list and the target model — 2026-10-18

Why this exists: the owner has asked four times for a roles-and-permissions review and each pass fixed holes without changing the
model. This document is the whole picture: every page, action and API route was inventoried from code, every page was opened live as
a real Provider login (jordan@luxebeauty.demo) and a real Front desk login (marcus@luxebeauty.demo), and the catalog was compared
with what Vagaro, Boulevard, Fresha, GlossGenius, Mangomint and Zenoti ship. Paths are under `apps/web/src/` unless noted.

## 1. The model's structural problems

1. **No "view" permission for several areas.** Reviews ride on `clients.read`; the staff directory, services, products, packages,
   memberships and the home calendar need only membership; the waitlist and staff hours ride on `appointments.read.any`.
2. **No own / everyone axis** except for the calendar. Every competitor has it for sales, reports, reviews, photos, time clock,
   payroll and forms. Here "own" exists only where calendar visibility happens to imply it.
3. **Client contact details are inseparable from the client list.** `clients.read` = list + phone + email + birthday + address, on
   seven surfaces. Boulevard, Mangomint, Fresha and Zenoti all have a separate contact-info switch (Zenoti masks to last 4).
4. **Money figures leak through non-money pages.** Lifetime spend and tips on the client list and profile, seat prices on classes,
   per-line prices and totals on the calendar hover card, stock counts on Products: none need `reports.view` or `inventory.*`.
5. **One `business.manage` bucket** still covers 14 settings pages plus forms design, automations, loyalty and the message log.

## 2. Every gap, by surface (what, who sees it today, what should control it)

### Clients
| # | Surface | Exposed today | To | Should be controlled by |
|---|---|---|---|---|
| C1 | `clients/page.tsx:19`, `clients/[clientId]/page.tsx`, `waitlist/page.tsx:26`, `classes/[sessionId]/page.tsx`, `sales/[saleId]/page.tsx`, `app/[slug]/search/route.ts:24`, `appointments/[id]/page.tsx:526-529`, calendar hover card `lib/calendar-tip.ts:87` + `page.tsx:124`, `api/mobile/agenda` (`...i` spread of `clientPhone`) | phone, email, birthday, address | anyone with `clients.read`; appointment page and hover card and agenda need **no** client permission at all | new `clients.contact` (`lib/visibility.ts` `canSeeClientContact` already exists, used only by the mobile detail route) |
| C2 | `appointments/[id]/page.tsx:526-529` | client record notes and three pinned private notes | anyone who may open the appointment | `clients.notes` (mobile detail already strips via `clientForViewer`; web does not) |
| C3 | `clients/page.tsx:19`, `clients/[clientId]/page.tsx` | lifetime spend, spend per visit, tips | `clients.read` (Provider default) | new `clients.spend` (or `reports.view`) |
| C4 | `clients/[clientId]/page.tsx:55-78` | every past and upcoming visit with other providers' names and prices, star ratings and review text per visit | own-calendar roles | history filtered by appointment access for own-only roles; ratings behind `reviews.*` |
| C5 | `clients/[clientId]/page.tsx:48` `generateMetadata` | client name in the tab title | any member, even without `clients.read` | same guard as the page |
| C6 | `gallery/page.tsx:24-28` | every stylist's photos with client names; "Any stylist" filter lists owner and front desk | anyone with `clients.photos` (Provider default) | `clients.photos` = everyone's, new `clients.photos.own` = own lines only |
| C7 | `settings/forms/submissions/page.tsx:17` | "Still to sign this week" lists **every staff member's upcoming appointments** (client, time, service) and all submissions; detail shows signer IP; "Edit form" link 403s | anyone with `clients.notes` (Provider default) | due list scoped by appointment access; IP behind `audit.view`; edit link behind `forms.manage` |
| C8 | `settings/forms/actions.ts:81-102` | void, reassign, email a signed form | `clients.write` (weaker than the page that shows it) | new `forms.manage` |
| C9 | no feature | client first-name-only / initial display for providers (Boulevard, Mangomint) | — | new `clients.fullname` later (phase 3) |

### Reviews
| # | Surface | Exposed today | To | Should be controlled by |
|---|---|---|---|---|
| R1 | `reviews/page.tsx:26`, `lib/nav.ts` Grow | all 147 reviews: client full name, stars, comment, provider, **per-provider averages and counts** | anyone with `clients.read` (Provider default) | new `reviews.view` (everyone's) and `reviews.view.own` (own lines, author name only with `clients.contact`) |
| R2 | `server/reviews.ts` | there is no reply / respond feature; review settings are `business.manage` | — | new `reviews.reply` gating a reply feature (phase 3) and the Google-invite settings |
| R3 | API `reviews:read` | no `SCOPE_NEEDS` entry: any `integrations.manage` holder can mint it | — | `reviews.view` |

### Staff
| # | Surface | Exposed today | To | Should be controlled by |
|---|---|---|---|---|
| S1 | `staff/page.tsx:18`, mobile bottom tab "Staff", `lib/nav.ts` | the full directory: photo, display and full name, position, location, **weekdays worked** (`whereWorks` :38-56 from weekly hours), "no calendar column" | **every member** | new `staff.directory` (names, photos, positions) and `staff.schedules.view` (hours, days, time off) |
| S2 | `staff-hours/page.tsx:36`, `staff-hours/time-off/page.tsx` | everyone's weekly hours by site, upcoming time off **with notes**, login role per person | anyone with `appointments.read.any` (Front desk default) | `staff.schedules.view` |
| S3 | `time/page.tsx:37`, `time/actions.ts:45,64,99` | all staff's time-clock entries and totals; add/edit/delete hours for anyone | `staff.manage`; API `time:*` needs `payroll.view` instead | new `time.view.all` and `time.edit`; API aligned |
| S4 | `inventory/use/page.tsx` | "Logged by the team, recently": other staff's supply usage | anyone with `inventory.log` | own entries for own-calendar roles |
| S5 | API `staff:read` | no `SCOPE_NEEDS` entry; `staff/[id]/schedule` GET sits under `catalog:read` | — | `staff.directory` / `staff.schedules.view` |
| S6 | no feature | edit own hours, own services and prices, own profile (GlossGenius, Mangomint, Boulevard) | — | new `staff.self.hours`, `staff.self.services`, `staff.self.profile` (phase 2) |

### Calendar and classes
| # | Surface | Exposed today | To | Should be controlled by |
|---|---|---|---|---|
| A1 | home `page.tsx:124-125`, `lib/calendar-tip.ts:77-87` | hover card: client phone, appointment notes, per-line prices, deposit | anyone who sees that column | phone → `clients.contact`, notes → `clients.notes`, prices → `catalog.prices` |
| A2 | `classes/actions.ts:31` | a Provider cannot enrol into or cancel their **own** class | — | new `classes.manage.own`; `classes.manage.any` for the current behaviour |
| A3 | `classes/[sessionId]/page.tsx` | seat price | Front desk | `catalog.prices` |
| A4 | `waitlist/page.tsx:14`, `waitlist/actions.ts:9` | waitlist read rides on `read.any`, actions on `write.any` | — | new `waitlist.view` / `waitlist.manage` |
| A5 | `lib/nav.ts:126-128` ⌘K "New appointment", "Block time", "New client" | offered to every role, then 403 | — | gate on booking / block access and `clients.write` |
| A6 | no feature | "see other calendars as availability only" (Boulevard, Mangomint) between own-only and read-any | — | new `appointments.read.availability` (phase 2) |

### Sales, reports, payroll
| # | Surface | Exposed today | To | Should be controlled by |
|---|---|---|---|---|
| M1 | `sales/page.tsx:32`, `sales/[saleId]/page.tsx:46-47` | every ticket, **tips per stylist**, payment method and last 4, "Add a tip" to any stylist | any `checkout.take` role with `appointments.read.any` (Front desk default); own scoping is a side effect of calendar scope | new `sales.view.all` / `sales.view.own`, independent of calendar permissions |
| M2 | `sales/[saleId]/actions.ts:61-66` refund, `appointments/[id]/actions.ts:249` refund deposit | refunds skip the own-ticket / appointment-access check | any `checkout.refund` holder | require `sales.view.all` or own ticket |
| M3 | `reports/page.tsx:86-95` | per-staff services, products, tips | `reports.view` | new `reports.staff` for the per-person table |
| M4 | `payroll/*` | everyone's pay | `payroll.view` only; no "my pay" | rename to `payroll.manage`; new `payroll.view.own` ("my pay sheet and tips") |
| M5 | `sales/[saleId]/actions.ts:206-229,561-566,699+` | tax-exempt toggle, late tips, tip reassignment on an own ticket | `checkout.take` | `checkout.discount` for tax, new `checkout.tips.adjust` |
| M6 | `gift-cards/page.tsx:17` | gift cards need `giftcards.issue` or `reports.view` to even look at | Front desk can sell but not look up a balance | new `giftcards.view` |
| M7 | no feature | discount limit (%) with manager approval above it (Vagaro) | — | phase 3 |

### Catalog and inventory
| # | Surface | Exposed today | To | Should be controlled by |
|---|---|---|---|---|
| I1 | `services/page.tsx:18`, `/all`, `/categories/[id]`, `packages/page.tsx:18`, `memberships/page.tsx:17`, `app/[slug]/search/route.ts:35` | prices, durations, plan prices | **every member** | new `catalog.view` (names) and `catalog.prices` (default on; owner can remove for Provider) |
| I2 | `products/page.tsx:46-123` | retail prices, SKU, barcode, **stock counts per option**, Export button that then 403s | **every member** | stock → new `inventory.view`; Export hidden without it |
| I3 | `products/[productId]`, `/group`, exports | cost and margins | `services.manage` or `inventory.manage` | new `catalog.costs` (Manager and Owner) |

### Settings and the API
| # | Surface | Exposed today | To | Should be controlled by |
|---|---|---|---|---|
| T1 | `settings/{profile,booking,locations,notifications,store,loyalty,reviews,embed,domain,import,forms,refund-reasons,cancellation-reasons}`, `marketing/automations`, `loyalty`, `messages` | one bucket | `business.manage` | split into `settings.business` (profile, locations, wording, reasons, embed, domain, import), `settings.booking` (booking rules, deposits, fees, store, loyalty, review requests, automations, message log), `forms.manage` |
| T2 | `lib/api-scopes.ts` `SCOPE_NEEDS` | `forms:*` ← `clients.write`, `time:*` ← `payroll.view`, `sales:` ← `reports.view`, `staff:read` and `reviews:read` unmapped | — | map every scope to the new catalog so a key can never do what its creator cannot |
| T3 | dev "View as" pill | drawn for non-owners (inert, but offers "Owner") | — | hide unless real role is owner |

## 3. The target catalog

Defaults: O = Owner, M = Manager, F = Front desk, P = Provider. Back-fill = how stored custom roles are migrated so nobody loses
access they have today (the owner can then take things away under Roles).

| Action | Label | Gates | Defaults | Back-fill from today |
|---|---|---|---|---|
| **Calendar** | | | | |
| `appointments.read.own` / `write.own` / `book.own` / `change.own` / `cancel.own` / `block.own` | unchanged | | | — |
| `appointments.read.any` | See every calendar | unchanged | O M F | — |
| `appointments.write.any` | Manage any appointment | unchanged | O M F | — |
| `waitlist.view` | See the waitlist | waitlist page, API `waitlist:read` | O M F | ← `appointments.read.any` |
| `waitlist.manage` | Work the waitlist | book from it, close entries | O M F | ← `appointments.write.any` |
| `classes.manage.own` | Run their own classes | schedule, enrol, cancel where instructor = self | O M (P off) | off |
| `classes.manage.any` | Run every class | today's `classes/actions.ts` | O M F | ← `appointments.write.any` |
| **Clients** | | | | |
| `clients.read` | View clients | list and profile **without** contact details, spend or other providers' history for own-only roles | O M F P | — |
| `clients.contact` | See phone, email, address, birthday | every surface in C1 | O M F | ← `clients.read` |
| `clients.spend` | See what clients spend | spend, per-visit, tips on list and profile | O M F | ← `clients.read` |
| `clients.write`, `clients.notes`, `clients.messages`, `clients.balances`, `clients.export` | unchanged | | | — |
| `clients.photos` | See every visit photo | gallery and profile photos, all stylists | O M F | ← `clients.photos` except Provider |
| `clients.photos.own` | See their own visit photos | gallery and profile filtered to lines they performed | P | P ← `clients.photos` |
| **Reviews** | | | | |
| `reviews.view` | See all reviews | reviews page, per-provider averages, stars on client profiles, API `reviews:read` | O M F | ← `clients.read` (today's gate) |
| `reviews.view.own` | See their own reviews | reviews page filtered to their lines; author shown only with `clients.contact` | P | ← roles with `read.own` and not `read.any` |
| `reviews.reply` | Reply to reviews and run review settings | reply feature (to build), Google invite settings | O M | ← `business.manage` |
| **Checkout and money** | | | | |
| `checkout.take` | Take payments | open checkout, record payments, sell | O M F P | — |
| `sales.view.own` | See their own tickets | sales list and detail via `ownSaleCondition` regardless of calendar permissions | P | ← `checkout.take` without `read.any` |
| `sales.view.all` | See every ticket | unfiltered sales; refunds on others' tickets need this | O M F | ← `checkout.take` with `read.any` |
| `checkout.discount` | Discounts, price changes, voids, tax exempt | adds the tax-exempt toggle | O M F | — |
| `checkout.tips.adjust` | Add or move tips after payment | late tips, tip reassignment | O M F | ← `checkout.take` for M F; P off |
| `checkout.refund` | Refund payments | plus own-ticket or `sales.view.all` check | O M | — |
| `giftcards.view` | Look up gift cards | gift-cards page, masked codes, balances | O M F | ← `giftcards.issue` or `reports.view` |
| `giftcards.issue` | Issue free gift cards | unchanged | O M | — |
| `reports.view` | View business reports | totals, refunds, cancellations | O M | — |
| `reports.staff` | See sales by staff member | per-staff table in Reports | O M | ← `reports.view` |
| `payroll.manage` | Run payroll for everyone | today's `payroll.view` | O M | 1:1 rename |
| `payroll.view.own` | See their own pay sheet | payroll page filtered to self, own tips and hours | (off; owner's choice) | off |
| **Staff** | | | | |
| `staff.directory` | See the staff list | names, photos, positions; staff pickers keep working | O M F P | all roles |
| `staff.schedules.view` | See colleagues' hours and time off | `whereWorks`, Staff hours page, time-off list, API `staff:read` schedule | O M F | ← `appointments.read.any` |
| `staff.manage` | Manage staff | unchanged (profiles, hours, time off, services for everyone) | O M | — |
| `staff.self.hours` | Edit their own hours and time off | own Weekly hours and Time off tabs | (off) | off |
| `staff.self.services` | Edit their own services and prices | own Services tab | (off) | off |
| `time.view.all` | See everyone's time clock | time page all rows, totals; API `time:read` | O M F | ← `staff.manage` |
| `time.edit` | Add, edit, delete hours | time/new, row edits; API `time:write/delete` | O M | ← `staff.manage` |
| `members.manage` | Manage logins and roles | unchanged | O M | — |
| **Catalog and inventory** | | | | |
| `catalog.view` | See the service and product menu | services, products, packages, memberships lists (names, durations) | O M F P | all roles |
| `catalog.prices` | See prices | prices on those lists, hover-card lines and totals, class seat price | O M F P | all roles (owner may remove) |
| `catalog.costs` | See product cost and margins | product detail cost, group cost, exports | O M | ← `services.manage` or `inventory.manage` |
| `services.manage` | Manage the catalog | unchanged | O M | — |
| `inventory.view` | See stock levels | stock chips, read-only inventory pages, Export | O M F | ← `inventory.manage` or `inventory.log` |
| `inventory.log`, `inventory.manage` | unchanged | | | — |
| **Marketing and forms** | | | | |
| `marketing.send` | unchanged | | O M | — |
| `forms.manage` | Design forms and manage signed copies | settings/forms pages, void/reassign/email, API `forms:write/void/delete` | O M | ← `business.manage` |
| **Settings** | | | | |
| `settings.business` | Business profile and setup | profile, locations, text wording, reasons, embed, domain, import | O M | ← `business.manage` |
| `settings.booking` | Booking, store and client-care rules | booking rules, deposits, fees, store, loyalty, review requests, automations, message log | O M | ← `business.manage` |
| `billing.manage`, `integrations.manage`, `audit.view` | unchanged | | O | — |

Retired after back-fill: `business.manage` (→ `settings.business` + `settings.booking` + `forms.manage` + `reviews.reply`),
`payroll.view` (→ `payroll.manage`).

## 4. Build order

**Phase 1 — close the exposures (one migration, back-fill rules above):** `clients.contact`, `clients.spend`, `reviews.view` /
`reviews.view.own`, `staff.directory`, `staff.schedules.view`, `catalog.view` / `catalog.prices` / `catalog.costs`,
`inventory.view`, `sales.view.own` / `sales.view.all`, `giftcards.view`, `time.view.all` / `time.edit`, `waitlist.view` /
`waitlist.manage`, `forms.manage`; apply them on every surface in section 2 (web pages, hover card, ⌘K, mobile agenda and detail,
API `SCOPE_NEEDS`, nav and mobile tabs); fix M2 (refund access), C4/C7 scoping, C5 metadata, A5 search entries, T3 pill. Roles page
groups regrouped as in section 3 with one-line descriptions. Tests: a per-role matrix test that renders each page's data loader as
each default role and asserts which fields are present (so the next regression is caught by CI, not by the owner).

**Phase 2 — own / everyone axes and self-service:** `clients.photos.own`, `reports.staff`, `payroll.manage` + `payroll.view.own`,
`checkout.tips.adjust`, `classes.manage.own/any`, `staff.self.hours` / `staff.self.services`, `appointments.read.availability`,
`settings.business` / `settings.booking` split, retire `business.manage`.

**Phase 3 — features that do not exist yet:** review replies (`reviews.reply`), client name masking (`clients.fullname`),
discount limit with approval, per-location access for roles, owner transfer flow, PIN for sensitive actions.
