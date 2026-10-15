import { Code, Endpoint } from "../doc-kit";

/** Admin-parity inventory endpoints: stock by location, receiving, counts, transfers, usage, reorder suggestions, suppliers, purchase orders, visit supplies. */
export function InventoryDocs() {
  return (
    <>
      <h2>Stock by location</h2>
      <p>Every change to stock is a recorded movement. By hand, stock can never go below zero (<code>409</code>); a use logged by staff may, rather than stop the work, and then shows as &quot;count is off&quot;. Where a <code>location_id</code> is optional, the default location is used.</p>
      <Endpoint method="GET" path="/inventory" scope="inventory:read"><p>Products with tracked stock: <code>on_hand</code>, <code>low_stock_threshold</code>, <code>is_low</code>, and for inventory keys also <code>reorder_up_to</code>, <code>supplier_id</code>, <code>cost_cents</code>, <code>variant_label</code> and <code>group_id</code> (the product group an option belongs to).</p></Endpoint>
      <Endpoint method="GET" path="/products/{id}/stock" scope="inventory:read"><p>On hand in total and at each location: <code>{`{ "product_id", "track_stock", "on_hand", "low_stock_threshold", "locations": [ { "location_id", "name", "qty" } ] }`}</code>.</p></Endpoint>
      <Endpoint method="GET" path="/products/{id}/stock-movements" scope="inventory:read"><p>Every change to the product&apos;s stock, newest first.</p></Endpoint>
      <Endpoint method="POST" path="/products/{id}/stock-adjustments" scope="inventory:write"><p>One product, one change. Body: <code>reason</code> (<code>received</code>, <code>adjust</code>, <code>damage</code>, <code>theft</code>, <code>expired</code>, <code>lost</code>, <code>supplier_return</code>, <code>used</code>), <code>quantity</code>, optional <code>location_id</code> and <code>note</code>. Several products at once: use <code>POST /stock/receipts</code> (deliveries) or <code>POST /stock/counts</code>.</p></Endpoint>
      <Endpoint method="POST" path="/stock/receipts" scope="inventory:write">
        <p>A delivery with no purchase order, one product or many. Body: <code>{`{ "location_id"?, "note"?, "items": [ { "product_id", "quantity" } ] }`}</code> (1 to 200 items, <code>quantity</code> a whole number above 0). Nothing is applied if any id is not yours (<code>404</code>). Returns <code>units</code>, <code>products</code> and the new <code>on_hand</code> for each product.</p>
      </Endpoint>
      <Endpoint method="POST" path="/stock/receipts/{id}/undo" scope="inventory:write"><p><code>{"{id}"}</code> is the stock movement&apos;s id (from <code>/products/{"{id}"}/stock-movements</code>). Takes back a delivery entered wrong; if it was on a purchase order, the order&apos;s received count and status go back too. <code>409</code> when some of it has already gone (correct the count instead) or it was already undone.</p></Endpoint>
      <Endpoint method="POST" path="/stock/counts" scope="inventory:write">
        <p>Set the count from what was physically counted at one location. Body: <code>{`{ "location_id", "note"?, "counts": [ { "product_id", "counted" } ] }`}</code> (1 to 1000, each product once, <code>counted</code> 0 or more). Only products whose count differs get a movement; products you leave out are not touched. Returns <code>{`{ "counted", "changed", "units_off" }`}</code>.</p>
      </Endpoint>
      <Endpoint method="POST" path="/stock/transfers" scope="inventory:write"><p>Body: <code>product_id</code>, <code>from_location_id</code>, <code>to_location_id</code>, <code>quantity</code>, optional <code>note</code>. The total does not change. <code>409</code> when the two locations are the same or the source has fewer than <code>quantity</code>. Returns the product&apos;s stock by location.</p></Endpoint>
      <Endpoint method="POST" path="/stock/usage" scope="inventory:write"><p>Log supplies used up that are not tied to a visit. Body: <code>{`{ "location_id"?, "note"?, "items": [ { "product_id", "quantity" } ] }`}</code> (up to 50 products, <code>quantity</code> 1 to 1000). May take a count below zero.</p></Endpoint>
      <Endpoint method="POST" path="/stock/usage/{id}/undo" scope="inventory:write"><p><code>{"{id}"}</code> is the movement&apos;s id. Takes back a use logged by mistake, once (<code>409</code> after). A use logged on a visit is taken back on that visit, below.</p></Endpoint>
      <Endpoint method="GET" path="/inventory/reorder-suggestions" scope="inventory:read">
        <p>What to order, grouped by supplier and location (each location&apos;s shortfall is its own order; what is already on its way counts as stock). Each group: <code>supplier_id</code>, <code>supplier_name</code>, <code>location_id</code>, <code>location_name</code> and <code>items</code> with <code>product_id</code>, <code>name</code>, <code>on_hand</code>, <code>on_order</code>, <code>low_stock_threshold</code>, <code>suggested_qty</code>, <code>unit_cost_cents</code>. To act on a group, create a draft with <code>POST /purchase-orders</code>.</p>
      </Endpoint>

      <h2>Supplies used on a visit</h2>
      <Endpoint method="GET" path="/appointments/{id}/supplies" scope="inventory:read"><p>What has been logged as used on the visit, net of anything taken back: <code>product_id</code>, <code>label</code>, <code>quantity</code>.</p></Endpoint>
      <Endpoint method="POST" path="/appointments/{id}/supplies" scope="supplies:write"><p>Body: <code>{`{ "items": [ { "product_id", "quantity" } ], "note"? }`}</code>. Comes off the stock at the visit&apos;s location; may take a count below zero. Blocked time is not a visit (<code>404</code>).</p></Endpoint>
      <Endpoint method="DELETE" path="/appointments/{id}/supplies/{productId}" scope="supplies:write"><p>Take back supplies logged by mistake. Query: <code>quantity</code> (default: everything logged for that product; never more than was logged, <code>409</code>).</p></Endpoint>

      <h2>Suppliers</h2>
      <p>Suppliers are never deleted, because orders point at them: hide one with <code>{`{"active": false}`}</code>.</p>
      <Endpoint method="GET" path="/suppliers" scope="purchasing:read"><p>Add <code>?include_inactive=1</code> for hidden ones. Fields: <code>id</code>, <code>name</code>, <code>contact_name</code>, <code>email</code>, <code>phone</code>, <code>account_number</code>, <code>notes</code>, <code>active</code>, <code>created_at</code>.</p></Endpoint>
      <Endpoint method="GET" path="/suppliers/{id}" scope="purchasing:read" />
      <Endpoint method="POST" path="/suppliers" scope="purchasing:write"><p>Required: <code>name</code> (80). Optional: <code>contact_name</code> (80), <code>email</code>, <code>phone</code> (40), <code>account_number</code> (60), <code>notes</code> (500), <code>active</code>.</p></Endpoint>
      <Endpoint method="PATCH" path="/suppliers/{id}" scope="purchasing:write"><p>Same fields, all optional; send only what changes (<code>null</code> clears one).</p></Endpoint>

      <h2>Purchase orders</h2>
      <p>An order is <code>draft</code>, then <code>ordered</code>, then <code>partial</code> or <code>received</code>, or <code>cancelled</code>. Marking an order as ordered records that you ordered; it does not contact the supplier. Receiving puts the stock on hand at the order&apos;s location and sets each product&apos;s cost to what was paid.</p>
      <Endpoint method="GET" path="/purchase-orders" scope="purchasing:read"><p>Query: <code>status</code> = <code>open</code> (default: draft, ordered, partial), <code>received</code> (received and cancelled) or <code>all</code>. Each order adds <code>supplier_name</code>, <code>location_name</code>, <code>units</code>, <code>received_units</code>, <code>cost_cents</code>. Includes <code>total</code>.</p></Endpoint>
      <Endpoint method="GET" path="/purchase-orders/{id}" scope="purchasing:read"><p>The order with its <code>lines</code> (<code>id</code>, <code>product_id</code>, <code>label</code>, <code>ordered_qty</code>, <code>received_qty</code>, <code>unit_cost_cents</code>) and <code>receipts</code> (each delivery, with whether it was undone).</p></Endpoint>
      <Endpoint method="POST" path="/purchase-orders" scope="purchasing:write"><p>A draft order. Body, all optional: <code>supplier_id</code>, <code>location_id</code> (where it will be delivered; default location otherwise), <code>expected_on</code> (<code>YYYY-MM-DD</code>), <code>notes</code> (500), <code>lines</code> (<code>[{`{ "product_id", "quantity", "unit_cost_cents"? }`}]</code>; the cost defaults to the product&apos;s). The number is assigned for you. <code>404</code> when any id is not yours.</p></Endpoint>
      <Endpoint method="PATCH" path="/purchase-orders/{id}" scope="purchasing:write"><p>Change <code>supplier_id</code>, <code>location_id</code>, <code>expected_on</code>, <code>reference</code> (the supplier&apos;s invoice or confirmation number) or <code>notes</code>; send only what changes. <code>409</code> once the order is received or cancelled.</p></Endpoint>
      <Endpoint method="POST" path="/purchase-orders/{id}/lines" scope="purchasing:write"><p>Body: <code>{`{ "product_id", "quantity", "unit_cost_cents"? }`}</code>. Adds the product, or replaces its quantity if it is already on the order.</p></Endpoint>
      <Endpoint method="PATCH" path="/purchase-orders/{id}/lines/{productId}" scope="purchasing:write"><p>Body: <code>quantity</code> and/or <code>unit_cost_cents</code> on a line already on the order (<code>404</code> otherwise); what you leave out stays.</p></Endpoint>
      <Endpoint method="DELETE" path="/purchase-orders/{id}/lines/{productId}" scope="purchasing:write"><p><code>409</code> when some of the line has already arrived.</p></Endpoint>
      <Endpoint method="POST" path="/purchase-orders/{id}/order" scope="purchasing:write"><p>Mark a draft as ordered. It needs at least one line (<code>409</code>).</p></Endpoint>
      <Endpoint method="POST" path="/purchase-orders/{id}/receive" scope="purchasing:write">
        <p>Take delivery of all or part of an order. Body: <code>{`{ "reference"?, "lines": [ { "line_id", "quantity", "unit_cost_cents"? } ] }`}</code> (each line once; <code>line_id</code> is a line&apos;s <code>id</code> on this order). Returns <code>{`{ "units", "done", "order": { … } }`}</code>; the order is <code>received</code> when everything has arrived, otherwise <code>partial</code>. A delivery entered wrong can be taken back with <code>POST /stock/receipts/{"{id}"}/undo</code>.</p>
      </Endpoint>
      <Endpoint method="POST" path="/purchase-orders/{id}/cancel" scope="purchasing:write"><p>Cancel an order that is still open (<code>409</code> otherwise).</p></Endpoint>
      <Code>{`curl -X POST $BASE/purchase-orders/ORDER_ID/receive -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{ "reference": "INV-1042", "lines": [ { "line_id": "LINE_ID", "quantity": 6, "unit_cost_cents": 450 } ] }'`}</Code>
    </>
  );
}
