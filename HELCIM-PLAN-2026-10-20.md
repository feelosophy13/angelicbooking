# Helcim as a second payment processor (plan, 2026-10-20)

The first customer (about $150K a month in cards, mostly in person) wants Helcim. Stripe stays for everyone else. This plan
adds Helcim per business (or per location) without breaking the Stripe paths.

## What the app does with Stripe today

- About 10 server files call the Stripe SDK directly; there is no payment layer. `lib/stripe.ts` only hands out the client.
- Which account takes a payment is decided in one place: `paymentContext*` in `server/locations.ts` (the location's own account,
  else the business's). That is the natural switch point for "Stripe or Helcim".
- Tips are entered in the app before payment (`setTips`), never on the reader, so Helcim's terminal having no tip prompt
  costs nothing.
- Stripe ids live in `businesses` / `locations` (account), `client_stripe_customers`, `appointments` (deposit PI / card hold
  SetupIntent), `payments` (PI, charge, account), `refunds`, membership plans and `client_memberships` (subscriptions).
- Disputes are alert-only (email + audit log); payouts are left to the processor's own dashboard. Both carry over unchanged in
  spirit.

| Flow | Stripe today | Helcim equivalent |
|---|---|---|
| Account signup | Connect v2 account + onboarding link | Integration Partner Program: salon signs up on Helcim's hosted form via our partner link; the merchant `api-token` arrives by webhook on approval. Or the salon pastes an API token from its existing Helcim account. |
| In-person card | Terminal JS + `card_present` PaymentIntent | Payment Hardware API: `POST /devices/{code}/payment/purchase` to a Smart Terminal; result by `cardTransaction` webhook (id only, then fetch) or `terminalCancel` |
| Card at the desk / online | CardElement / Payment Element | HelcimPay.js modal (purchase, preauth, verify) |
| Save a card (booking hold, "save card") | SetupIntent / `setup_future_usage` | HelcimPay.js **verify** ($0) returns a `cardToken` tied to a Helcim customer |
| No-show / late-cancel fee, late tip | off-session PaymentIntent | Payment API purchase with `cardToken` (needs `ipAddress`, `idempotency-key`) |
| Deposit at booking | PaymentIntent | HelcimPay.js purchase |
| Store order (authorize, capture after stock check) | `capture_method: manual` | Payment API preauth, then capture within 7 days |
| Refund | Refund on the PI | Payment API refund (credit); debit refunds on the device |
| Membership auto-renew | Stripe Subscriptions + invoice webhooks | App-run renewals: a daily job charges the saved `cardToken` (simpler and identical across processors than Helcim's Recurring API) |
| Disputes | `charge.dispute.created` → email | No webhook documented: Helcim emails the merchant; the app links to Helcim's dashboard |
| Payouts | Salon's Stripe dashboard | Salon's Helcim dashboard |

## Phases

**0. Day one, no integration (hours).** Add a "Card (own terminal)" payment type. The salon starts on a standalone Helcim
Smart Terminal and records each card payment in the app with amount and tip, so sales, reports and payroll tips stay right.
Saved-card features (no-show fees, deposits) stay on Stripe or pause for her until phase 3.

**1. Processor switch and storage (2–3 days).**
- `businesses` / `locations`: `payment_provider` (`stripe` | `helcim`, default `stripe`), `helcim_api_token` (encrypted at rest),
  `helcim_connected_account_id`, `helcim_status`.
- `payments` / `refunds`: `provider` plus `provider_payment_id` / `provider_refund_id` (keep the Stripe columns; new rows fill both).
- `client_helcim_customers` (client, account) → Helcim `customerCode`, mirroring `client_stripe_customers`.
- `server/payments/` with one small interface per flow (charge in person, charge saved card, open online checkout, refund,
  settle from webhook) and two implementations; callers ask `paymentContext*` which one applies. Stripe code moves behind it
  unchanged, so the Stripe suite is the safety net.
- Settings → Payments: choose Helcim, connect via the partner link (or paste a token), see status.

**2. In-person on Helcim (3–5 days).** Pair Smart Terminals per location (Payment Hardware API device code), "Charge on
terminal" at checkout sends the sale's card share (tips included) with `invoiceNumber` = our payment id, webhook
`/api/helcim/webhook` (HMAC check, dedupe in `webhook_events`) fetches the transaction and runs the existing settle path;
`terminalCancel` frees the sale. Polling fallback when a webhook is late. Refunds through the Payment API.

**3. Online and saved cards on Helcim (5–8 days).** HelcimPay.js in the booking form (deposit or $0 verify card hold), the
store (preauth / capture and the orphan sweep), and desk card entry; saved-card charges for no-show fees and late tips;
client portal lists and removes Helcim cards.

**4. Memberships (2–3 days).** App-run renewal job for Helcim businesses (charge, retry, freeze, cancel), same statuses the
Stripe webhooks set today.

**5. Hardening.** Tests per flow against Helcim's developer account, an idempotency key per attempt, the partner-token on every
request (revenue share can't be reconciled later), runbook in docs-ops.md.

## Before any code: what we need from Helcim

1. Integration Partner Program signup → `partner-token`, partner `api-token`, revenue-share terms.
2. A developer test account (tier2support@helcim.com) and a Smart Terminal (GEN2) for testing in-person.
3. Answers: how merchant-initiated charges on saved cards are flagged (no-show fees); dispute webhook or API, now or planned;
   test environment for partner signups (today every test signup is a real account); Apple Pay in HelcimPay.js; whether the
   salon's existing saved cards can be imported; her interchange-plus quote.

## Risks

- The salon's clients' cards saved on Stripe don't move to Helcim by themselves; until imported, existing no-show protection stays
  on Stripe or the cards are re-collected at the next visit.
- Webhooks carry only an id, so every event costs an API call; Helcim retries for about ten hours, so the handler must be idempotent.
- Disputes become less visible in the app than on Stripe.
