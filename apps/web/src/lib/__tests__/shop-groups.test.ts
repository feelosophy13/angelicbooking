import React, { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The shop page itself needs Stripe set up, so check how the cart lays out a product with options by rendering it.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));
vi.mock("../../app/book/[slug]/shop/actions", () => ({ startOrderAction: async () => ({ error: "x" }), finishOrderAction: async () => ({}) }));

// The component is written for the automatic JSX runtime; give the test transform what it needs.
(globalThis as unknown as { React: typeof React }).React = React;

describe("the online shop with products that have options", () => {
  it("shows a product with options as one entry with each option under it, and others on their own", async () => {
    const { StoreCheckout } = await import("../../app/book/[slug]/shop/checkout");
    const p = (id: string, name: string, priceCents: number, extra: object = {}) => ({ id, name, priceCents, description: null, imageUrl: null, category: null, stockQty: 9, trackStock: true, ...extra });
    const html = renderToString(
      createElement(StoreCheckout, {
        slug: "s",
        currency: "usd",
        shippingFlatCents: 0,
        publishableKey: "pk_test",
        brand: "#6d28d9",
        products: [
          p("a", "Brow Tint · Black", 1800, { groupId: "g", groupName: "Brow Tint", optionLabel: "Black" }),
          p("b", "Brow Tint · Auburn", 1800, { groupId: "g", groupName: "Brow Tint", optionLabel: "Auburn", stockQty: 0 }),
          p("c", "Gentle Cleanser", 2600),
        ],
      }),
    );
    expect(html.match(/>Brow Tint</g)?.length).toBe(1); // one heading for the product, not one per option
    expect(html).toContain("Black");
    expect(html).toContain("Auburn");
    expect(html).toContain("Sold out"); // the sold-out option says so
    expect(html).toContain("Gentle Cleanser");
  });
});
