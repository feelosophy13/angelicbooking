import Link from "next/link";
import { Wordmark } from "@/components/brand";

/** Plain long-form page used for help and legal text. */
export function DocPage({ title, updated, children }: { title: string; updated?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link href="/"><Wordmark /></Link>
          <nav className="flex gap-4 text-sm text-stone-600">
            <Link href="/help" className="hover:text-stone-900">Help</Link>
            <Link href="/sign-in" className="hover:text-stone-900">Sign in</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {updated ? <p className="mt-1 text-sm text-stone-500">Last updated {updated}</p> : null}
        <div className="prose-doc mt-8 space-y-4 text-[15px] leading-relaxed text-stone-800 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_a]:text-brand-700 [&_a]:underline">{children}</div>
      </main>
      <LegalFooter />
    </div>
  );
}

export function LegalFooter({ className = "" }: { className?: string }) {
  return (
    <footer className={`mx-auto flex max-w-3xl flex-wrap justify-center gap-x-4 gap-y-1 px-4 py-8 text-xs text-stone-400 ${className}`}>
      <span>© {new Date().getFullYear()} Angelic Booking</span>
      <Link href="/help" className="hover:text-stone-600">Help</Link>
      <Link href="/privacy" className="hover:text-stone-600">Privacy</Link>
      <Link href="/terms" className="hover:text-stone-600">Terms</Link>
      {process.env.SUPPORT_EMAIL ? <a href={`mailto:${process.env.SUPPORT_EMAIL}`} className="hover:text-stone-600">Contact</a> : null}
    </footer>
  );
}
