"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAction } from "@/lib/tenant";
import { removeMember, RoleError, setMemberRole } from "@/server/roles";
import { setFlash } from "@/lib/flash";

export async function changeMemberRole(formData: FormData) {
  const d = z.object({ slug: z.string(), staffId: z.string(), memberId: z.string().min(1), role: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "members.manage");
  try {
    await setMemberRole(ctx.business.id, d.memberId, d.role, ctx.user.id);
    await setFlash("Role updated");
  } catch (e) {
    if (e instanceof RoleError) await setFlash(e.message, "error");
    else throw e;
  }
  revalidatePath(`/app/${d.slug}/staff/${d.staffId}/access`);
}

export async function revokeAccess(formData: FormData) {
  const d = z.object({ slug: z.string(), staffId: z.string(), memberId: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "members.manage");
  try {
    await removeMember(ctx.business.id, d.memberId, ctx.user.id);
    await setFlash("Access removed. They can no longer sign in to this business.");
  } catch (e) {
    if (e instanceof RoleError) await setFlash(e.message, "error");
    else throw e;
  }
  revalidatePath(`/app/${d.slug}/staff/${d.staffId}/access`);
  revalidatePath(`/app/${d.slug}/staff`);
}
