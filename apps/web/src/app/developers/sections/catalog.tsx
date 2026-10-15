import { Code, Endpoint } from "../doc-kit";

/** Admin-parity catalog endpoints: categories, service order and per-stylist terms, packages, membership plans, product groups, extra barcodes. */
export function CatalogDocs() {
  return (
    <>
      <h2>Categories</h2>
      <p>Service categories nest through <code>parent_id</code> (Hair, then Colour, then Balayage). Product categories are flat. Every endpoint below takes <code>?kind=service</code> (the default) or <code>?kind=product</code> where the id alone cannot say which.</p>
      <Endpoint method="GET" path="/categories" scope="catalog:read"><p>The whole list, ordered as in the app. Fields: <code>id</code>, <code>name</code>, <code>parent_id</code>, <code>description</code>, <code>prep_notes</code>, <code>sort_order</code>.</p></Endpoint>
      <Endpoint method="GET" path="/categories/{id}" scope="catalog:read"><p>One category. Query: <code>kind</code>. <code>404</code> for an id that is not yours.</p></Endpoint>
      <Endpoint method="POST" path="/categories" scope="catalog:write">
        <p>Body: <code>kind</code> (<code>service</code> or <code>product</code>) and <code>name</code> (1 to 60 characters) are required. Service categories also take <code>parent_id</code>, <code>description</code> (300) and <code>prep_notes</code> (400, the &quot;before your visit&quot; text added to confirmations). Product categories only have a name (<code>422</code> otherwise).</p>
        <p><code>404</code> when <code>parent_id</code> is not one of your categories; <code>409</code> when a category with that name already exists in the same place.</p>
      </Endpoint>
      <Endpoint method="PATCH" path="/categories/{id}" scope="catalog:write"><p>Query: <code>kind</code>. Send only what changes: <code>name</code>, and for service categories <code>parent_id</code> (<code>null</code> moves it to the top level), <code>description</code>, <code>prep_notes</code>. A category cannot be moved inside itself or one of its own sub-categories (<code>409</code>). Moving it to a new parent puts it last there.</p></Endpoint>
      <Endpoint method="DELETE" path="/categories/{id}" scope="catalog:delete"><p>Query: <code>kind</code>. Its services or products become uncategorised and its sub-categories move up one level. Returns <code>{`{ "data": { "id": "…", "deleted": true } }`}</code>.</p></Endpoint>
      <Endpoint method="POST" path="/categories/{id}/move" scope="catalog:write"><p>Query: <code>kind</code>. Body: <code>{`{ "direction": "up" }`}</code> or <code>"down"</code>: one step among its siblings. Returns the renumbered list.</p></Endpoint>

      <h2>Service order and who performs a service</h2>
      <Endpoint method="POST" path="/services/{id}/move" scope="catalog:write"><p>Body: <code>{`{ "direction": "up" | "down" }`}</code>. Moves the service one step within its category (or among uncategorised services) and renumbers its siblings.</p></Endpoint>
      <Endpoint method="GET" path="/services/{id}/staff" scope="catalog:read">
        <p>The people who perform the service. Each: <code>staff_id</code>, <code>display_name</code>, <code>active</code>, <code>price_cents</code> and <code>duration_min</code> (what that person charges and takes: their own, or the service&apos;s), and <code>price_override_cents</code> / <code>duration_override_min</code> (their own values, <code>null</code> when they use the service&apos;s). A service nobody is listed for can be done by anyone.</p>
      </Endpoint>
      <Endpoint method="PUT" path="/services/{id}/staff" scope="catalog:write">
        <p>Replaces the set of people who perform the service. Body: <code>{`{ "staff": [ { "staff_id", "price_cents"?, "duration_min"? } ] }`}</code> (up to 200, each person once). People left out stop performing it. For each person, leave a field out to keep what is stored, send <code>null</code> to use the service&apos;s own, or send a value; a value equal to the service&apos;s own is stored as &quot;use the service&apos;s&quot;, so later changes to the service still flow through. <code>duration_min</code> is 5 to 600. <code>404</code> when a <code>staff_id</code> is not yours. Returns the new list.</p>
      </Endpoint>
      <Code>{`curl -X PUT $BASE/services/SERVICE_ID/staff -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{ "staff": [ { "staff_id": "ANA_ID", "price_cents": 9000, "duration_min": 60 }, { "staff_id": "BEN_ID" } ] }'`}</Code>

      <h2>Packages</h2>
      <p>These configure what you sell. Selling a package to a client happens at checkout and is not part of the API.</p>
      <Endpoint method="GET" path="/packages" scope="catalog:read"><p>Add <code>?include_inactive=1</code> to include hidden packages. Fields: <code>id</code>, <code>name</code>, <code>service_id</code>, <code>sessions</code>, <code>price_cents</code>, <code>valid_days</code>, <code>description</code>, <code>valid_location_ids</code> (empty = every location), <code>active</code>, <code>created_at</code>.</p></Endpoint>
      <Endpoint method="GET" path="/packages/{id}" scope="catalog:read" />
      <Endpoint method="POST" path="/packages" scope="catalog:write"><p>Required: <code>name</code> (80), <code>sessions</code> (1 to 100), <code>price_cents</code>. Optional: <code>service_id</code> (the service the sessions are for; empty = any), <code>valid_days</code> (days until it expires; <code>null</code> = never), <code>description</code> (300), <code>valid_location_ids</code>, <code>active</code> (default <code>true</code>). Listing every location, or none, means &quot;everywhere&quot;. <code>404</code> when a service or location is not yours.</p></Endpoint>
      <Endpoint method="PATCH" path="/packages/{id}" scope="catalog:write"><p>Same fields, all optional. <code>{`{"active": false}`}</code> hides a package from sale and <code>true</code> shows it again.</p></Endpoint>

      <h2>Membership plans</h2>
      <p>Also configuration only: enrolling a client (which bills them) happens at checkout. Stripe ids are never returned.</p>
      <Endpoint method="GET" path="/membership-plans" scope="catalog:read"><p>Add <code>?include_inactive=1</code> for hidden plans. Fields: <code>id</code>, <code>name</code>, <code>price_cents</code>, <code>interval</code> (<code>week</code>, <code>month</code>, <code>year</code>), <code>interval_count</code>, <code>included_service_id</code>, <code>included_sessions</code> (per period), <code>rollover_cap</code>, <code>cycle_count</code>, <code>discount_bps</code>, <code>description</code>, <code>valid_location_ids</code>, <code>active</code>, <code>created_at</code>.</p></Endpoint>
      <Endpoint method="GET" path="/membership-plans/{id}" scope="catalog:read" />
      <Endpoint method="POST" path="/membership-plans" scope="catalog:write">
        <p>Required: <code>name</code> (80), <code>price_cents</code>. Optional (defaults): <code>interval</code> (<code>month</code>), <code>interval_count</code> (1 to 52; <code>1</code>), <code>included_service_id</code>, <code>included_sessions</code> (0 to 31; <code>0</code>), <code>rollover_cap</code> (0 to 99: sessions that may carry into the next period; <code>0</code>), <code>cycle_count</code> (0 to 120 billed periods for a fixed-length plan; <code>null</code> or <code>0</code> = until cancelled), <code>discount_bps</code> (0 to 10000, basis points off other services; <code>0</code>), <code>description</code> (300), <code>valid_location_ids</code>, <code>active</code>.</p>
        <p>Rules, as in the app (<code>422</code>): included sessions need an <code>included_service_id</code>, and the cadence must be billable (at most 52 weeks or 12 months apart, a year is billed once a year).</p>
      </Endpoint>
      <Endpoint method="PATCH" path="/membership-plans/{id}" scope="catalog:write"><p>Send only what changes; the rules above are checked against the result. A new price or cadence clears the plan&apos;s stored Stripe price, so it is set up again the next time it is needed; subscriptions already running keep billing at the old price until then. <code>{`{"active": false}`}</code> hides the plan.</p></Endpoint>

      <h2>Products: supplier, reorder level and options</h2>
      <p><code>POST /products</code> and <code>PATCH /products/{"{id}"}</code> also take <code>supplier_id</code> and <code>reorder_up_to</code> (the count a reorder suggestion brings the product back up to; at least <code>low_stock_threshold</code>, <code>422</code> otherwise). A back-bar product (<code>kind: &quot;backbar&quot;</code>) is never sold online and always counted. These responses do not include cost or supplier; the <code>inventory:read</code> endpoints do.</p>
      <p>A product that comes in sizes or shades is a <em>group</em> with one product per <em>option</em>. The group holds what the options share (name, description, category, kind, tax, online store, usual supplier); each option has its own label, price, cost, SKU, barcode, stock and levels. Because the group owns the shared fields, <code>PATCH /products/{"{id}"}</code> on an option refuses <code>name</code>, <code>description</code>, <code>category_id</code>, <code>kind</code>, <code>taxable</code>, <code>sell_online</code> and <code>supplier_id</code> with <code>409</code>: change them on the group. An option&apos;s own fields, including <code>variant_label</code> (unique within the group), can be changed on the option.</p>
      <Endpoint method="GET" path="/product-groups" scope="catalog:read"><p>Add <code>?include_inactive=1</code> for hidden ones. Each group has <code>options</code>: <code>id</code>, <code>variant_label</code>, <code>sku</code>, <code>barcode</code>, <code>price_cents</code>, <code>track_stock</code>, <code>stock_qty</code>, <code>low_stock_threshold</code>, <code>reorder_up_to</code>, <code>active</code>. Cost and supplier are not included.</p></Endpoint>
      <Endpoint method="GET" path="/product-groups/{id}" scope="catalog:read" />
      <Endpoint method="POST" path="/product-groups" scope="catalog:write">
        <p>Required: <code>name</code> (80) and <code>options</code> (1 to 100 labels, up to 40 characters; repeats ignoring case are dropped). A retail group also needs <code>price_cents</code> above 0. Optional: <code>description</code>, <code>category_id</code>, <code>kind</code> (<code>retail</code> default or <code>backbar</code>), <code>taxable</code> (<code>true</code>), <code>sell_online</code> (<code>false</code>), <code>supplier_id</code>, and what each new option starts with: <code>price_cents</code>, <code>cost_cents</code>, <code>low_stock_threshold</code> (<code>3</code>), <code>reorder_up_to</code>, <code>track_stock</code> (<code>false</code>; always on for back-bar). Barcodes and SKUs belong to each option: set them with <code>PATCH /products/{"{id}"}</code> afterwards. Returns the group with its options (<code>201</code>).</p>
      </Endpoint>
      <Endpoint method="PATCH" path="/product-groups/{id}" scope="catalog:write"><p>Send only what changes: <code>name</code>, <code>description</code>, <code>category_id</code>, <code>kind</code>, <code>taxable</code>, <code>sell_online</code>, <code>supplier_id</code>, <code>active</code>. Every option follows. Making a group back-bar sets its options to counted, unpriced and not sold online. <code>{`{"active": false}`}</code> hides the product with all its options.</p></Endpoint>
      <Endpoint method="POST" path="/product-groups/{id}/options" scope="catalog:write"><p>Body: <code>options</code> (labels) and optionally <code>price_cents</code>, <code>cost_cents</code>; new options take those, else the group&apos;s first option&apos;s. Labels the group already has are skipped and listed in <code>skipped</code>; <code>409</code> when none is new. Returns <code>{`{ "added": 2, "skipped": [], "group": { … } }`}</code>.</p></Endpoint>
      <Endpoint method="POST" path="/products/{id}/convert-to-group" scope="catalog:write"><p>Body: <code>{`{ "label": "30 ml" }`}</code>. A standalone product becomes the first option of a new group, so more options can be added with the endpoint above. <code>409</code> when it already has options.</p></Endpoint>

      <h2>Extra barcodes</h2>
      <p>The product&apos;s main barcode is its <code>barcode</code> field. Extra barcodes cover a case or another pack size: one scan adds <code>units_per_scan</code> units. A code (barcode, extra barcode or SKU) can belong to one product only.</p>
      <Endpoint method="GET" path="/products/{id}/barcodes" scope="catalog:read"><p>Fields: <code>id</code>, <code>product_id</code>, <code>code</code>, <code>units_per_scan</code>, <code>created_at</code>.</p></Endpoint>
      <Endpoint method="POST" path="/products/{id}/barcodes" scope="catalog:write"><p>Body: <code>code</code> (1 to 60 characters), optional <code>units_per_scan</code> (1 to 1000, default 1). <code>409</code> when another product already uses the code.</p></Endpoint>
      <Endpoint method="DELETE" path="/products/{id}/barcodes/{barcodeId}" scope="catalog:delete" />
    </>
  );
}
