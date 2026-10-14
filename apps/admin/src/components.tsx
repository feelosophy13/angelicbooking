import { logout } from "@/app/login/actions";
import { tenantIndex } from "@/lib/metrics";
import { Badge } from "@/ui/kit";
import { Icon } from "@/ui/icons";
import { MobileMenu, NavLinks } from "@/ui/nav";
import { Palette } from "@/ui/palette";

const WEB_URL = process.env.WEB_APP_URL ?? "https://app.angelicbooking.com";

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-1">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-brand-ink">A</span>
      <div className="leading-tight">
        <div className="text-sm font-semibold">Angelic Booking</div>
        <div className="text-[11px] text-ink-3">Platform admin</div>
      </div>
    </div>
  );
}

function SideFooter() {
  return (
    <div className="space-y-0.5 border-t border-line pt-3">
      <a href={WEB_URL} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink">
        <Icon name="external" /> Open the app
      </a>
      <form action={logout}>
        <button className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink"><Icon name="out" /> Sign out</button>
      </form>
    </div>
  );
}

export async function Shell({ children }: { children: React.ReactNode }) {
  const index = await tenantIndex();
  const prod = process.env.NODE_ENV === "production";
  return (
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col justify-between border-r border-line bg-surface p-4 md:flex">
        <div className="space-y-6">
          <Brand />
          <NavLinks />
        </div>
        <SideFooter />
      </aside>
      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-canvas/90 px-4 py-2.5 backdrop-blur md:px-8">
          <MobileMenu>
            <div className="space-y-6">
              <Brand />
              <NavLinks />
              <SideFooter />
            </div>
          </MobileMenu>
          <Palette tenants={index.map((t) => ({ id: t.id, name: t.name, slug: t.slug, owner: t.owner }))} />
          <span className="ml-auto"><Badge tone={prod ? "good" : "warn"}>{prod ? "Production" : "Local"}</Badge></span>
        </div>
        <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}

export function dateTime(d: Date | string | null): string {
  return d ? new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
}

export function date(d: Date | string | null): string {
  return d ? new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—";
}
