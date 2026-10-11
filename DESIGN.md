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

- Period pickers are one segmented control (Today / 7 days / This month / Custom). Custom opens a small popover
  with the date inputs. Exports live in one "Export" menu.
- Location pills (`LocationFilter`) appear only for businesses with more than one site.
- Filters remember each other when you change one (carry the other query params).

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
  Grow); give the Settings item an `exclude` for it so only one entry lights up.
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

## Checklist before calling a page done

- [ ] One primary action, in the header.
- [ ] Rows clickable everywhere; actions use `rowControl`.
- [ ] Only shared form components; no hand-written inputs, checkboxes, file pickers or disclosures.
- [ ] Occasional controls collapsed; destructive ones behind a quiet link and a confirm.
- [ ] Checked at 375px and at 1280px; nothing wraps around a control or overflows.
- [ ] Empty, loading and error states exist.
