import type { Metadata } from "next";
import { DocPage } from "@/components/doc-page";
import { API_SCOPES } from "@/lib/api-scopes";

export const metadata: Metadata = { title: "API documentation", description: "Read and manage your Angelic Booking business from your own software." };

const BASE = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.angelicbooking.com"}/api/v1`;

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-lg border border-stone-200 bg-stone-900 p-3 text-xs leading-relaxed text-stone-100"><code>{children}</code></pre>;
}

function Endpoint({ method, path, scope, children }: { method: string; path: string; scope: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs font-semibold">{method}</span>
        <code className="text-sm">{path}</code>
        <span className="ml-auto text-xs text-stone-500">needs <code>{scope}</code></span>
      </div>
      {children ? <div className="mt-2 space-y-2 text-sm text-stone-700">{children}</div> : null}
    </div>
  );
}

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
      <Endpoint method="GET" path="/products" scope="catalog:read"><p>Active products with price and (when tracked) stock. Cost and supplier are not included.</p></Endpoint>
      <Endpoint method="GET" path="/availability" scope="catalog:read">
        <p>Open start times for a service on a date, as online booking would offer them (it follows your booking rules for notice and how far ahead).</p>
        <p>Query: <code>service_id</code>, <code>date=YYYY-MM-DD</code>, optional <code>staff_id</code> (default <code>any</code>).</p>
      </Endpoint>
      <Code>{`curl "${BASE}/availability?service_id=SERVICE_ID&date=2026-11-02" -H "Authorization: Bearer $KEY"

{ "data": [ { "start_at": "2026-11-02T14:00:00.000Z", "staff_id": "…", "staff_name": "Ana" } ] }`}</Code>

      <h2>Clients</h2>
      <Endpoint method="GET" path="/clients" scope="clients:read"><p>Query: <code>q</code> (name, email or phone search), <code>email</code>, <code>phone</code>, <code>updated_since</code> (ISO time, for syncing). Includes <code>total</code>.</p></Endpoint>
      <Endpoint method="GET" path="/clients/{id}" scope="clients:read" />
      <Endpoint method="POST" path="/clients" scope="clients:write">
        <p>Body: <code>first_name</code> (required), <code>last_name</code>, <code>email</code>, <code>phone</code>, <code>notes</code>, <code>tags</code>, <code>birthday</code>, <code>sms_opt_in</code> (default <code>false</code>), <code>email_opt_in</code> (default <code>true</code>).</p>
        <p>Only set <code>sms_opt_in</code> when the person has agreed to receive texts. If the email or phone is already on file you get <code>409</code> with <code>existing_id</code>.</p>
      </Endpoint>
      <Endpoint method="PATCH" path="/clients/{id}" scope="clients:write"><p>Same fields, all optional; send only what changes. Unknown fields are rejected.</p></Endpoint>
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
      <Endpoint method="POST" path="/appointments/{id}/cancel" scope="appointments:write"><p>Body: optional <code>reason</code>, <code>notify</code> (default <code>true</code>). No fee is charged and nothing is refunded; do those in the app.</p></Endpoint>
      <Code>{`curl -X POST ${BASE}/appointments \\
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{ "client_id": "…", "service_id": "…", "staff_id": "…", "start_at": "2026-11-02T14:00:00-05:00" }'`}</Code>

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
      <p>Taking payments, refunds, editing services and products, webhooks, and rescheduling. If you need one, tell us.</p>
    </DocPage>
  );
}
