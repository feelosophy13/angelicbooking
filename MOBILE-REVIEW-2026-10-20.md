# Mobile and tablet review — 2026-10-20

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
| 1 | Every form (85 pages) | `Input`, `Select`, `Textarea` and most hand-written fields are `text-sm` (14px). iOS Safari zooms the page into any field under 16px on focus and stays zoomed, so every search box, filter and form jumped. | `globals.css`: below `lg` and on any touch screen every text field, select and textarea is 16px (larger sizes left alone); first done below `md`, widened for tablets in §3. The service picker's button matches. |
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
- After the fixes, the full 151-page scan at 375×812, 390×844 and 768×1024 finds no page that scrolls sideways and, on
  phones and tablets, no field under 16px (see §3 for the tablet rules).

## 3. Tablets (768×1024 portrait, 1024×768 landscape)

Added the same day: tablets are a full target, not a spot check. The same 151 pages were scanned at both sizes and the
calendar (Day grid, Month, the appointment panel, quick create), appointment, sale, reports, inbox, staff hours, booking
and settings pages were walked by hand. Tablets are touch screens at desktop widths, so sizes now follow the pointer
as well as the width.

| # | Where | Problem | Fix |
|---|---|---|---|
| T1 | Whole staff app, portrait (768–1023px) | The sidebar switched on at `md` (768), leaving ~450px for the page next to 240px of menu: the Day grid showed 2½ of 5 stylists, two-column cards were squeezed. | The phone shell (top bar, menu drawer, bottom tabs) now runs until `lg`; the sidebar starts at 1024. Portrait pages get the full width (the Day grid shows 4 of 5 stylists). `main` keeps its bottom padding above the tabs until `lg`. |
| T2 | Detail pages with a side column, landscape (1024px) | `lg:grid-cols-[1fr_320–380px]` beside the sidebar left a 316–376px main column: the appointment's service line wrapped one word per line ("Color / + / Style"). 26 layouts: appointment, client, class session, sale, new sale, payroll, staff pages, invitations, most settings pages, campaigns, purchase orders, new appointment / class, embed builder. | Side-column layouts switch to two columns at `xl` (1280). Where the side column holds the primary action (appointment, client, class session, sale, new sale) they keep two columns at `lg` with a 300px side (`lg:grid-cols-[minmax(0,1fr)_300px]`), so Checkout and the status buttons stay on the first screen. DESIGN.md says so. |
| T3 | Touch targets on tablets | The 40px sizes from §1 (#6, #7) and the 16px field rule stopped at 767px, so an iPad got 32px buttons, 28px segmented choices and 14px fields (zoom on focus). | Everything that shrinks for a mouse now uses `lg:pointer-fine:` (small buttons, the date-picker button, the opening-hours boxes, the staff-hours toggle, inbox quick replies, category Rename / Edit); the CSS rules for 16px fields and 40px segmented controls apply below `lg` or on any coarse pointer. A touch screen at any width keeps the large sizes. |
| T4 | Appointments list, portrait | From `sm` all seven columns showed: 1046px of table in a 687px card. | Service shows from `md` with the provider folded under the client; Provider, Location and Booked show from `lg`. |
| T5 | Staff → Weekly hours with two locations, portrait | The one-row layout (day, from, to, +, location) started at `sm` and needs ~46rem: 818px, the location select off screen. | Phones keep three lines per day; from `md` the day is one line and times + location share the next; the single row waits for `xl`. |
| T6 | Inbox composer and the automation editor's save bar | The composer moved to the bottom edge at `md`, under the tab bar that tablets now have. The automation save bar is `sticky bottom-0`, which would put it under the tab bar wherever it sticks (in practice it doesn't stick on the edit page, see §4). | Both are offset above the tab bar until `lg` (`bottom-16` / `bottom-14 lg:bottom-0`). |

Checked and fine on tablets: the appointment panel (a right-hand panel from `md`, full-size buttons), quick create
(kept on screen, above the tab bar), Month view, the booking flow (calendar beside the times in landscape), sale and
reports pages in one column, the inbox thread, and the menu drawer at 768. After the fixes neither size has a page that
scrolls sideways; wide tables (Reports, Payroll, Audit, Messages, Products bulk edit, the Staff hours week grid) scroll
inside their cards.

Tablet leftovers, fixed in §5: the calendar card buttons, and the touch-only sizes, which were later checked with a touch
pointer (a frame inside the mobile-emulated tab reports `pointer: coarse` at 1024px): small buttons and segmented choices
are 40px there and the card buttons 32px. A pass on a real iPad is still worth doing.

