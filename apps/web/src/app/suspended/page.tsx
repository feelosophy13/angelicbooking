import type { Metadata } from "next";

export const metadata: Metadata = { title: "Account paused", robots: { index: false } };

export default function SuspendedPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 text-center">
      <h1 className="text-xl font-semibold text-stone-900">This account is paused</h1>
      <p className="mt-2 text-sm text-stone-600">
        Access to this business has been paused, and its online booking page is closed. Your data is safe.
        Contact Angelic Booking support to get it reopened.
      </p>
    </main>
  );
}
