import { describe, expect, it } from "vitest";
import { groupServices } from "../service-groups";

const cats = [
  { id: "lash", name: "Lash Extensions", sortOrder: 0, parentId: null },
  { id: "classic", name: "Classic", sortOrder: 0, parentId: "lash" },
  { id: "facial", name: "Facials", sortOrder: 1, parentId: null },
];
const svc = (id: string, name: string, categoryId: string | null) => ({ id, name, categoryId, durationMin: 60, priceCents: 5000 });
const services = [svc("s1", "Classic Full Set", "classic"), svc("s2", "Classic Fill", "classic"), svc("s3", "Glow Facial", "facial"), svc("s4", "Consult", null)];

describe("groupServices", () => {
  it("groups by category path in menu order with an Other group last", () => {
    const g = groupServices(services, cats, "USD");
    expect(g.map((x) => x.name)).toEqual(["Lash Extensions › Classic", "Facials", "Other"]);
    expect(g.every((x) => !x.whole)).toBe(true);
  });
  it("follows each category's own sort order, not the alphabet", () => {
    const reordered = [{ ...cats[0]!, sortOrder: 5 }, cats[1]!, { ...cats[2]!, sortOrder: 1 }];
    expect(groupServices(services, reordered, "USD").map((x) => x.name)).toEqual(["Facials", "Lash Extensions › Classic", "Other"]);
  });
  it("tells the picker each category's own name and depth, for indenting", () => {
    const g = groupServices(services, cats, "USD", { categories: true });
    expect(g.map((x) => [x.title, x.depth])).toEqual([["Lash Extensions", 0], ["Classic", 1], ["Facials", 0], [undefined, 0]]);
  });
  it("adds whole-category rows for every ancestor, even a category that only holds sub-categories", () => {
    const g = groupServices(services, cats, "USD", { categories: true });
    expect(g.map((x) => x.name)).toEqual(["Lash Extensions", "Lash Extensions › Classic", "Facials", "Other"]);
    const lash = g.find((x) => x.id === "lash")!;
    expect(lash.services).toEqual([]);
    expect(lash.whole).toMatchObject({ id: "c:lash", name: "All of Lash Extensions" });
    expect(g.find((x) => x.id === "classic")!.whole?.id).toBe("c:classic");
    expect(g.find((x) => x.id === "none")!.whole).toBeUndefined();
  });
  it("only offers categories that contain an included service", () => {
    const g = groupServices(services, cats, "USD", { categories: true, include: (id) => id === "s3" });
    expect(g.map((x) => x.id)).toEqual(["facial"]);
    expect(g[0]!.whole?.id).toBe("c:facial");
  });
  it("leaves out meta when asked", () => {
    expect(groupServices(services, cats, "USD", { meta: "none" })[0]!.services[0]!.meta).toBe("");
  });
});
