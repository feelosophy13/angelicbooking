import { Endpoint } from "../doc-kit";

/** Settings: profile, booking rules, loyalty, store, reviews, text wording, locations and refund reasons. Mounted by the developers page. */
export function SettingsDocs() {
  return (
    <>
      <h2>Settings</h2>
      <p>Each section below can be read with <code>settings:read</code> and changed with <code>settings:write</code>. A PATCH takes only the fields you send; the rest stay as they are, and unknown fields are rejected with <code>422</code>. Money is in cents. Payments (Stripe), sales tax, the custom domain, the texting number, billing and image uploads are not in the API: set those up in the staff app.</p>

      <h2>Business profile</h2>
      <Endpoint method="GET" path="/settings/profile" scope="settings:read">
        <p>What the public booking page shows: <code>tagline</code>, <code>about</code>, <code>brand_color</code> (<code>#rrggbb</code>; <code>null</code> = the default violet), <code>website</code>, <code>instagram</code> (handle), <code>hours_text</code> (free text), plus <code>logo_url</code> and <code>cover_url</code> (read only: upload them in the app).</p>
      </Endpoint>
      <Endpoint method="PATCH" path="/settings/profile" scope="settings:write">
        <p>Any of <code>tagline</code> (up to 120), <code>about</code> (1500), <code>brand_color</code>, <code>website</code> (a full <code>http(s)</code> address), <code>instagram</code> (a handle or an instagram.com link; stored as the handle), <code>hours_text</code> (600). Blank or <code>null</code> clears a field.</p>
      </Endpoint>

      <h2>Booking rules</h2>
      <Endpoint method="GET" path="/settings/booking" scope="settings:read" />
      <Endpoint method="PATCH" path="/settings/booking" scope="settings:write">
        <p>Fields: <code>online_booking_enabled</code>, <code>require_card_online</code>, <code>client_accounts_enabled</code>, <code>min_notice_min</code> (0 to 10080), <code>max_advance_days</code> (1 to 365), <code>cancel_window_hours</code> (0 to 168), <code>no_show_fee_cents</code>, <code>late_cancel_fee_type</code> (<code>none</code>, <code>flat</code>, <code>percent</code>), <code>late_cancel_fee_value</code> (cents for <code>flat</code>; basis points for <code>percent</code>, so <code>2500</code> = 25%, at most <code>10000</code>), <code>late_cancel_deposit</code> (<code>toward</code> or <code>extra</code>), <code>deposit_refund_as</code> (<code>original</code> or <code>store_credit</code>), <code>booking_policy</code> (up to 1000), <code>address_line</code> (up to 200).</p>
        <p>These are settings only; nothing is charged by changing them. A fee type other than <code>none</code> needs a value above zero (<code>422</code>); setting the type to <code>none</code> clears the value.</p>
      </Endpoint>

      <h2>Loyalty</h2>
      <Endpoint method="GET" path="/settings/loyalty" scope="settings:read" />
      <Endpoint method="PATCH" path="/settings/loyalty" scope="settings:write">
        <p>Fields: <code>enabled</code>, <code>points_per_dollar</code> (0 to 100), <code>points_per_visit</code> (0 to 10000), <code>point_value_cents</code> (1 to 1000: what one point is worth when redeemed), <code>min_redeem_points</code> (1 to 100000), <code>referral_bonus_points</code> and <code>referral_friend_bonus_points</code> (0 to 100000). Client balances cannot be changed through the API.</p>
      </Endpoint>

      <h2>Online store</h2>
      <Endpoint method="GET" path="/settings/store" scope="settings:read" />
      <Endpoint method="PATCH" path="/settings/store" scope="settings:write"><p>Fields: <code>store_enabled</code>, <code>gift_cards_online</code>, <code>shipping_flat_cents</code> (0 = pickup only).</p></Endpoint>

      <h2>Reviews</h2>
      <Endpoint method="GET" path="/settings/reviews" scope="settings:read" />
      <Endpoint method="PATCH" path="/settings/reviews" scope="settings:write"><p>Field: <code>google_review_url</code>, a full <code>http(s)</code> address, or <code>null</code> to remove it.</p></Endpoint>

      <h2>Text message wording</h2>
      <Endpoint method="GET" path="/settings/notifications" scope="settings:read">
        <p>The wording of each text: <code>templates</code> keyed by <code>confirmation</code>, <code>reminder</code>, <code>rescheduled</code>, <code>cancellation</code>, <code>forms_nudge</code>, <code>review_request</code>, each <code>{`{"text": "…", "is_default": true}`}</code>, and the <code>placeholders</code> you can use (such as <code>{"{first_name}"}</code>).</p>
      </Endpoint>
      <Endpoint method="PATCH" path="/settings/notifications" scope="settings:write">
        <p>Body: <code>{`{"templates": {"reminder": "…"}}`}</code>. Send only the templates you want to change (up to 500 characters each); <code>null</code> or an empty string puts one back to the default. Other templates keep their wording. This changes the wording of future texts only; it sends nothing.</p>
      </Endpoint>

      <h2>Locations</h2>
      <p>Reading locations (<code>GET /locations</code>, <code>GET /locations/{"{id}"}</code>) needs <code>catalog:read</code>. Changing them needs <code>settings:write</code>. Each location: <code>id</code>, <code>name</code>, <code>address_line1</code>, <code>address_line2</code>, <code>city</code>, <code>state</code>, <code>postal_code</code>, <code>country</code>, <code>timezone</code>, <code>phone</code>, <code>hours</code>, <code>is_default</code>. Payment accounts and sales-tax rates are managed in the app and cannot be read or changed here.</p>
      <Endpoint method="POST" path="/locations" scope="settings:write">
        <p>Required: <code>name</code> (1 to 80). Optional: <code>address_line1</code> (120), <code>city</code> (60), <code>state</code> (40), <code>postal_code</code> (20), <code>phone</code> (30), <code>timezone</code> (an IANA name from the list the app offers, such as <code>America/Chicago</code>; <code>null</code> = the business&apos;s), <code>hours</code>: an object keyed by weekday <code>&quot;0&quot;</code> (Sunday) to <code>&quot;6&quot;</code>, each <code>{`{"open": "09:00", "close": "17:00"}`}</code> or <code>null</code> for closed (a missing day is closed; <code>open</code> must be before <code>close</code>). Returns <code>201</code>.</p>
      </Endpoint>
      <Endpoint method="PATCH" path="/locations/{id}" scope="settings:write"><p>Same fields, all optional.</p></Endpoint>
      <Endpoint method="POST" path="/locations/{id}/default" scope="settings:write"><p>Makes this the default location (the one used when nothing else says where).</p></Endpoint>
      <Endpoint method="DELETE" path="/locations/{id}" scope="settings:write">
        <p>Removes a location. <code>409</code> for the default location, for the only location, and for a location that has its own payment account (remove that in the app first). Hours, staff and past visits that pointed at it are kept without a location.</p>
      </Endpoint>

      <h2>Refund reasons</h2>
      <p>The short list of causes a refund can be filed under. Recording a refund is not in the API; this only manages the list.</p>
      <Endpoint method="GET" path="/refund-reasons" scope="settings:read"><p>In display order, retired ones included (<code>active: false</code>); add <code>?active_only=1</code> to hide them. Each: <code>id</code>, <code>name</code>, <code>sort_order</code>, <code>active</code>, <code>created_at</code>. A business starts with six default reasons.</p></Endpoint>
      <Endpoint method="POST" path="/refund-reasons" scope="settings:write"><p>Body: <code>name</code> (1 to 60). Added at the end. Returns <code>201</code>.</p></Endpoint>
      <Endpoint method="PATCH" path="/refund-reasons/{id}" scope="settings:write"><p>Any of <code>name</code> and <code>active</code> (<code>false</code> retires a reason, <code>true</code> restores it). At least one reason must stay active (<code>409</code>). Reasons are never deleted, because past refunds point at them.</p></Endpoint>
      <Endpoint method="POST" path="/refund-reasons/{id}/move" scope="settings:write"><p>Body: <code>direction</code> (<code>up</code> or <code>down</code>): swaps places with the neighbour. Returns the whole list.</p></Endpoint>
    </>
  );
}
