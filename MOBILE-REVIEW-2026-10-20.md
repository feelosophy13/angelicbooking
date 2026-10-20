# Mobile review — 2026-10-20

A pass over the web app at phone width: the staff app under `/app/[slug]`, the client booking flow under `/book/[slug]`
and `/embed/[slug]`, and the auth, onboarding and public pages. Done on the demo tenant `demo-twosites` (Glow Collective,
two locations) signed in as the manager, in the built-in browser at 375×812, then re-checked at 390×844 and 768×1024.

**How it was checked.** Every page (151 URLs: 125 staff pages with one real record for each detail route, 26 public and
booking pages including each booking step, a manage link, a review link, a shared form, an order and the embed) was loaded
in a same-origin frame at the target width and measured: `document.documentElement.scrollWidth > clientWidth` (page scrolls
sideways), elements past the right edge that are not inside a scroll box, boxes that clip their content, tables that scroll
inside their card, fields under 16px (iOS zooms into them), and controls under ~36px tall. The main flows were then walked
by hand with screenshots: calendar Day / Week / Month / Agenda, the appointment sheet, New appointment, clients, the nav
drawer, its New menu and the account menu, and the whole booking flow from location to details.

Paths are under `apps/web/src/`.

## 1. What was wrong, and the fix

Ordered by impact. "Pages" counts what the scan flagged before the fix.

