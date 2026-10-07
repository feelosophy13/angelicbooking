"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAction } from "@/lib/tenant";
import { createRole, deleteRole, RoleError, updateRole } from "@/server/roles";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";

const fields = z.object({ slug: z.string(), roleId: z.string().optional(), name: f.text(2, 40), description: f.optional(160) });

function permissionsFrom(fd: FormData) {
  return fd.getAll("permissions").map(String);
}

export const createRoleAction = formAction(fields, async (d, fd) => {
  const ctx = await requireAction(d.slug, "members.manage");
  const perms = permissionsFrom(fd);
  if (perms.length === 0) throw new FormError("Pick at least one permission.");
  try {
    await createRole(ctx.business.id, { name: d.name, description: d.description, permissions: perms });
  } catch (e) {
    if (e instanceof RoleError) throw new FormError(e.message);
    throw e;
  }
  await setFlash(`${d.name} role created`);
  revalidatePath(`/app/${d.slug}/settings/roles`);
  redirect(`/app/${d.slug}/settings/roles`);
});

export const updateRoleAction = formAction(fields, async (d, fd) => {
  const ctx = await requireAction(d.slug, "members.manage");
  const perms = permissionsFrom(fd);
  if (perms.length === 0) throw new FormError("Pick at least one permission.");
  try {
    await updateRole(ctx.business.id, d.roleId ?? "", { name: d.name, description: d.description, permissions: perms });
  } catch (e) {
    if (e instanceof RoleError) throw new FormError(e.message);
    throw e;
  }
  revalidatePath(`/app/${d.slug}/settings/roles`);
  revalidatePath(`/app/${d.slug}/settings/roles/${d.roleId}`);
  return "Role saved";
});

export async function deleteRoleAction(formData: FormData) {
  const d = z.object({ slug: z.string(), roleId: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "members.manage");
  try {
    await deleteRole(ctx.business.id, d.roleId);
  } catch (e) {
    if (e instanceof RoleError) {
      await setFlash(e.message, "error");
      return;
    }
    throw e;
  }
  await setFlash("Role deleted");
  revalidatePath(`/app/${d.slug}/settings/roles`);
  redirect(`/app/${d.slug}/settings/roles`);
}
