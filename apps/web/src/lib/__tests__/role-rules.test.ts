import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_PERMISSIONS } from "@angelic/core";
import { mayAssignOwner, roleChangeBlocker } from "../role-rules";

const owner = { userId: "o1", role: "owner", permissions: DEFAULT_ROLE_PERMISSIONS.owner };
const manager = { userId: "m1", role: "manager", permissions: DEFAULT_ROLE_PERMISSIONS.manager };
const base = { ownerCount: 1, targetPermissions: DEFAULT_ROLE_PERMISSIONS.provider };

describe("who may change whose role", () => {
  it("an owner may change anyone, including another owner and themselves", () => {
    expect(roleChangeBlocker({ ...base, actor: owner, target: { userId: "x", role: "provider" }, toRole: "manager" })).toBeNull();
    expect(roleChangeBlocker({ ...base, actor: owner, target: { userId: "o2", role: "owner" }, ownerCount: 2, targetPermissions: DEFAULT_ROLE_PERMISSIONS.owner, toRole: "manager" })).toBeNull();
    expect(roleChangeBlocker({ ...base, actor: owner, target: owner, targetPermissions: DEFAULT_ROLE_PERMISSIONS.owner, toRole: "owner" })).toBeNull();
    expect(mayAssignOwner(owner)).toBe(true);
  });
  it("the last owner can't be demoted, even by themselves", () => {
    expect(roleChangeBlocker({ ...base, actor: owner, target: owner, ownerCount: 1, targetPermissions: DEFAULT_ROLE_PERMISSIONS.owner, toRole: "manager" })).toMatchObject({ kind: "conflict" });
  });
  it("a manager can't make owners, touch an owner, or change their own role", () => {
    expect(roleChangeBlocker({ ...base, actor: manager, target: { userId: "x", role: "provider" }, toRole: "owner" })).toMatchObject({ kind: "forbidden", message: expect.stringContaining("owner") });
    expect(roleChangeBlocker({ ...base, actor: manager, target: { userId: "o1", role: "owner" }, targetPermissions: DEFAULT_ROLE_PERMISSIONS.owner })).toMatchObject({ kind: "forbidden" });
    expect(roleChangeBlocker({ ...base, actor: manager, target: { userId: "m1", role: "manager" }, targetPermissions: DEFAULT_ROLE_PERMISSIONS.manager })).toMatchObject({ kind: "forbidden", message: expect.stringContaining("own role") });
    expect(mayAssignOwner(manager)).toBe(false);
  });
  it("a manager can't change someone whose access is wider than theirs, but can change a provider", () => {
    expect(roleChangeBlocker({ ...base, actor: manager, target: { userId: "b", role: "billing_lead" }, targetPermissions: ["clients.read", "billing.manage"] })).toMatchObject({ kind: "forbidden", message: expect.stringContaining("wider") });
    expect(roleChangeBlocker({ ...base, actor: manager, target: { userId: "p", role: "provider" } })).toBeNull();
    expect(roleChangeBlocker({ ...base, actor: manager, target: { userId: "p", role: "provider" }, toRole: "front_desk" })).toBeNull();
  });
});