## 4. Left over

Everything the first two passes left over is fixed (§5) except:

- **A pass on a real iPad and iPhone.** Everything here was measured in the built-in browser's emulation. Touch-only sizes
  were checked with an emulated coarse pointer, not on a device, and iOS Safari's own toolbars were not part of the test.
- **Intentional sideways scrolling** inside a box: the developer docs' code samples, the Inventory and Staff sub-tab
  strips, Products → Bulk edit (a spreadsheet editor), and the Staff hours week grid.
- **Tiny links that are hidden until hover** (the developer docs' heading anchors). They are invisible on touch, so they
  were left alone.
- The Next.js dev indicator (the round "N" bottom-left in development) overlaps the first bottom tab. It does not exist in
  production builds.

## 5. Leftovers fixed (same day, third pass)

| # | Where | Problem | Fix |
|---|---|---|---|
| L1 | Text links everywhere: BackLink, "Change", "View", "+1 week", "New client", the booking page's phone / website / Instagram / Gift cards / Privacy / Powered by links, "Start over", the Hours toggle, the booking header pills, the phone top bar's business name, public site header and footer links, the developer docs' Copy buttons, list arrow buttons (services, categories, cancellation and refund reasons, form builder), the picture × button, inbox "Remove picture" | 14–24px tall on a touch screen. | `globals.css`: below `lg` or on a coarse pointer, underlined links and buttons (and anything with the `hit` class) get an invisible hit box 12px above and below and 6px to the sides, so 16px text is a 40px target and nothing moves. Full-row links (`after:inset-0`) and already-positioned elements are left alone. BackLink and the other small controls carry `hit`. Two stacked links that would have overlapped (Time clock QR "Download" / "Open page") now sit side by side. |
| L2 | Appointments switcher | Upcoming / Today / Recently booked / Past scrolled inside itself at 375px. | "Recently booked" reads "New" below `sm` (full label as the tooltip); all four fit. |
| L3 | Reports (11 tables and the category table), Payroll (summary and each person's lines), Audit log, Messages log, Gift cards, Time clock entries, Form submissions, Inventory report (3), Prices by stylist | Scrolled sideways inside their cards on a phone (Reports staff table 869px of content in 341px). | New shared `StackTable` (`components/stack-table.tsx`): below `sm` each row is a small card, the first cell as the title and the rest as "LABEL value" in two columns, with labels taken from the table's own header; from `sm` up it is the same table. The payroll export buttons wrap. |
| L4 | Calendar card Check in / Complete buttons | 22px, in the top corner over the card text. | On a touch screen they are 32px, always shown, in the bottom corner below the title, client and time lines, and only on cards at least 88px tall; shorter cards on touch leave them to the panel (a tap opens it, with full-size buttons). With a mouse nothing changed. |
| L5 | Clients list, appointment panel, calendar hover card | Phone numbers showed as stored (`+17035551024`). | `phone()` in `lib/format.ts` prints US / Canada numbers as "(703) 555-1024" and leaves others alone (unit test `format-phone.test.ts`); `tel:` links keep the stored number. The role-matrix test looks for the printed form. |
| L6 | Sign-in and sign-up | Only checked in code. | Measured signed out (their HTML fetched without cookies and rendered at each width): no sideways scroll, 16px fields and no small targets at 375, 768 and 1024. |
| L7 | Automation editor save bar | Never stuck to the bottom: the card around the form had `overflow-hidden`, which makes it a scroll container. | The card no longer clips; the bar rounds its own corners and sticks above the tab bar until `lg`. |
| L8 | Automation steps (found while checking L7) | At 375px a step's type label ("SEND THE APPOINTMENT REMINDER") ran underneath its move / delete buttons. | Below `sm` the label and the step's summary are two truncated lines; the step's icon buttons are 28px on touch. |
| L9 | Reports "Custom" dates (found while checking L3) | The popover sits inside the period switcher, which scrolls sideways since §1 #6, so the popover would have been clipped; at 375px it also ran off the left edge, and "Custom" wasn't 40px. | Segmented controls that hold a popover don't scroll; the popover wraps and stays on screen; the summary gets the 40px rule. |

After this pass the 151-page scan at 375×812, 768×1024 and 1024×768 still finds no page that scrolls sideways and no field
under 16px on phones and tablets, and the changed pages were re-checked by hand.
