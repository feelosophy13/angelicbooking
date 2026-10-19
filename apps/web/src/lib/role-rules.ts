import type { Permissions } from "@angelic/core";

/**
 * The rules for changing who holds which role, in one place so the server action and the Access tab agree: the action refuses with
 * the message, the page disables the control and shows it. Nobody hands out more than they hold, nobody changes their own role, and only
 * an owner touches owners. Decided by permissions and the owner flag, never by a role's name.
 */
export type RoleChangeActor = { userId: string; role: string; permissions: Permissions };
export type RoleChangeTarget = { userId: string; role: string };
export type RoleChangeBlock = { message: string; kind: "forbidden" | "conflict" };

export function roleChangeBlocker(input: {
  actor: RoleChangeActor;
  target: RoleChangeTarget;
  /** How many owners the business has now (the last one can't be demoted). */
  ownerCount: number;
  /** What the target's current role allows (an actor can't change someone whose access is wider than theirs). */
  targetPermissions: Iterable<string>;
  /** The role being assigned; omit to ask whether the actor may change this member at all. */
  toRole?: string;
}): RoleChangeBlock | null {
  const { actor, target } = input;
  const isOwner = actor.role === "owner";
  if (input.toRole !== undefined && target.role === "owner" && input.toRole !== "owner" && input.ownerCount <= 1) return { message: "A business needs at least one owner.", kind: "conflict" };
  if (input.toRole === "owner" && !isOwner) return { message: "Only an owner can make someone an owner.", kind: "forbidden" };
  if (target.role === "owner" && !isOwner) return { message: "Only an owner can change another owner's role.", kind: "forbidden" };
  if (target.userId === actor.userId && !isOwner) return { message: "You can't change your own role. Ask an owner.", kind: "forbidden" };
  if (!isOwner) for (const p of input.targetPermissions) if (!actor.permissions.has(p as never)) return { message: "You can't change the role of someone whose access is wider than yours.", kind: "forbidden" };
  return null;
}

/** Whether the Owner role may be offered to this actor at all (only owners assign it). */
export const mayAssignOwner = (actor: RoleChangeActor) => actor.role === "owner";
