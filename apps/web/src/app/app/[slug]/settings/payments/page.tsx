import Link from "next/link";
import { requireAction } from "@/lib/tenant";
import { listLocations } from "@/server/locations";
import { isStripeConfigured } from "@/lib/stripe";
import { platformFeeBpsFor } from "@/server/price-book";
import type { Metadata } from "next";
import { BackLink, Button, Card, Input, Notice, PageHeader } from "@/components/ui";
import { ActionForm, ConfirmSubmit, Field, SubmitButton } from "@/components/form";
import { Textarea } from "@/components/ui";

export const metadata: Metadata = { title: "Payments" };
import { addHelcimDevice, connectHelcimAction, connectStripe, disconnectHelcimAction, disconnectStripe, pingHelcimDeviceAction, refreshStripe, removeHelcimDevice, saveHelcimVerifierAction, saveReceiptFooter, saveTax } from "./actions";
import { Disclosure } from "@/components/disclosure";
import { Select } from "@/components/ui";
import { listHelcimDevices } from "@/server/helcim/payments";
import { appUrl } from "@/lib/stripe";

export default async function PaymentsSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ refresh?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await requireAction(slug, "billing.manage");
  const configured = isStripeConfigured();
  const connected = !!business.stripeAccountId;
  const ready = connected && business.stripeChargesEnabled;
  const fee = await platformFeeBpsFor(business.id);
  const locations = await listLocations(business.id);
  const multi = locations.length > 1;
  const onHelcim = business.paymentProvider === "helcim";
  const devices = onHelcim ? await listHelcimDevices(business.id) : [];
  const webhookUrl = appUrl(`/api/helcim/webhook/${business.id}`);
  const helcimConnect = (
    <ActionForm action={connectHelcimAction} className="space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <Field label="Helcim API token" name="apiToken" hint="In Helcim: All Tools → Integrations → API Access Configuration → New. Give it General, Transaction Processing (Positive and Negative) and Customer permissions.">
        <Input name="apiToken" autoComplete="off" spellCheck={false} className="font-mono" />
      </Field>
      <Field label="Webhook verifier token (optional now)" name="verifierToken" hint="In Helcim: All Tools → Integrations → Webhooks. Turn webhooks on, paste the URL below as the Deliver URL, and copy the verifier token here.">
        <Input name="verifierToken" autoComplete="off" spellCheck={false} className="font-mono" />
      </Field>
      <p className="text-xs text-stone-500">Webhook URL: <code className="break-all rounded bg-stone-100 px-1">{webhookUrl}</code></p>
      <SubmitButton pendingText="Checking with Helcim…">Connect Helcim</SubmitButton>
    </ActionForm>
  );

  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Payments" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-4 lg:col-span-2">
          <h2 className="mb-1 font-medium">Card processor</h2>
          {onHelcim ? (
            <div className="space-y-3">
              <p className="text-sm text-stone-600">Cards go through <span className="font-medium">your Helcim account</span>: the card terminal at the desk, cards typed in, and saved cards. Payouts, statements and disputes are in your Helcim dashboard.</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-stone-500">Connected</dt>
                <dd className="text-emerald-700">{business.helcimConnectedAt ? `Since ${business.helcimConnectedAt.toLocaleDateString("en-US", { dateStyle: "medium" })}` : "Yes"}</dd>
                <dt className="text-stone-500">Webhook</dt>
                <dd className={business.helcimWebhookVerifier ? "text-emerald-700" : "text-amber-700"}>{business.helcimWebhookVerifier ? "Verifier saved" : "Not set up: terminal payments are checked by polling until it is"}</dd>
              </dl>
              {!business.helcimWebhookVerifier ? (
                <ActionForm action={saveHelcimVerifierAction} className="space-y-2">
                  <input type="hidden" name="slug" value={slug} />
                  <p className="text-xs text-stone-500">In Helcim: All Tools → Integrations → Webhooks. Turn webhooks on, set the Deliver URL to <code className="break-all rounded bg-stone-100 px-1">{webhookUrl}</code>, tick Card Transaction and Terminal Cancel, then paste the verifier token.</p>
                  <Field label="Verifier token" name="verifierToken"><Input name="verifierToken" autoComplete="off" spellCheck={false} className="font-mono" /></Field>
                  <SubmitButton size="sm" variant="secondary" pendingText="Saving…">Save verifier</SubmitButton>
                </ActionForm>
              ) : (
                <p className="text-xs text-stone-500">Webhook URL: <code className="break-all rounded bg-stone-100 px-1">{webhookUrl}</code></p>
              )}
              <div className="flex flex-wrap gap-2">
                <a href="https://hub.helcim.com/" target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-lg px-3 text-sm text-brand-700 underline">Open Helcim dashboard</a>
                <form action={disconnectHelcimAction}>
                  <input type="hidden" name="slug" value={slug} />
                  <ConfirmSubmit title="Switch back to Stripe?" body="New card payments go through Stripe. Payments already taken through Helcim stay there; refund those in your Helcim dashboard." confirmLabel="Use Stripe" variant="ghost">Switch back to Stripe</ConfirmSubmit>
                </form>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-stone-600">Cards go through <span className="font-medium">Stripe</span>. If you already process with Helcim, you can use your Helcim account and terminal instead.</p>
              <Disclosure title="Use Helcim instead" hint="your own Helcim account">{helcimConnect}</Disclosure>
            </div>
          )}
        </Card>

        {onHelcim ? (
          <Card className="p-4 lg:col-span-2">
            <h2 className="mb-1 font-medium">Card terminals</h2>
            <p className="mb-3 text-sm text-stone-600">Pair each Helcim Smart Terminal once with the four-character code it shows after registering. At checkout, &ldquo;Card reader&rdquo; sends the amount straight to the terminal.</p>
            {devices.length ? (
              <ul className="mb-4 divide-y divide-stone-100">
                {devices.map((dv) => (
                  <li key={dv.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{dv.name} <span className="font-mono text-xs text-stone-500">{dv.code}</span></p>
                      {multi ? <p className="text-xs text-stone-500">{locations.find((l) => l.id === dv.locationId)?.name ?? "Any location"}</p> : null}
                    </div>
                    <form action={pingHelcimDeviceAction}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="deviceId" value={dv.id} /><Button type="submit" size="sm" variant="secondary">Test</Button></form>
                    <form action={removeHelcimDevice}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="deviceId" value={dv.id} /><ConfirmSubmit title={`Remove ${dv.name}?`} body="It won't be offered at checkout. Pair it again with its code any time." confirmLabel="Remove" variant="ghost">Remove</ConfirmSubmit></form>
                  </li>
                ))}
              </ul>
            ) : null}
            <ActionForm action={addHelcimDevice} className="grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
              <input type="hidden" name="slug" value={slug} />
              <Field label="Device code" name="code"><Input name="code" maxLength={4} autoComplete="off" className="font-mono uppercase" placeholder="AB12" /></Field>
              <Field label="Name" name="name"><Input name="name" placeholder="Front desk" /></Field>
              {multi ? (
                <Field label="Location" name="locationId" className="sm:col-span-3">
                  <Select name="locationId" defaultValue=""><option value="">Any location</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
                </Field>
              ) : null}
              <SubmitButton pendingText="Pairing…" className={multi ? "sm:col-start-1" : ""}>Pair terminal</SubmitButton>
            </ActionForm>
          </Card>
        ) : null}

        <Card className="p-4">
          <h2 className="mb-1 font-medium">Stripe account{onHelcim ? <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-xs font-normal text-stone-600">not in use</span> : null}</h2>
          <p className="mb-4 text-sm text-stone-600">
            Payments go directly to <span className="font-medium">your own</span> Stripe account. You keep your Stripe dashboard,
            payouts and reports{fee > 0 ? `; the platform takes a ${fee / 100}% fee per card payment` : ""}.
          </p>
          {!configured ? (
            <Notice>
              The platform&apos;s Stripe keys aren&apos;t set. Add <code>STRIPE_SECRET_KEY</code> (and <code>STRIPE_WEBHOOK_SECRET</code>) to the
              server environment, then reload this page.
            </Notice>
          ) : !connected ? (
            <form action={connectStripe}>
              <input type="hidden" name="slug" value={slug} />
              <Button type="submit">Connect with Stripe</Button>
              <p className="mt-2 text-xs text-stone-500">You&apos;ll be taken to Stripe to sign in or create an account, then returned here.</p>
            </form>
          ) : (
            <div className="space-y-3">
              {sp.refresh ? <Notice>Onboarding wasn&apos;t finished. You can continue below.</Notice> : null}
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-stone-500">Account</dt>
                <dd className="font-mono text-xs">{business.stripeAccountId}</dd>
                <dt className="text-stone-500">Details submitted</dt>
                <dd>{business.stripeDetailsSubmitted ? "Yes" : "Not yet"}</dd>
                <dt className="text-stone-500">Charges enabled</dt>
                <dd className={ready ? "text-emerald-700" : "text-amber-700"}>{ready ? "Yes — you can take card payments" : "Not yet"}</dd>
              </dl>
              <div className="flex flex-wrap gap-2">
                {!ready ? (
                  <form action={connectStripe}>
                    <input type="hidden" name="slug" value={slug} />
                    <Button type="submit">Continue Stripe onboarding</Button>
                  </form>
                ) : null}
                <form action={refreshStripe}>
                  <input type="hidden" name="slug" value={slug} />
                  <Button type="submit" variant="secondary">Refresh status</Button>
                </form>
                <a href="https://dashboard.stripe.com/" target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-lg px-3 text-sm text-brand-700 underline">
                  Open Stripe dashboard
                </a>
                <form action={disconnectStripe}>
                  <input type="hidden" name="slug" value={slug} />
                  <ConfirmSubmit title="Disconnect Stripe?" body="Card payments stop until you reconnect. Your Stripe account and its history are unaffected." confirmLabel="Disconnect" variant="ghost">Disconnect</ConfirmSubmit>
                </form>
              </div>
            </div>
          )}
        </Card>

        {multi ? (
          <Card className="p-4 lg:col-span-2">
            <h2 className="mb-1 font-medium">Locations</h2>
            <p className="mb-3 text-sm text-stone-600">
              Each location is paid out through the main account above unless it is a separate business with its own Stripe account.
              Sales, deposits, refunds, saved cards and membership renewals follow the location of the visit.
            </p>
            <ul className="divide-y divide-stone-100">
              {locations.map((l) => {
                const own = !!l.stripeAccountId;
                const lReady = own && l.stripeChargesEnabled;
                return (
                  <li key={l.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{l.name}{l.isDefault ? <span className="ml-2 rounded bg-brand-100 px-1.5 py-0.5 text-xs text-brand-800">default</span> : null}</p>
                      {own ? (
                        <p className="text-xs text-stone-500">Own account <span className="font-mono">{l.stripeAccountId}</span> · {lReady ? <span className="text-emerald-700">charges enabled</span> : <span className="text-amber-700">onboarding not finished</span>}</p>
                      ) : (
                        <p className="text-xs text-stone-500">Uses the main Stripe account{connected ? "" : " (not connected yet)"}</p>
                      )}
                      <p className="text-xs text-stone-500">Sales tax {l.taxRateBps == null ? `${(business.taxRateBps / 100).toFixed(2)}% (business default)` : `${(l.taxRateBps / 100).toFixed(2)}%`} · <Link href={`/app/${slug}/settings/locations/${l.id}`} className="text-brand-700 underline">edit location</Link></p>
                    </div>
                    {configured ? (
                      <div className="flex flex-wrap gap-2">
                        {!own ? (
                          <form action={connectStripe}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="locationId" value={l.id} /><Button type="submit" size="sm" variant="secondary">Connect its own Stripe account</Button></form>
                        ) : (
                          <>
                            {!lReady ? <form action={connectStripe}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="locationId" value={l.id} /><Button type="submit" size="sm">Continue onboarding</Button></form> : null}
                            <form action={refreshStripe}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="locationId" value={l.id} /><Button type="submit" size="sm" variant="secondary">Refresh</Button></form>
                            <form action={disconnectStripe}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="locationId" value={l.id} /><ConfirmSubmit title={`Use the main account for ${l.name}?`} body="New card payments at this location go to the main Stripe account. Past payments stay where they were taken." confirmLabel="Use main account" variant="ghost">Use main account</ConfirmSubmit></form>
                          </>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : null}

        <Card className="p-4">
          <h2 className="mb-1 font-medium">Sales tax</h2>
          <p className="mb-3 text-sm text-stone-600">Applied to taxable product lines at checkout. Services are not taxed.{multi ? " A location can override this on its own page." : ""}</p>
          <ActionForm action={saveTax} className="flex items-end gap-2">
            <input type="hidden" name="slug" value={slug} />
            <Field label="Rate (%)" name="taxPct">
              <Input name="taxPct" type="number" step="0.01" min={0} max={30} defaultValue={(business.taxRateBps / 100).toFixed(2)} className="w-32" />
            </Field>
            <SubmitButton variant="secondary" pendingText="Saving…">Save</SubmitButton>
          </ActionForm>
        </Card>

        <Card className="p-4">
          <h2 className="mb-1 font-medium">Receipt footer</h2>
          <p className="mb-3 text-sm text-stone-600">A line at the bottom of printed, emailed and texted receipts: your return policy, a tax number, a thank-you.</p>
          <ActionForm action={saveReceiptFooter} className="space-y-2">
            <input type="hidden" name="slug" value={slug} />
            <Field label="Footer" name="footer">
              <Textarea name="footer" rows={3} maxLength={400} defaultValue={business.receiptFooter ?? ""} placeholder="Returns within 14 days with receipt." />
            </Field>
            <SubmitButton variant="secondary" pendingText="Saving…">Save</SubmitButton>
          </ActionForm>
        </Card>

        <Card className="p-4 lg:col-span-2">
          <h2 className="mb-1 font-medium">Webhook</h2>
          <p className="text-sm text-stone-600">
            In the platform&apos;s Stripe dashboard, add a <span className="font-medium">Connect</span> webhook endpoint pointing at
            <code className="mx-1 rounded bg-stone-100 px-1">{process.env.NEXT_PUBLIC_APP_URL}/api/stripe/webhook</code>
            listening for <code>account.updated</code>, <code>payment_intent.succeeded</code>, <code>payment_intent.payment_failed</code> and
            <code> charge.refunded</code>. Put its signing secret in <code>STRIPE_WEBHOOK_SECRET</code>.
          </p>
        </Card>
      </div>
    </>
  );
}
