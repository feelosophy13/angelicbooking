import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { appUrl } from "@/lib/stripe";
import { BackLink, Card, Input, PageHeader, Textarea } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { saveProfile } from "./actions";

export const metadata: Metadata = { title: "Business profile" };

export default async function ProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "business.manage");
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Business profile" />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="p-5">
          <ActionForm action={saveProfile}>
            <input type="hidden" name="slug" value={slug} />
            <Field label="Tagline" name="tagline" hint="One line under your name on the booking page."><Input name="tagline" defaultValue={business.tagline ?? ""} placeholder="Lashes, brows and skin in Sterling, VA" /></Field>
            <Field label="About" name="about" hint="Shown on the booking page."><Textarea name="about" rows={4} defaultValue={business.about ?? ""} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Logo URL" name="logoUrl" hint="Square image works best. Upload support arrives with file storage."><Input name="logoUrl" defaultValue={business.logoUrl ?? ""} placeholder="https://…/logo.png" /></Field>
              <Field label="Cover photo URL" name="coverUrl" hint="Wide image for the top of the booking page."><Input name="coverUrl" defaultValue={business.coverUrl ?? ""} placeholder="https://…/cover.jpg" /></Field>
            </div>
            <Field label="Brand colour" name="brandColor" hint="Buttons and highlights on the booking page and in emails."><Input name="brandColor" type="color" defaultValue={business.brandColor ?? "#6d28d9"} className="h-10 w-24 p-1" /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Website" name="website"><Input name="website" defaultValue={business.website ?? ""} placeholder="https://yoursalon.com" /></Field>
              <Field label="Instagram" name="instagram"><Input name="instagram" defaultValue={business.instagram ?? ""} placeholder="@yoursalon" /></Field>
            </div>
            <Field label="Opening hours" name="hoursText" hint="One line per day, shown on the booking page."><Textarea name="hoursText" rows={4} defaultValue={business.hoursText ?? ""} placeholder={"Mon–Fri 9am–7pm\nSat 9am–5pm\nSun closed"} /></Field>
            <SubmitButton pendingText="Saving…">Save profile</SubmitButton>
          </ActionForm>
        </Card>
        <Card className="p-4 text-sm">
          <h2 className="mb-1 font-medium">Where this shows</h2>
          <ul className="list-disc space-y-1 pl-5 text-stone-600">
            <li>Your public booking page: <a className="text-brand-700 underline" href={appUrl(`/book/${business.slug}`)} target="_blank" rel="noreferrer">{appUrl(`/book/${business.slug}`)}</a></li>
            <li>Link previews when you share that page on Instagram, in texts or on Google.</li>
            <li>Confirmation, reminder and receipt emails.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
