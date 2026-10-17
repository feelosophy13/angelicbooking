import type { Metadata } from "next";
import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";

export const metadata: Metadata = { title: "Account paused", robots: { index: false } };

export default function SuspendedPage() {
  const support = process.env.SUPPORT_EMAIL;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 text-center">
      <h1 className="text-xl font-semibold text-stone-900">This account is paused</h1>
      <p className="mt-2 text-sm text-stone-600">
        Access to this business has been paused, and its online booking page is closed. Your data is safe.{" "}
        {support ? (
          <>
            Email <a href={`mailto:${support}?subject=Paused%20account`} className="text-brand-700 underline">{support}</a> with your business name to get it reopened.
          </>
        ) : (
          "Contact Angelic Booking support to get it reopened."
        )}
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/" className="inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium text-brand-700 hover:bg-stone-100">Your other businesses</Link>
        <SignOutButton />
      </div>
    </main>
  );
}
