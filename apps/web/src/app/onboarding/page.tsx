import { requireSession } from "@/lib/session";
import { OnboardingForm } from "./form";

export default async function OnboardingPage() {
  const session = await requireSession();
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <h1 className="text-2xl font-semibold">Set up your business</h1>
      <p className="mb-6 mt-1 text-sm text-stone-600">Hi {session.user.name.split(" ")[0]}. Tell us about the place you&apos;re booking for.</p>
      <OnboardingForm />
    </main>
  );
}
