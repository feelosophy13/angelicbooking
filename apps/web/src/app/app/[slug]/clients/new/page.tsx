import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { FormPage } from "@/components/ui";
import { ImageField } from "@/components/image-field";
import { ActionForm } from "@/components/form";
import { createClient } from "../actions";
import { NewClientFields, NewClientSubmit } from "./client-fields";

export const metadata: Metadata = { title: "New client" };

export default async function NewClientPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireAction(slug, "clients.write");
  return (
    <FormPage title="New client" backHref={`/app/${slug}/clients`} backLabel="Clients">
      <ActionForm action={createClient}>
        <input type="hidden" name="slug" value={slug} />
        <ImageField name="photo" current={null} shape="round" />
        <NewClientFields />
        <NewClientSubmit />
      </ActionForm>
    </FormPage>
  );
}
