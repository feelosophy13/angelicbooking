import { describe, expect, it } from "vitest";
import { locationControlFor, siteLabels } from "../location-ui";

describe("locationControlFor", () => {
  it("scales the control with the number of sites", () => {
    expect([0, 1].map(locationControlFor)).toEqual(["none", "none"]);
    expect([2, 3].map(locationControlFor)).toEqual(["buttons", "buttons"]);
    expect([4, 5, 7].map(locationControlFor)).toEqual(["menu", "menu", "menu"]);
    expect([8, 20].map(locationControlFor)).toEqual(["menu-search", "menu-search"]);
  });
});

describe("siteLabels", () => {
  it("drops the shared business prefix when the short names are distinct", () => {
    const labels = siteLabels([{ id: "a", name: "Glow Collective - Arlington" }, { id: "b", name: "Glow Collective - Reston" }]);
    expect([...labels.values()]).toEqual(["Arlington", "Reston"]);
  });
  it("keeps full names when shortening would collide", () => {
    const labels = siteLabels([{ id: "a", name: "North - Main" }, { id: "b", name: "South - Main" }]);
    expect([...labels.values()]).toEqual(["North - Main", "South - Main"]);
  });
});
