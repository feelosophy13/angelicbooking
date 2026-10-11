import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listMyBusinesses } from "@/lib/tenant";
import { LinkButton } from "@/components/ui";
import { Landing } from "@/components/landing";

export default async function Home() {
  const session = await getSession();
  if (session) {
    const mine = await listMyBusinesses(session.user.id);
    if (mine.length === 1) redirect(`/app/${mine[0]!.slug}`);
    if (mine.length === 0) redirect("/onboarding");
    // Several businesses: the roll-up page, which also lists them.
    redirect("/app");
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
  return <Landing />;
}
