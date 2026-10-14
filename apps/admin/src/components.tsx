import { logout } from "@/app/login/actions";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <nav className="flex items-baseline gap-5">
          <a href="/" className="text-lg font-semibold">Platform admin</a>
          <a href="/" className="text-sm text-stone-600 hover:text-stone-900">Tenants</a>
          <a href="/pricing" className="text-sm text-stone-600 hover:text-stone-900">Pricing</a>
        </nav>
        <form action={logout}>
          <button className="text-sm text-stone-600 hover:text-stone-900">Sign out</button>
        </form>
      </header>
      {children}
    </div>
  );
}

const TONE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800",
  trialing: "bg-sky-100 text-sky-800",
  past_due: "bg-amber-100 text-amber-800",
  unpaid: "bg-red-100 text-red-800",
  canceled: "bg-stone-200 text-stone-700",
};

export function StatusPill({ status }: { status: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE[status] ?? "bg-stone-100 text-stone-700"}`}>{status.replace(/_/g, " ")}</span>;
}

export function date(d: Date | string | null): string {
  return d ? new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—";
}
