import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { FormPage } from "@/components/ui";
import { RoleForm } from "../role-form";
import { createRoleAction } from "../actions";

export const metadata: Metadata = { title: "New role" };

export default async function NewRolePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireAction(slug, "members.manage");
  return (
    <FormPage title="New role" backHref={`/app/${slug}/settings/roles`} backLabel="Roles & permissions" width="max-w-3xl">
      <RoleForm action={createRoleAction} slug={slug} submitLabel="Create role" />
    </FormPage>
  );
}
