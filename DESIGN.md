# Design guide

How every screen in Angelic Booking should look and behave. Read this before adding or changing a page. The
components it names live in `apps/web/src/components/`. When a rule here and an existing page disagree, the page is
wrong: fix the page.

## Principles

1. **Simple first.** A page shows what the desk uses every day and nothing else. Occasional controls open on demand.
2. **One primary action per page**, in the header, on the right, brand-coloured. Everything else is secondary (white)
   or quiet (ghost/link).
3. **The thing is the control.** Rows open when clicked anywhere, pictures open the file picker, status chips are
   buttons where they can be. Don't make people hunt for the one underlined word.
4. **Consistent means one component.** Shared pieces live in `components/ui.tsx` (client), `components/form.tsx`,
   `components/row.tsx`, `components/disclosure.tsx`, `components/image-field.tsx`. If two pages need the same control, there is one component for it. Never
   hand-write a checkbox, a list row, a disclosure or a file input.
5. **Calm by default.** White cards on the stone background, 1px stone borders, generous spacing, small grey helper
   text. Colour is for state (status badges, the brand button, red for destructive) and nothing else.

## Page anatomy

- `PageHeader` with the title on the left and at most two actions on the right. The primary action is
  `LinkButton variant="primary"` (or `Button`). A back link (`BackLink`) sits above the title on sub-pages. It
  returns to the page the person actually came from (and reads "Back"); only when there is no such page, such as
  a bookmark or a new tab, does it go to the hard-coded parent and show that page's name. Never hand-write a
  back link.
- Content is a `Card` (or a few). Cards have a 1px border and no heavy shadow. Don't nest cards.
- Two-column detail pages use `grid gap-6 lg:grid-cols-[1fr_360px]`: the main object left, actions and context right.
  On a phone the right column follows the left; the primary action must be reachable without scrolling past
  secondary panels.
- Full width by default. Only forms are capped (`FormPage`, `max-w-2xl`); lists and tables never are. A form
  keeps the default width unless it has at most three fields (`width="max-w-md"`) or is a builder with its own
  table (`max-w-3xl`). Never pick a width per page by taste.
- New and edit forms for the same thing share one fields component (`ProductFields`, `PackageFields`,
  `ServiceFields`, `PlanFields`): the page supplies the record (or nothing) and the submit button. Two copies drift.
