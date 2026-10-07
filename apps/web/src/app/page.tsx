import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listMyBusinesses } from "@/lib/tenant";
import { LinkButton } from "@/components/ui";
import { LegalFooter } from "@/components/doc-page";

export default async function Home() {
  const session = await getSession();
  if (session) {
    const mine = await listMyBusinesses(session.user.id);
    if (mine.length === 1) redirect(`/app/${mine[0]!.slug}`);
    if (mine.length === 0) redirect("/onboarding");
    return (
      <main className="mx-auto max-w-md p-8">
        <h1 className="mb-4 text-xl font-semibold">Choose a business</h1>
        <ul className="space-y-2">
          {mine.map((b) => (
            <li key={b.id}>
              <LinkButton href={`/app/${b.slug}`} className="w-full justify-between">
                <span>{b.name}</span>
                <span className="text-xs text-stone-500">{b.role}</span>
              </LinkButton>
            </li>
          ))}
        </ul>
        <div className="mt-6">
          <LinkButton href="/onboarding" variant="ghost">+ Add another business</LinkButton>
        </div>
      </main>
    );
  }
  return (
    <main className="relative mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">Angelic Booking</h1>
      <p className="max-w-md text-stone-600">
        Calendar-first scheduling and checkout for salons and spas. Your clients, your Stripe account, no clutter.
      </p>
      <div className="flex gap-3">
        <LinkButton href="/sign-up" variant="primary">Create an account</LinkButton>
        <LinkButton href="/sign-in">Sign in</LinkButton>
      </div>
      <LegalFooter className="absolute bottom-0 left-0 right-0" />
    </main>
  );
}
