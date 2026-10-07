import Link from "next/link";
import { Wordmark } from "@/components/brand";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
      <Wordmark />
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-stone-600">The link may be wrong, or the page may have moved.</p>
      <Link href="/" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">Go home</Link>
    </main>
  );
}
