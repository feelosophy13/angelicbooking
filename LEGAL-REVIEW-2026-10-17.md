# Privacy policy and terms of service: brief for the lawyer

Prepared 2026-10-17 for the review that has to happen before salons other than the owner's own join Angelic Booking.
The two pages are `apps/web/src/app/(legal)/privacy/page.tsx` and `.../terms/page.tsx`, served at
https://app.angelicbooking.com/privacy and /terms and linked from sign-up, the booking page footer and every email.
Both are short drafts written by the developer, not by counsel. This brief says what the product actually does, so the
lawyer can decide what the documents must say; the open questions at the end need the owner's answers.

## What Angelic Booking is

- Software as a service for salons and spas, sold to the business (the "salon") on a monthly subscription billed by Stripe
  Billing, with a free trial, a per-month fee for a dedicated text-message number, a per-text usage charge, and an optional
  platform fee (a percentage) on card payments the salon takes through the app.
- The platform is operated by the owner's company (name, entity type and state to be confirmed by the owner) from the US.
  Hosting is on Render (Virginia). Today the only production tenant is the owner's own salon.
- Three kinds of people use it: the salon's **staff** (owner, managers, front desk, providers), the salon's **clients**
  (book online, get texts and emails, sometimes sign in to a client account), and the **platform operator**.

## Data the platform holds, by who it belongs to

**Salon account and staff**: name, email, password hash, optional two-factor secret, Google sign-in identity, role and
permissions, hourly rate, commission rates, pay history and payroll runs (including tax withholding settings typed in by
the salon), time-clock punches, calendar feeds. Payroll figures are computed and exported by the salon; the platform does
not file taxes or pay anyone.

**Clients, entered by the salon or by the client when booking**: name, phone, email, date of birth, appointment history,
notes typed by staff (which can include health-adjacent facts such as allergies or skin reactions: "patch test done, no
reaction"), lash maps, before/after **photos of the client** tied to a visit, with a per-pair "client agreed we can show
these publicly" flag that is a record only (nothing is published automatically), signed intake and consent forms with a
drawn signature, store-credit and loyalty-point balances, referral codes, membership and package purchases, gift cards
bought for or by them, reviews they write.

**Messaging**: every text and email the salon sends a client through the app (reminders, confirmations, marketing
campaigns, two-way text replies) and the client's replies. Texts go out from a toll-free number bought in the salon's name
through Twilio under carrier verification; the booking form has an SMS consent checkbox, STOP/HELP are honoured, and quiet
hours are per location. Marketing texts and emails need the client's opt-in, kept per channel.

**Payments**: cards are handled by Stripe. Each salon connects its own Stripe account (Stripe Connect, Accounts v2); the
platform stores Stripe customer, payment-method and payment-intent identifiers plus brand and last four digits, never card
numbers. Clients' cards can be saved to the salon's Stripe customer for deposits, no-show and late-cancellation fees, with
the agreement recorded at booking. Refunds and store credit are the salon's decisions. The platform fee, when set, is taken
by Stripe as an application fee on the salon's charges.

**Technical**: IP address, user agent and request logs for security and rate limiting, Cloudflare Turnstile on public forms,
unhandled-error reports emailed to the operator (they contain the route and a stack trace, not client data by design).

## Subprocessors (as of today)

Render (hosting and Postgres, Virginia), Stripe (payments, billing, Connect, card readers), Twilio (texts), Resend (email),
Cloudflare (DNS, Turnstile bot check, R2 object storage for pictures once enabled), Google (optional sign-in). No analytics
or advertising trackers.

## What the current pages already say

Privacy: what is collected (account, business, client, payment, technical), that data is used only to run the service,
tenant isolation, a generic subprocessor list, retention while active, export and deletion on request, encryption and
two-factor, a contact address. Terms: account responsibility, that the salon's data belongs to the salon, that card
payments run under the salon's own Stripe account, acceptable use, no uptime guarantee, liability capped at twelve months'
fees, termination, contact.

## Gaps the lawyer should close

1. **Who the contracting entity is.** Neither page names the company, its state or an address. Governing law, venue and
   whether disputes go to arbitration are not stated.
2. **Two audiences, one document.** The salon is the customer; the client is the salon's data subject. The privacy page
   should say clearly that the platform is the salon's processor for client data and that clients should direct requests to
   the salon, and the booking page may need its own short notice for clients (it currently links to the same page).
3. **A data processing agreement with each salon**: roles, instructions, subprocessor list and change notice, breach
   notification timing, deletion on termination, audit rights. Nothing like this exists.
4. **Texting law.** TCPA and CTIA rules: express written consent for marketing texts, what the consent checkbox must say,
   STOP/HELP handling, quiet hours, record keeping. The product does these things; the terms must make the salon responsible
   for the consent it collects and the platform's role plain. The toll-free verification submission (business type, EIN,
   use case, sample messages) also needs to be accurate.
5. **Photos, signatures and health-adjacent notes.** Before/after photos of clients, drawn signatures on consent forms and
   notes about reactions or allergies: retention, consent wording, whether any state treats these as biometric or health
   information, what "OK to share publicly" must say before a salon posts a photo.
6. **Payroll and employment data.** Pay rates, withholding settings, 1099 versus W-2 classification and overtime rules are
   entered by the salon and exported; the terms should say the platform gives no tax, employment or legal advice and the
   salon is responsible for classification and filings.
7. **Money.** Subscription terms (trial, renewal, price changes with notice, refunds, late payment, the platform fee on
   card payments and how it is disclosed), suspension for non-payment and what happens to the salon's data and its clients'
   bookings when an account is suspended or closed. Stripe's own Connected Account Agreement and the platform's obligations
   under it.
8. **State privacy laws.** The product is sold to US salons; if any salon or client is in California, Virginia, Colorado
   and so on, the privacy page needs the rights notices (access, deletion, correction, no sale) and a way to exercise them.
   Note that salon clients include minors in some services.
9. **Retention periods.** Today data is kept while the account is active and deleted on request; nothing states how long
   logs, messages, photos or payroll records are kept after closure, or what the platform keeps for its own legal needs.
10. **Security and breach notification.** What the platform commits to (encryption in transit, hashed passwords, row-level
    isolation, two-factor available) and what it will do and when if there is a breach.
11. **Reviews and public content.** Clients can post reviews and salons can show them; who is responsible for the content,
    takedown, and the salon's right to hide a review.
12. **Client accounts and gift cards.** Gift cards are sold online; state rules on expiry and unredeemed balances, and
    whether the platform or the salon is the issuer, should be stated (the salon is, since the money goes to its Stripe
    account).
13. **Accessibility, age and acceptable use** lines for the public booking page, and a cookie note (the app sets only
    session and preference cookies; no third-party trackers).

## Questions for the owner

- Legal name, entity type, state of formation and address of the operating company.
- Preferred governing law and whether to require arbitration.
- Whether salons outside the owner's state (or outside the US) will be accepted at launch.
- Who the privacy contact is (today `SUPPORT_EMAIL`, the owner's Gmail address).
- Whether a signed DPA is wanted for every salon or only on request.

## After the review

Replace the text in the two page files (they are plain JSX with `<h2>` and `<p>`; keep the `DocPage` wrapper and the
`updated` date), add the booking-page client notice if the lawyer wants one, and record the date in TODO.md. Changes to the
consent checkbox wording live in `apps/web/src/app/book/[slug]/forms.tsx`; the toll-free verification form is under
Settings → Text messaging.