- Choosing a location uses `LocationSwitch` (via `LocationFilter` on list pages and the calendar's `LocationPills`):
  buttons up to three sites, one dropdown from four, a search box in it from eight. Never lay out one button per
  site by hand; it stops fitting around the fourth.
- Money is typed in `MoneyInput` (currency symbol, decimal keypad, `0.00` placeholder), never a bare `Input`.
- Validation errors appear under the field, worded for a person. The red banner at the top is only for errors no
  field on the page can show. Leaving a form with unsaved edits asks first (`ActionForm` does this).

## Lists and tables

- Every row that opens something is clickable everywhere, not just on its name. Use `rowClass` on the `<li>` or
  `<tr>`, `RowLink` for the primary text, and `rowControl` on any button, form or secondary link inside the row
  (all from `components/row.tsx`, which is server-safe). Table rows use `LinkRow` from `components/table-row.tsx`
  instead, with a plain `Link` on the name. The row tints on hover.
- Row layout: optional thumbnail or avatar, then name (medium) over one line of grey meta in a `min-w-0 flex-1`
  block, then the value in a fixed right-aligned column (`w-28 shrink-0 text-right tabular-nums`) so prices line up
  down the list, then quiet actions. Actions are ghost buttons; the destructive one is last and uses `ConfirmSubmit`.
- Keep one per-row action visible at most two; anything else goes on the detail page.
- Long lists get search, filters and paging (see Clients). Caps like "newest 50" are bugs.
- Empty states use `Empty` with a one-line title, a short why/how line, and the primary action when there is one.

## Forms

- `ActionForm` + `Field` for every form. `Field` owns the label, hint and error; never add your own label.
- Inputs: `Input`, `Select`, `Textarea` (defaults to four lines, resizable), `Checkbox` (box aligned to the first
  line, hint underneath), `ImageField` (click the picture to pick, preview in place, an × on the picture corner removes it, with Undo).
- Pictures: the picture is the control. Click it to pick or change the file, and a small round (x) on the
  picture's top-right corner removes it (with Undo in the helper line). Never a "Remove" text link or button
  beside the picture. `ImageField` does this; use it for every photo, logo and image.
- Group related fields in a two-column grid on wide screens; one column on phones.
- Show only the fields that apply. When a choice changes what matters (pay model, trigger type), the other fields
  hide, and rarely-used ones sit under "More options".
- One save button per form, at the bottom, labelled with what it saves ("Save profile", "Block this time"). Pending
  text on every submit (`SubmitButton`).
- Validation errors appear next to the field and in a banner at the top; success is a toast. Errors never
  auto-dismiss.

## Progressive disclosure

- `Disclosure` (collapsed card with a title and optional hint) for secondary panels: add a service to a visit,
  discount or promo code on a ticket, edit client details, the clock-in PIN, export menus.
- A disclosure opens itself when it already holds something (a discount is applied, a filter is set).
- Destructive flows (cancel appointment, delete) start from a quiet link that reveals the reason field and the red
  confirm button, never from a red button sitting on the page.
- Setup and onboarding help is one line with a "show steps" affordance and a way to hide it for good.

## Toolbars and filters

- A page with two ways to look at the same data (Staff hours: People or Coverage) gets one segmented control in the card header,
  as links that set `?view=` and keep the other filters. The simpler answer is a view of its own, not a second page.
- Period pickers are one segmented control (Today / 7 days / This month / Custom). Custom opens a small popover
  with the date inputs. Exports live in one "Export" menu.
- Location pills (`LocationFilter`) appear only for businesses with more than one site.
- Some pages only make sense for one site at a time (Staff hours: hours, rotations and coverage differ by site). There
  `LocationFilter` gets `allLabel={null}`, which removes the "All" choice, and the page falls back to the main site.
- Filtering by service follows "Choosing a service" below; a *category* filter (a short list) is a plain select.
- Filters remember each other when you change one (carry the other query params).
- A filter made only of choices (selects, switches) applies the moment it changes: wrap it in `AutoSubmitForm`
  and give it no Apply or Check button (Staff hours coverage). A filter with a text box keeps an explicit Apply.

## Choosing a service

A menu can have hundreds of services, so a flat dropdown of them is overwhelming. Wherever someone picks or filters by a
service, use `ServicePicker` (`components/service-picker.tsx`): one field that opens a searchable list grouped by category
path ("Lash Extensions › Classic"). Build its groups with `serviceGroups(business, opts)` (`server/service-groups.ts`).

- **How the list reads:** each category is a header bar showing its own name, indented by depth (a tree: Lash Extensions, then Classic and Hybrid
  one step in), with its services indented one step further. Groups come in the order of the Services page, not alphabetically. While the
  user is searching, the list is only a slice of the tree, so headers drop the indent and show the full path ("Facial Treatments › **Core Facials**"). Where whole categories can be chosen, the header itself is the button and carries an "All" chip;
  never repeat the category as an "All of …" row inside the group. "Any service" / "None" is the first row.
- **Never** map a services list into `<option>`s. A test (`lib/__tests__/service-select-guard.test.ts`) fails if you do. The one
  exception is a list that is naturally short, such as group classes; add it to that test's allowlist with the reason.
- **Toolbars and filters:** pass `compact` and `noneLabel="Any service"` (it shows as a normal value, not a grey placeholder).
  Offer every category and service, never only the ones that already have data: a filter that hides options with nothing behind
  them is empty on a new business and cannot be chosen before the first record exists. (An empty result says "No photos match".)
- **Forms:** `noneLabel` adds a "None" row for optional services; `meta` shows duration and price, or `"none"` where they add nothing.
- **Reacting to the pick:** `submitOnPick` submits the surrounding form; `onPick(id)` is for controlled uses such as the embed
  builder's live preview. Inside an `AutoSubmitForm` nothing extra is needed: the pick fires a `change` event.
- **A whole category** is chosen in the same field: build the groups with `serviceGroups(business, { categories: true })` and each category
  gets an "All of <category>" row (value `c:<id>`, including a category that only holds sub-categories). The page reads `c:` as the category
  and everything under it (`subtreeIds`); the Gallery does this. A page that only ever filters by category (Staff hours coverage) keeps a plain
  select, indented by depth, because that list is short.
- **Meaning on each page.** Appointments: visits that include the service (or any service in the category), found through any of
  their services. Reports: sales that include it, with every line on those sales counted; what is not split by service (pay, store
  credit, refund reasons, referrals, stock) is hidden while the filter is on, and a line under the date says so. The CSV exports follow
  the same filter. The value is `lib/service-scope.ts` (`parseScope`) on the way in and `serviceIdsInScope` on the server.

## Calendar week view

The calendar header is the same in Day, Week and Month (view toggle, previous / name / next, Block time, New appointment), so nothing in it moves when the
view changes; the button back to now is named for the view (Today, This week, This month) and quiet when you are already there. Controls that only one view
has go in a row below the header, not in it.

The week opens on "Everyone (overview)" (`?staff=all`, also the default), and the picker beside the view toggle switches to one stylist's week in full
(`?staff=<id>`); it applies on change. The overview is for seeing the shape of the week, not for reading it: appointments are plain blocks
in the stylist's colour, with a colour legend above the grid and no text, no buttons and no processing labels on them. Everything else comes from hovering
(the hover card) or clicking (opens the visit). Cards still carry an `aria-label` so screen readers read what sighted users get from hovering.

## Roles on the calendar and appointments

- **Any or own, and the owner chooses which.** Each kind of appointment action has an "any" permission (Manager, Front desk) and an "own" one, which covers only
  appointments the person is booked on and needs their login linked to a staff member. The kinds: *see* (`read`), *update* (`write`: status, notes, photos, checkout),
  *change the booking* (`change`: add, remove, move services, drag), *cancel* (`cancel`: cancel, no-show and late fees, end a series) and *book* a new one
  (`book`: on their own calendar only). A Provider gets see and update by default; the other three are off, and the owner switches each on under Roles & permissions
  (or on a custom role). `lib/appointment-access.ts` is the rule; pages and actions call `requireAppointmentAccess(slug, id, mode)` / `requireBookingAccess`
  (server/appointment-access.ts), never "any" directly. Blocking time (`block`: lunch, time off, "do not book") on their own calendar is one more of these. When a new capability could reasonably be wanted for a Provider but not always, make it a permission like these.
- **Built for many businesses: never decide behaviour from a role's name.** Each business makes up its own roles ("Stylist", "Assistant"), and "Provider" is only the name of one default. Ask what the role
  can do: `can(permissions, action)`, `worksOwnCalendar(permissions)` (can see their own calendar but not everyone's), `seesOwnOnly`. Built-in names appear only where the defaults are defined and
  seeded; a test fails on `role === "provider"` and the like.
- **Adding a capability:** add the `own` action to `ACTIONS` and `PERMISSION_GROUPS` (`packages/core/src/permissions.ts`), add a row to `APPOINTMENT_CAPABILITIES` (the "any" action covers Manager and Front desk),
  leave it off in `DEFAULT_ROLE_PERMISSIONS`, then gate the page and action through the access helpers. The table-driven test covers every row. Stored roles are not rewritten, so existing businesses opt in under Roles.
- **A Provider's calendar is their own:** their column and their appointments, in every view, with no staff picker. A role with neither calendar permission sees a note
  instead. A login not linked to a staff member sees a note saying so. Controls a Provider lacks the permission for are hidden, not shown disabled.
- **Revenue is for people who can see reports.** The day strip's "Expected" figure shows only with the reports permission.
- **Testing roles in development.** The amber "Dev · View as" pill (bottom right, development only, never in production or on Render) shows the app as another role, and for
  a Provider as a particular stylist. It changes `requireBusiness`, so every menu, page and permission check behaves exactly as that role would get.

## Calendar hover card

Hovering an appointment on the calendar (or tabbing to it) shows a card after a short pause: client and phone, status, every service on the visit with who
does it, when and what it costs, how it was booked, the deposit, "Forms due", tags and the visit's notes. Blocked time shows its reason; a class shows
its seats. The content is built on the server (`lib/calendar-tip.ts`) and drawn on the page, beside the appointment, so the scrolling grid never clips it;
it ignores the mouse so it cannot get in the way of dragging, and it is not shown on touch screens, where a tap opens the visit. The quick check-in and complete buttons on a card need about 6rem of width (a container query on the card); the week view packs every stylist into one column, so its narrow cards show no buttons. Add new facts to
`buildTip`, not to the card markup.

## Navigation and findability

- Every page has one home in the sidebar. The sidebar, the Settings directory and the ⌘K page list are all built
  from `lib/nav.ts`; add a page there and it is findable everywhere at once. Never hand-list pages elsewhere.
- A page that serves two jobs is reached from both, by a cross-link where the second job happens, not by a
  second sidebar entry. Staff hours and time off live under each person (edit) and on Schedule → Staff hours
  (overview); Marketing opens with cards for Automations, Loyalty and Review requests; Payroll, Sales and
  Reviews link to the matching report slice with their period and location carried over.
- A single cross-link is quiet (`text-sm text-brand-700 underline` in the page header). A hub that points to
  several related pages uses a row of small link cards (title + one line) above its own content, so the links
  read as part of the page rather than fine print. Never a second primary button.
- A Settings page may also have a sidebar entry when it is a daily tool rather than setup (Loyalty & referrals under
  Grow, Roles under People, shown only to people who can manage members); give the Settings item an `exclude` for it so only one entry lights up.
- A sidebar entry must be self-explanatory in its group. If it needs a sentence to justify where it sits (Forms
  under People), it does not belong there: leave it in Settings and rely on cross-links and ⌘K.
- A sidebar item lights up only for its own pages: pass `exclude` when a sub-path belongs to another item
  (Staff excludes Staff hours).

## Status, colour and type

- Brand purple for the primary action, links and focus rings. Stone greys for everything structural. Emerald for
  done/paid, amber for warnings and "forms due", red only for destructive actions and failures, sky/violet for
  calendar states via `StatusBadge`.
- Closed or unavailable time is hatched: the `hatched` utility (slanted 135° stripes on stone-50), the same on
  the calendar's off-hours, the coverage grid's closed hours and any future time grid. Never a flat grey block,
  and never a second stripe pattern.
- Body text 14px (`text-sm`), helper text 12px (`text-xs text-stone-500`), section labels
  `text-xs font-semibold uppercase tracking-wide text-stone-500`. Never below 11px, never grey-on-grey below AA
  contrast (`text-stone-400` is for disabled or decorative only).
- Numbers right-aligned in tables and totals; money via `formatMoney` with the business currency.

## Feedback

- Toasts (`setFlash`) for successes and for errors from plain form actions; inline `Notice` for errors in
  `ActionForm`s. Say what happened in plain words ("Profile saved", "Time blocked"), not "Success".
- Confirm before anything that cannot be undone, in a `ConfirmSubmit` dialog that names the thing
  ("Remove Sterling?").
- Links to another part of the app use its sidebar name ("Staff → Weekly hours").

## Mobile

- Everything works at 375px: no horizontal scroll except inside a table wrapper, 44px tap targets for row
  actions, the bottom tab bar for Calendar / Clients / Sales / Staff.
- Tables with many columns collapse to stacked rows below `sm`, or keep only the two columns that matter.

## Copy

- Sentence case everywhere ("New appointment", not "New Appointment"). Short labels, no jargon, no exclamation
  marks. Hints explain consequences ("Nothing is charged at booking; the card is kept for no-show fees").
- Name the person or thing, not the record ("Ava's hours", "Sale #1006").

## Images and uploads

Every uploaded picture is optimized before it is stored. This is a rule, not a preference.

- **One door.** Upload code calls the helpers in `lib/files.ts` (`storeImage`, `uploadedImageFrom`, `storeFormFile`,
  `storeSignaturePng`), which all run `optimizeUpload` from `lib/images.ts`. Never write upload bytes to the
  `files` table or to object storage yourself, and never store the browser's original. A test
  (`lib/__tests__/upload-guard.test.ts`) fails if another path does.
- **What the door does.** JPEG, PNG, WebP and GIF are resized to web size (longest side 1600 px; covers and form
  photos 2000; logos and staff photos 800) and re-encoded as WebP. Animated GIFs stay animated. EXIF data, including
  the camera's GPS location, is removed. Drawn signatures become small palette PNGs. A picture is never enlarged.
- **The only exceptions** are types that cannot be shrunk here, stored as sent: SVG (capped at 512 KB), PDF, and
  HEIC. If a new kind of upload appears, add it to `optimizeUpload`, not around it.
- **Visit photos** go through `storeVisitPhoto` (full size 2000 px plus a 640 px thumbnail), JPEG, PNG or WebP only.
- **New kinds of picture.** Add the kind to `storeImage`, give it a size in `MAX_SIDE` if 1600 px is wrong, and add
  it to `MOVABLE` in `server/files-to-r2.ts` so the R2 migration covers it.
- **Showing pictures.** Use the address the helper returned (the CDN address when R2 is on). Set `width` and `height`
  or a fixed aspect box so the page does not jump, and `loading="lazy"` below the fold.
- **Pickers.** Use `ImageField` (see Forms). It already restricts the file type; the server enforces the rest.

## Before and after photos, and the Gallery

- **Tied to the appointment.** A before/after pair describes one visit, one service and one stylist, so photos hang
  off the appointment (`visit_photos`: appointment, client, service, stylist, phase, tags, consent). The client's
  profile and the Gallery are views over the same rows; nothing is stored on the client.
- **A pair** is every photo of one appointment, service and stylist (`pairKey` in `lib/visit-photos.ts`). Tags and the
  "client agreed we can show these publicly" consent are set once per pair and shared by its photos. Consent is a
  record only: nothing is published automatically.
- **Adding photos** is `PhotoAdd` (`components/photo-add.tsx`): tap the tile, take or choose photos, they upload at
  once with no Save step. It is the one multi-photo control; single pictures still use `ImageField`. The Photos card
  lives on the appointment page under Notes, one Before and one After strip per service on the visit.
- **Private by design.** Visit photos are stored as private kind `visit` (private bucket), served through
  `/api/files/<id>` for signed-in members only, never cached. Each photo has a small thumbnail (640 px) for grids.
- **The Gallery** (sidebar, People) shows pairs newest first as `PairCard`s; clicking one opens both photos large.
  Filters follow the Toolbars rules: service, stylist, tag, time, client name, "Before and after" only, "OK to
  share", plus location pills for multi-site businesses. Filters live in the query string so a filtered view can be
  linked, and the client page links to the Gallery with `?client=`.
- **Elsewhere** show pairs with `PairCard` and `pairViews`; do not draw your own photo grid.

## Inventory

- **One place changes stock.** Every change goes through `applyMove` in `server/inventory.ts`: it writes the history row, the location's count and the product's total together. Nothing else may write
  `stock_movements` or `product_stock` or touch `stock_qty` (a test enforces it). The total always equals the sum of the locations.
- **Refunds don't restock.** Money back is not goods back (never arrived, goodwill). A client's return is recorded on purpose, on the sale ("Goods back on the shelf"), capped at what the sale took off.
- **A sale is never stopped by a wrong count.** The register says "only N in stock" and carries on; the count may go negative and is called "Count is off" (never "-2 in stock"). By hand (write-off, transfer) stock can't go below zero.
- **Reasons are words** (`MOVEMENT_REASONS`): received, sold, returned, used in services, adjusted, counted, damaged, stolen, expired, lost, sent back, transferred, opening. Add a reason there, not inline.
- **Back-bar is a kind of product** (`kind = "backbar"`): counted, ordered, never sold (not in the register, not online). Services list what a visit uses; closing the sale takes it off.
- **Used in services is separate from sold.** A product of either kind can be on a service's "Products used" list, and a retail product can be both (one stock; the report shows sold and used apart). Each row is either taken off automatically at checkout (whole units) or logged by staff, who type what they actually used; never guess fractions per visit. Logging goes against the visit's location and may leave a count negative rather than stop the work.
- **Settings rows save as you change them** (`AutoSaveForm`, with a toast), like "Products used" on a service: no per-row Save button, and "Remove" is its own button (an amount of 0 never deletes).
- **Every movement keeps its unit cost** (`unit_cost_cents`), so cost of goods sold and supplies used don't change when a price later does.
- **Options are the same name plus a label** ("Color Gel · 7N"), each with its own stock, price and barcode. Show `productLabel(p)` everywhere a product is named.
- **Alerts are per location.** Each location is judged on its own count (`locationAlerts`): twelve at the main site doesn't hide none downtown. A location with none that hasn't sold or used the product in 90 days and has none coming is "not stocked here" and stays quiet. Reorders are per location too, so the order is delivered where it is needed.
- **Alerts say what to do, once.** The sidebar badge counts products that are out, low or off. The daily email leaves out products already covered by an order on its way.
- **Permission:** `inventory.manage` for everything under Inventory and for changing stock; the catalog itself (name, price, options) stays `services.manage`.

## Checklist before calling a page done

- [ ] One primary action, in the header.
- [ ] Rows clickable everywhere; actions use `rowControl`.
- [ ] Only shared form components; no hand-written inputs, checkboxes, file pickers or disclosures.
- [ ] Occasional controls collapsed; destructive ones behind a quiet link and a confirm.
- [ ] Checked at 375px and at 1280px; nothing wraps around a control or overflows.
- [ ] Empty, loading and error states exist.
- [ ] Any upload goes through `lib/files.ts` so it is optimized (see Images and uploads).
- [ ] Service choices use `ServicePicker`, never a long `<select>` (see Choosing a service).
