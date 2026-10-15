import type { Metadata } from "next";
import { DocPage } from "@/components/doc-page";
import { API_SCOPES } from "@/lib/api-scopes";
import { Code, Endpoint } from "./doc-kit";

export const metadata: Metadata = { title: "API documentation", description: "Read and manage your Angelic Booking business from your own software." };

const BASE = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.angelicbooking.com"}/api/v1`;

export default function DevelopersPage() {
  return (
    <DocPage title="API documentation" updated="October 14, 2026">
      <p>The REST API lets you read and manage your own business from your own software: a website, a spreadsheet, Zapier, a point-of-sale or an internal tool. It speaks JSON over HTTPS. Every key belongs to exactly one business and can never see another.</p>
      <p>Base URL: <code>{BASE}</code></p>

      <h2>Quick start</h2>
      <ol className="list-decimal space-y-1 pl-5">
        <li>Sign in, open <strong>Settings → API access</strong> and create a key. Only owners (and anyone allowed to change business settings) can.</li>
        <li>Copy the key straight away: it is shown once.</li>
        <li>Send it as a bearer token.</li>
      </ol>
      <Code>{`curl ${BASE}/services \\
  -H "Authorization: Bearer ab_live_your_key_here"`}</Code>

      <h2>Authentication and keys</h2>
      <ul>
        <li>Send <code>Authorization: Bearer &lt;key&gt;</code> on every request. Keys start with <code>ab_live_</code>.</li>
        <li>Use keys from a server you control. Never put one in a web page, a mobile app or a public repository. If one leaks, revoke it in Settings and make another.</li>
        <li>Each key has <em>scopes</em>, the things it may do. A request outside them gets <code>403</code>. Give each tool its own key with only what it needs.</li>
        <li>Keys can expire and can be revoked at any time; revoking takes effect on the next request.</li>
        <li>A suspended business&apos;s keys stop working.</li>
      </ul>
      <table className="w-full border-collapse text-left text-sm">
        <thead><tr className="border-b border-stone-300"><th className="py-1 pr-4">Scope</th><th className="py-1">Allows</th></tr></thead>
        <tbody>{API_SCOPES.map((s) => <tr key={s.scope} className="border-b border-stone-100"><td className="py-1 pr-4"><code>{s.scope}</code></td><td className="py-1">{s.label}</td></tr>)}</tbody>
      </table>
      <p>A <code>:write</code> scope includes the matching <code>:read</code>.</p>

      <h2>Conventions</h2>
      <ul>
        <li><strong>Field names</strong> are <code>snake_case</code>. Money is an integer number of cents. Times are ISO 8601 in UTC (<code>2026-11-02T19:00:00.000Z</code>). Dates are <code>YYYY-MM-DD</code>.</li>
        <li><strong>Lists</strong> return <code>{`{ "data": [...], "page": 1, "limit": 50, "has_more": false }`}</code> and accept <code>page</code> and <code>limit</code> (1 to 100, default 50). Some include <code>total</code>.</li>
        <li><strong>One item</strong> returns <code>{`{ "data": { ... } }`}</code>.</li>
        <li><strong>Partial updates</strong> (<code>PATCH</code>) change only the fields you send. Unknown fields are rejected.</li>
        <li><strong>Request bodies</strong> are JSON with <code>Content-Type: application/json</code>, up to 100 KB.</li>
        <li><strong>Rate limit</strong>: 120 requests per minute per key. Over it, you get <code>429</code> and a <code>Retry-After</code> header (seconds).</li>
      </ul>

      <h2>Errors</h2>
      <p>Errors use the same shape and an HTTP status that matches:</p>
      <Code>{`{ "error": { "code": "validation_failed", "message": "Some fields are invalid.",
             "issues": [{ "path": "first_name", "message": "Too small" }] } }`}</Code>
      <table className="w-full border-collapse text-left text-sm">
        <thead><tr className="border-b border-stone-300"><th className="py-1 pr-4">Status</th><th className="py-1 pr-4"><code>code</code></th><th className="py-1">Meaning</th></tr></thead>
        <tbody>
          {[
            ["400", "bad_request", "The body is not valid JSON, or is too large."],
            ["401", "invalid_api_key", "Missing, wrong, revoked or expired key. All look the same on purpose."],
            ["403", "insufficient_scope", "The key lacks the scope this call needs."],
            ["404", "not_found", "No such item in your business (including ids that belong to someone else)."],
            ["409", "conflict / booking_conflict", "Duplicate client, wrong state, or the time is taken."],
            ["422", "validation_failed", "A field is missing or invalid; see issues."],
            ["429", "rate_limited", "Slow down; wait Retry-After seconds."],
            ["500", "server_error", "Our side. Safe to retry reads."],
          ].map(([a, b, c]) => <tr key={a} className="border-b border-stone-100"><td className="py-1 pr-4">{a}</td><td className="py-1 pr-4"><code>{b}</code></td><td className="py-1">{c}</td></tr>)}
        </tbody>
      </table>

      <h2>Business</h2>
      <Endpoint method="GET" path="/business" scope="catalog:read"><p>Your business&apos;s name, timezone, contact details and slot length.</p></Endpoint>

      <h2>Services, staff and products</h2>
      <Endpoint method="GET" path="/services" scope="catalog:read"><p>Active services. Add <code>?include_inactive=1</code> for all of them. Prices and durations are the base values; a stylist may have their own.</p></Endpoint>
      <Endpoint method="GET" path="/services/{id}" scope="catalog:read" />
      <Endpoint method="GET" path="/staff" scope="catalog:read"><p>Active team members: name, position, bio and photo. Pay, contact details and logins are never included.</p></Endpoint>
      <Endpoint method="GET" path="/staff/{id}" scope="catalog:read" />
      <Endpoint method="GET" path="/staff/{id}/schedule" scope="catalog:read"><p>Weekly hours (24-hour local time, <code>weekday</code> 0 = Sunday), upcoming days off or changed hours, and the services the person performs with any price or length of their own.</p></Endpoint>
      <Endpoint method="GET" path="/products" scope="catalog:read"><p>Active products with price and (when tracked) stock. Cost and supplier are not included.</p></Endpoint>
      <Endpoint method="GET" path="/products/{id}" scope="catalog:read" />
      <Endpoint method="GET" path="/locations" scope="catalog:read"><p>Your sites: address, phone and opening hours. Also <code>/locations/{"{id}"}</code>.</p></Endpoint>
      <Endpoint method="GET" path="/categories" scope="catalog:read"><p><code>?kind=service</code> (default, nested through <code>parent_id</code>) or <code>?kind=product</code>.</p></Endpoint>
      <Endpoint method="GET" path="/packages" scope="catalog:read"><p>The prepaid packages you sell.</p></Endpoint>
      <Endpoint method="GET" path="/membership-plans" scope="catalog:read"><p>The membership plans you sell.</p></Endpoint>
      <Endpoint method="GET" path="/availability" scope="catalog:read">
        <p>Open start times for a service on a date, as online booking would offer them (it follows your booking rules for notice and how far ahead).</p>
        <p>Query: <code>service_id</code>, <code>date=YYYY-MM-DD</code>, optional <code>staff_id</code> (default <code>any</code>).</p>
      </Endpoint>
      <Code>{`curl "${BASE}/availability?service_id=SERVICE_ID&date=2026-11-02" -H "Authorization: Bearer $KEY"

{ "data": [ { "start_at": "2026-11-02T14:00:00.000Z", "staff_id": "…", "staff_name": "Ana" } ] }`}</Code>

      <h2>Changing the catalog</h2>
      <Endpoint method="POST" path="/services" scope="catalog:write">
        <p>Body: <code>name</code>, <code>duration_min</code> and <code>price_cents</code> are required. Optional: <code>description</code>, <code>prep_notes</code>, <code>category_id</code>, <code>gap_min</code>, <code>finish_min</code>, <code>buffer_after_min</code>, <code>deposit_type</code> (<code>flat</code>, <code>percent</code>, <code>full</code>), <code>deposit_cents</code>, <code>deposit_percent</code>, <code>capacity</code>, <code>bookable_online</code>, <code>active</code>, <code>location_ids</code> (empty or all = every site).</p>
      </Endpoint>
      <Endpoint method="PATCH" path="/services/{id}" scope="catalog:write"><p>Send only what changes. Services are never deleted, because past visits point at them: send <code>{`{"active": false}`}</code> to retire one.</p></Endpoint>
      <Endpoint method="POST" path="/products" scope="catalog:write"><p>Required: <code>name</code>, <code>price_cents</code>. Optional: <code>description</code>, <code>kind</code> (<code>retail</code> or <code>backbar</code>), <code>category_id</code>, <code>sku</code>, <code>barcode</code>, <code>cost_cents</code>, <code>taxable</code>, <code>sell_online</code>, <code>track_stock</code>, <code>low_stock_threshold</code>, <code>active</code>. A barcode or SKU can belong to one product only (409).</p></Endpoint>
      <Endpoint method="PATCH" path="/products/{id}" scope="catalog:write"><p>Send only what changes. Stock counts change through stock adjustments, never here.</p></Endpoint>

      <h2>Inventory</h2>
      <Endpoint method="GET" path="/inventory" scope="inventory:read"><p>Products with tracked stock: <code>on_hand</code>, <code>low_stock_threshold</code> and <code>is_low</code>.</p></Endpoint>
      <Endpoint method="GET" path="/products/{id}/stock-movements" scope="inventory:read"><p>Every change to the product&apos;s stock, newest first.</p></Endpoint>
      <Endpoint method="POST" path="/products/{id}/stock-adjustments" scope="inventory:write">
        <p>Body: <code>reason</code> (<code>received</code>, <code>adjust</code>, <code>damage</code>, <code>theft</code>, <code>expired</code>, <code>lost</code>, <code>supplier_return</code>, <code>used</code>), <code>quantity</code>, optional <code>location_id</code> and <code>note</code>. <code>received</code> adds and the loss reasons take away (send a positive number for both); <code>adjust</code> is signed. Stock never goes below zero (409). Returns the new <code>on_hand</code>.</p>
      </Endpoint>

      <h2>Clients</h2>
      <Endpoint method="GET" path="/clients" scope="clients:read"><p>Query: <code>q</code> (name, email or phone search), <code>email</code>, <code>phone</code>, <code>updated_since</code> (ISO time, for syncing). Includes <code>total</code>.</p></Endpoint>
      <Endpoint method="GET" path="/clients/{id}" scope="clients:read" />
      <Endpoint method="POST" path="/clients" scope="clients:write">
        <p>Body: <code>first_name</code> (required), <code>last_name</code>, <code>email</code>, <code>phone</code>, <code>notes</code>, <code>tags</code>, <code>birthday</code>, <code>sms_opt_in</code> (default <code>false</code>), <code>email_opt_in</code> (default <code>true</code>).</p>
        <p>Only set <code>sms_opt_in</code> when the person has agreed to receive texts. If the email or phone is already on file you get <code>409</code> with <code>existing_id</code>.</p>
      </Endpoint>
      <Endpoint method="PATCH" path="/clients/{id}" scope="clients:write"><p>Same fields, all optional; send only what changes. Unknown fields are rejected.</p></Endpoint>
      <Endpoint method="GET" path="/clients/{id}/notes" scope="clients:read"><p>Private notes on the client, pinned first.</p></Endpoint>
      <Endpoint method="POST" path="/clients/{id}/notes" scope="clients:write"><p>Body: <code>body</code>, optional <code>pinned</code>.</p></Endpoint>
      <Endpoint method="GET" path="/clients/{id}/packages" scope="clients:read"><p>Packages the client holds, with sessions remaining.</p></Endpoint>
      <Endpoint method="GET" path="/clients/{id}/memberships" scope="clients:read"><p>Their memberships: status, period end and credits remaining.</p></Endpoint>
      <Code>{`curl -X POST ${BASE}/clients \\
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{ "first_name": "Maya", "last_name": "Lopez", "email": "maya@example.com", "phone": "(212) 555-0142" }'`}</Code>

      <h2>Appointments</h2>
      <Endpoint method="GET" path="/appointments" scope="appointments:read"><p>Client visits (not blocked time), earliest first. Query: <code>from</code>, <code>to</code> (ISO times, matched on the start), <code>status</code>, <code>client_id</code>, <code>staff_id</code>. Includes <code>total</code>.</p></Endpoint>
      <Endpoint method="GET" path="/appointments/{id}" scope="appointments:read" />
      <Endpoint method="POST" path="/appointments" scope="appointments:write">
        <p>Books one service with one staff member. Body: <code>client_id</code>, <code>service_id</code>, <code>staff_id</code>, <code>start_at</code> (ISO 8601 <em>with</em> an offset or <code>Z</code>), optional <code>notes</code>, optional <code>notify</code> (default <code>true</code>: texts or emails the client a confirmation if they have opted in).</p>
        <p>Use <code>/availability</code> first to pick a time. If someone else holds the time you get <code>409 booking_conflict</code>.</p>
      </Endpoint>
      <Endpoint method="PATCH" path="/appointments/{id}" scope="appointments:write"><p>Change <code>status</code> (<code>booked</code>, <code>confirmed</code>, <code>checked_in</code>, <code>in_progress</code>, <code>completed</code>, <code>no_show</code>) and/or <code>notes</code>.</p></Endpoint>
      <Endpoint method="POST" path="/appointments/{id}/reschedule" scope="appointments:write"><p>Body: <code>start_at</code>, optional <code>staff_id</code>, <code>notify</code> (default <code>true</code>). Moves the visit&apos;s service. 409 when the time is taken or outside the provider&apos;s hours.</p></Endpoint>
      <Endpoint method="POST" path="/appointments/{id}/cancel" scope="appointments:write"><p>Body: optional <code>reason</code>, <code>notify</code> (default <code>true</code>). No fee is charged and nothing is refunded; do those in the app.</p></Endpoint>
      <Code>{`curl -X POST ${BASE}/appointments \\
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{ "client_id": "…", "service_id": "…", "staff_id": "…", "start_at": "2026-11-02T14:00:00-05:00" }'`}</Code>

      <h2>Blocked time</h2>
      <Endpoint method="POST" path="/blocks" scope="appointments:write"><p>Take time off a provider&apos;s calendar. Body: <code>staff_id</code>, <code>start_at</code>, <code>end_at</code> (up to 24 hours), optional <code>reason</code>, <code>location_id</code>. 409 if it collides with a booking.</p></Endpoint>
      <Endpoint method="DELETE" path="/blocks/{id}" scope="appointments:write"><p>Remove blocked time. Only blocks: a client&apos;s appointment is cancelled, never deleted.</p></Endpoint>

      <h2>Waitlist</h2>
      <Endpoint method="GET" path="/waitlist" scope="appointments:read"><p>Optional <code>status</code> (<code>open</code>, <code>booked</code>, <code>closed</code>).</p></Endpoint>
      <Endpoint method="POST" path="/waitlist" scope="appointments:write"><p>Body: <code>client_id</code>, <code>service_id</code>, <code>date</code>, optional <code>staff_id</code>, <code>location_id</code>, <code>notes</code>.</p></Endpoint>
      <Endpoint method="PATCH" path="/waitlist/{id}" scope="appointments:write"><p>Body: <code>status</code>.</p></Endpoint>

      <h2>Reviews</h2>
      <Endpoint method="GET" path="/reviews" scope="reviews:read"><p>Submitted reviews, newest first. Optional <code>rating</code> (1 to 5) and <code>staff_id</code>.</p></Endpoint>

      <h2>Sales</h2>
      <Endpoint method="GET" path="/sales" scope="sales:read"><p>Sales, newest first. Query: <code>from</code>, <code>to</code>, <code>status</code> (<code>open</code>, <code>paid</code>, <code>refunded</code>, <code>void</code>), <code>client_id</code>. Includes <code>total</code>.</p></Endpoint>
      <Endpoint method="GET" path="/sales/{id}" scope="sales:read"><p>One sale with its lines and payments. Card details beyond the amount are not included.</p></Endpoint>

      <h2>Security</h2>
      <ul>
        <li><strong>Your business only.</strong> The business is taken from the key and nothing else. An id from another business answers <code>404</code>, exactly as if it did not exist, and the database itself refuses to return other businesses&apos; rows.</li>
        <li><strong>We keep a fingerprint, not your key.</strong> It cannot be shown or recovered; lost keys are replaced, not restored.</li>
        <li><strong>Allow-listed fields.</strong> Pay rates, PINs, private links, payment tokens and Stripe identifiers are never part of any response.</li>
        <li><strong>Audited.</strong> Every change made with a key shows in Settings → Activity log, attributed to the key.</li>
        <li><strong>Limits.</strong> Per-key rate limit, a body size limit and throttled failed sign-ins.</li>
      </ul>
      <p>Found a security problem? Please tell us before you tell anyone else{process.env.SUPPORT_EMAIL ? <>: <a href={`mailto:${process.env.SUPPORT_EMAIL}`}>{process.env.SUPPORT_EMAIL}</a></> : "."}</p>

      <h2>Not in the API yet</h2>
      <p>Taking payments and refunds, gift cards (their codes are as good as cash, so they are not exposed), staff and login management, webhooks, and booking several services in one request. If you need one, tell us.</p>
    </DocPage>
  );
}
