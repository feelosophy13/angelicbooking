import type { Metadata } from "next";
import QRCode from "qrcode";
import { requireAction } from "@/lib/tenant";
import { listLocations } from "@/server/locations";
import { appUrl } from "@/lib/stripe";
import { BackLink, Button, Card, Input, PageHeader } from "@/components/ui";
import { ActionForm, ConfirmSubmit, Field, SubmitButton } from "@/components/form";
import { changeKiosk, saveCheckinWindow } from "./actions";

export const metadata: Metadata = { title: "Check-in kiosk" };

/** Settings → Check-in kiosk: turn the front-door tablet on per location, open it on the tablet, and unpair a lost one. */
export default async function CheckinSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "settings.business");
  const locations = await listLocations(business.id);
  const multi = locations.length > 1;
  const sites = await Promise.all(
    locations.map(async (l) => {
      const url = l.checkinToken ? appUrl(`/checkin/${l.checkinToken}`) : null;
      return { id: l.id, name: l.name.replace(`${business.name} - `, ""), url, qr: url ? await QRCode.toDataURL(url, { margin: 1, width: 240, color: { dark: "#1c1917" } }) : null };
    }),
  );
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Check-in kiosk" />
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card>
            <ul className="divide-y divide-stone-100">
              {sites.map((s) => (
                <li key={s.id} className="flex flex-wrap items-start gap-4 px-4 py-4">
                  {s.qr ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.qr} alt={`Check-in kiosk QR code for ${s.name}`} width={112} height={112} className="h-28 w-28 shrink-0 rounded-lg border border-stone-200" />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-stone-900">
                      {multi ? s.name : "Kiosk"} <span className={`ml-1 rounded-full px-2 py-0.5 text-xs font-normal ${s.url ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-600"}`}>{s.url ? "on" : "off"}</span>
                    </p>
                    {s.url ? (
                      <>
                        <p className="mt-1 text-xs text-stone-500">Scan the code with the tablet&apos;s camera, or type this address into its browser:</p>
                        <p className="mt-1 break-all font-mono text-xs text-stone-700 select-all">{s.url}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                          <a href={s.url} target="_blank" rel="noreferrer" className="hit text-sm text-brand-700 underline">Open the kiosk</a>
                          <form action={changeKiosk}>
                            <input type="hidden" name="slug" value={slug} />
                            <input type="hidden" name="locationId" value={s.id} />
                            <input type="hidden" name="op" value="reset" />
                            <ConfirmSubmit title="Unpair the tablet?" body="The current kiosk link stops working at once, on every device that has it. Open the new link on the tablet you keep." confirmLabel="Unpair and make a new link" variant="ghost" className="text-sm text-stone-600">New link (unpair a lost tablet)</ConfirmSubmit>
                          </form>
                          <form action={changeKiosk}>
                            <input type="hidden" name="slug" value={slug} />
                            <input type="hidden" name="locationId" value={s.id} />
                            <input type="hidden" name="op" value="off" />
                            <ConfirmSubmit title={`Turn off the kiosk${multi ? ` at ${s.name}` : ""}?`} body="The tablet stops working until you turn it on again (with a new link)." confirmLabel="Turn off" variant="ghost" className="text-sm text-stone-600">Turn off</ConfirmSubmit>
                          </form>
                        </div>
                      </>
                    ) : (
                      <form action={changeKiosk} className="mt-2">
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="locationId" value={s.id} />
                        <input type="hidden" name="op" value="on" />
                        <Button type="submit" size="sm" variant="secondary">Turn on</Button>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-5">
            <h2 className="mb-1 font-medium">When clients can check in</h2>
            <p className="mb-4 text-sm text-stone-600">From this many minutes before the appointment until it ends. Earlier or later, the kiosk asks them to see the front desk.</p>
            <ActionForm action={saveCheckinWindow}>
              <input type="hidden" name="slug" value={slug} />
              <div className="max-w-xs">
                <Field label="Minutes early" name="early">
                  <Input name="early" type="number" min={0} max={240} inputMode="numeric" defaultValue={business.checkinEarlyMinutes} />
                </Field>
              </div>
              <SubmitButton pendingText="Saving…">Save check-in window</SubmitButton>
            </ActionForm>
          </Card>
        </div>
        <Card className="p-4 text-sm">
          <h2 className="mb-1 font-medium">How it works</h2>
          <ul className="list-disc space-y-2 pl-4 text-stone-600">
            <li>Clients type the last 4 digits of their mobile number (or the whole number). They see only their own first name, initial, services and time, and tap Check in.</li>
            <li>Forms due for the visit are filled in on the tablet first.</li>
            <li>The visit is marked checked in on the calendar, and anyone with the app open gets an alert.</li>
            <li>&ldquo;I don&apos;t have an appointment&rdquo; adds them to today&apos;s Waitlist, where Book fills in their details.</li>
            <li>The kiosk goes back to Welcome after a minute without a touch, and after each check-in.</li>
          </ul>
          <h2 className="mb-1 mt-4 font-medium">Lock the tablet to the kiosk</h2>
          <p className="text-stone-600">On an iPad, open the link in Safari, then turn on Guided Access (Settings → Accessibility → Guided Access) and triple-click the side button. On Android, use Screen pinning.</p>
        </Card>
      </div>
    </>
  );
}