| # | Where | Problem at 375px | Fix |
|---|---|---|---|
| 1 | Every form (85 pages) | `Input`, `Select`, `Textarea` and most hand-written fields are `text-sm` (14px). iOS Safari zooms the page into any field under 16px on focus and stays zoomed, so every search box, filter and form jumped. | `globals.css`: below `md` every text field, select and textarea is 16px (larger sizes left alone). The service picker's button matches (`max-md:text-base`). |
| 2 | Settings (708px wide), Reports, Locations new/edit (549px), and any page with a one-column `grid` | A `grid` with no `grid-cols-*` gets an `auto` column, which grows to fit its widest line. One truncated blurb ("Name, timezone, logo, brand and app colors, about text and…") made the Settings cards 708px wide: the right half of every row, its status chip and chevron were off screen. | `globals.css` base layer: `.grid { grid-template-columns: minmax(0, 1fr) }`. Any `grid-cols-*` utility (including `sm:` / `lg:`) still wins, so only single-column grids change, and they now stay inside their container. Fixed Settings, Locations and Reports' card grid in one place. |
| 3 | Reports (1005px wide) | An `sr-only` label inside the "Revenue by service category" table scroller is `position: absolute`. The scroller was not positioned, so the label escaped it at x≈1000 and stretched the page; on a phone the layout viewport widened to 1005px and the fixed bottom tabs stretched with it. | `globals.css` base layer: `.overflow-x-auto, .overflow-auto { position: relative }`, so every table scroller contains its absolutely positioned children. |
| 4 | Clients list | Six-column table scrolled sideways inside its card (711px of content in 341px); the contact line widened the name column to 362px. | Phone layout: name, contact line and a "Last visit …" line, then Visits and the chevron. Last visit / spend / client since columns show from `sm`. The name cell is `w-full max-w-0` so the contact line truncates instead of widening the table. |
| 5 | Appointments list | Seven-column table (995px of content) scrolled inside its card; the view switcher (Upcoming / Today / Recently booked / Past) was 379px and pushed the page sideways; the source / status / provider selects could be wider than the card. | Phone layout: date + start time · client with "service · provider" under it · status. Service, Provider, Location and Booked columns show from `sm`. Filter form wraps onto its own line (`basis-72`). |
| 6 | Hand-written segmented controls (calendar Day / Week / Month / Agenda, appointment views, sale tabs, period pickers on Reports / Inventory report, staff-hours toggles, location pills, the sale page's `Segmented`, quick create, book-form, scan session; 14 places) | 28px tall: under a finger-sized target. A long one overflowed the page (#5). | They carry `data-segmented`. One rule in `globals.css`: never wider than their container (a long one scrolls inside itself), and below `md` each choice is 40px tall. |
| 7 | `Button` / `LinkButton` / `SubmitButton` / `ConfirmSubmit` at `size="sm"` (147 uses) | 32px tall on a phone. | `sm` is 40px below `md`, 32px from `md` up. The calendar's "Pick a date" button matches. |
| 8 | Opening hours editor (Locations new / edit) | Fixed `6rem 1fr auto 1fr 6rem` row: 555px wide, the second time box and "Closed" off screen. | `components/hours-editor.tsx`: on a phone each day is two lines (day and Closed, then from / to boxes 40px tall, padded tightly enough that Chrome's clock icon doesn't clip "AM"); one row from `sm`. |
| 9 | Service and product categories | Up / down, picture, rename box, Rename, Edit, count and Delete on one line: 408px; Delete was off screen. | `components/categories.tsx`: the row wraps; Edit, count and Delete stay together and drop to their own line. Also "uncategorised" → "uncategorized". |
| 10 | Service picker (`compact`, used in toolbars) | Fixed 13rem minimum after other filters ran off the right edge (Gallery 446px); its 22rem list always opened rightward, off screen when the button sat on the right half. | Caps at the container width on phones; the list opens leftward when it would run off the right edge. |
| 11 | Appointment page, "Move" and "Add a service" | Staff / Date / Find times on one fixed grid row: the date box and "Find times" were clipped inside the card (button at 482px). | The rows stack on phones and become one row from `sm`. |
| 12 | Time clock | Header date range plus a "Show" button: 436px. | Two date boxes that share the row and apply on their own (`AutoSubmitForm`, per DESIGN.md "Filters apply on their own"); no Show button. |
| 13 | Calendar Day / Week header strip | Four stat cards (Today, Expected, Next up, Forms due) stacked one per row: a full screen of cards before the first appointment. | Two columns on a phone (icon hidden below `sm`), four from `lg`. The "Hover an appointment…" hint shows from `md` only. |
| 14 | Product page, "Stock on hand" (768px, sidebar showing) | Adjust-stock row was `14rem 10rem 5rem 1fr` from `sm`: 830px wide in the 464px content column next to the sidebar. | Two columns from `sm`, the fixed row from `lg`. |
| 15 | Form submissions, Inventory report (three tables), sale ticket lines, purchase order lines, prices by stylist, Reports "Stock on hand", developer docs (three tables) | Tables without a scroll box widened the page (submissions 491px, inventory report 473px, developers 438px). | Each sits in an `overflow-x-auto` box, like the other tables. |

## 2. Checked and fine at 375px

- Calendar Day and Week (overview) turn into per-stylist lists on a phone; Month and Agenda fit. The appointment detail
  panel is a bottom sheet with Open / Check in / Complete / Check out reachable; it sits above the bottom tabs.
- New appointment: every field, the open-times grid and the submit button clear the bottom tab bar (`pb-24` on `main`).
- Nav drawer (scrolls on its own, closes on navigation), its New menu, the account / switch-business menu, `ConfirmSubmit`
  dialogs (`min(92vw, 26rem)`), the keyboard-shortcut dialog (hidden on phones).
- Booking flow: location, category, service, provider, calendar, times and the details form; shop, gift cards, client
  account sign-in, manage link, confirmation, review link, shared form, order receipt and `/embed`. No sideways scroll, no
  fields under 16px (the booking `ui.tsx` already used 16px fields).
- Landing, help, privacy, terms, forgot / reset password, two-factor, onboarding, account.
- Wide content that is meant to scroll inside its card and does: Reports tables, Payroll, Audit log, Messages log, Gift
  cards, Time clock entries, Staff hours week grid, Products bulk edit, the Inventory and Staff sub-tabs.
- After the fixes, the full 151-page scan at 375×812, 390×844 and 768×1024 finds no page that scrolls sideways and, below
  768px, no field under 16px. (At 768px fields are 14px by design; the 16px rule is for phone widths.)

## 3. Left over

- **Small text links.** Inline links such as "Back", "Change", "View", "+1 week", "New client" and the booking page's
  phone and website links are 16–20px tall. They sit in running text with space around them, so a miss lands on nothing,
  but a 40px hit area would be better. A `BackLink` / `TextLink` padding pass is a follow-up.
- **Segmented control with four long labels** (Appointments: Upcoming / Today / Recently booked / Past) scrolls inside
  itself at 375px rather than wrapping; "Past" is half visible. Shorter labels on phones ("New" for "Recently booked") would
  fit them.
- **Tables that scroll sideways on purpose** (Reports, Payroll, Audit, Messages, Gift cards, Time clock entries) are usable
  but read better as stacked rows on a phone. Clients and Appointments were converted because the desk uses them daily;
  the others are mostly owner-at-a-desk pages.
- **Phone numbers show raw** (`+17035551024`) in the clients list and the appointment sheet. Not a layout issue; a
  formatting pass belongs with the client list.
- **Sign-in and sign-up** redirect while signed in, so they were checked by code and the shared auth layout (`max-w-sm`
  column, `Input` fields that the 16px rule covers) rather than measured signed out.
- The Next.js dev indicator (the round "N" bottom-left in development) overlaps the first bottom tab. It does not exist in
  production builds.
