import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAction } from "@/lib/tenant";
import { getRole, listMembers } from "@/server/roles";
import { Card, FormPage, Notice } from "@/components/ui";
import { ConfirmSubmit } from "@/components/form";
import { RoleForm } from "../role-form";
import { deleteRoleAction, updateRoleAction } from "../actions";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; roleId: string }> }): Promise<Metadata> {
  const { slug, roleId } = await params;
  const { business } = await requireAction(slug, "members.manage");
  const r = await getRole(business.id, roleId);
  return { title: r ? `${r.name} · Roles` : "Role" };
}

export default async function EditRolePage({ params }: { params: Promise<{ slug: string; roleId: string }> }) {
  const { slug, roleId } = await params;
  const { business } = await requireAction(slug, "members.manage");
  const [role, members] = await Promise.all([getRole(business.id, roleId), listMembers(business.id)]);
  if (!role) notFound();
  const holders = members.filter((m) => m.role === role.key);
  const locked = role.key === "owner";
  return (
    <FormPage title={role.name} backHref={`/app/${slug}/settings/roles`} backLabel="Roles & permissions" width="max-w-3xl">
      {locked ? <div className="mb-4"><Notice kind="success">Owners always have every permission. This role can't be edited or deleted.</Notice></div> : null}
      <RoleForm action={updateRoleAction} slug={slug} roleId={role.id} defaults={{ name: role.name, description: role.description, permissions: role.permissions }} locked={locked} submitLabel="Save role" />
      <Card className="mt-6 p-4 text-sm">
        <h2 className="mb-2 font-medium">Who has this role</h2>
        {holders.length === 0 ? <p className="text-stone-500">Nobody yet. Assign it from a staff member's Access tab.</p> : (
          <ul className="divide-y divide-stone-100">
            {holders.map((m) => <li key={m.id} className="py-1.5">{m.name} <span className="text-stone-500">· {m.email}</span></li>)}
          </ul>
        )}
      </Card>
      {!role.isSystem ? (
        <form action={deleteRoleAction} className="mt-6">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="roleId" value={role.id} />
          <ConfirmSubmit title={`Delete the ${role.name} role?`} body={holders.length ? `Move the ${holders.length} member(s) to another role first.` : "This can't be undone."} confirmLabel="Delete role" variant="danger">Delete role</ConfirmSubmit>
        </form>
      ) : null}
    </FormPage>
  );
}
