import Link from "next/link";
import { requireAction } from "@/lib/tenant";
import { listLocations } from "@/server/locations";
import { isStripeConfigured, platformFeeBps } from "@/lib/stripe";
import type { Metadata } from "next";
import { BackLink, Button, Card, Input, Notice, PageHeader } from "@/components/ui";
import { ActionForm, ConfirmSubmit, Field, SubmitButton } from "@/components/form";

export const metadata: Metadata = { title: "Payments" };
import { connectStripe, disconnectStripe, refreshStripe, saveTax } from "./actions";

export default async function PaymentsSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ refresh?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await requireAction(slug, "business.manage");
  const configured = isStripeConfigured();
  const connected = !!business.stripeAccountId;
  const ready = connected && business.stripeChargesEnabled;
  const fee = platformFeeBps();
  const locations = await listLocations(business.id);
  const multi = locations.length > 1;

  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Payments" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-1 font-medium">Stripe account</h2>
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
