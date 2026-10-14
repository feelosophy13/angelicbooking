"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { previousPath } from "./nav-history";
import { cn } from "@/lib/utils";
import { ArrowLeft, Eye, EyeOff, Inbox } from "lucide-react";
import { useFieldId } from "./form";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

const variants = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm",
  secondary: "bg-white text-stone-800 border border-stone-300 hover:bg-stone-50 shadow-sm",
  ghost: "text-stone-700 hover:bg-stone-100",
  danger: "bg-red-600 text-white hover:bg-red-700",
};
const sizes = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm" };

export function Button({ className, variant = "primary", size = "md", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}

export function LinkButton({
  className,
  variant = "secondary",
  size = "md",
  href,
  children,
  ...rest
}: {
  className?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  href: string;
  children: React.ReactNode;
} & Pick<React.AnchorHTMLAttributes<HTMLAnchorElement>, "aria-label" | "aria-current" | "title" | "target" | "rel">) {
  // aria-label and friends must reach the link: an icon-only button (the calendar's arrows) has no other name.
  return (
    <Link
      href={href}
      {...rest}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors",
        variants[variant!],
        sizes[size!],
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** Every password field is an <Input type="password">, which gets a show / hide button (DESIGN.md, "Forms"). */
export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  const fieldId = useFieldId();
  const [shown, setShown] = React.useState(false);
  const isPassword = props.type === "password";
  const input = (
    <input
      id={props.id ?? fieldId}
      className={cn(
        "h-10 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-2 focus:outline-offset-0 focus:outline-brand-500",
        isPassword && "pr-10",
        className,
      )}
      {...props}
      type={isPassword && shown ? "text" : props.type}
    />
  );
  if (!isPassword) return input;
  const Icon = shown ? EyeOff : Eye;
  return (
    <div className="relative">
      {input}
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        title={shown ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-stone-400 hover:text-stone-700 focus-visible:outline-2 focus-visible:outline-brand-500"
      >
        <Icon className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

/** An amount in the business's currency: symbol on the left, decimal keypad on phones, "0.00" placeholder. */
export function MoneyInput({ currency = "USD", className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { currency?: string }) {
  const symbol = new Intl.NumberFormat("en-US", { style: "currency", currency }).formatToParts(0).find((x) => x.type === "currency")?.value ?? "$";
  return (
    <span className="relative block">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-stone-500" aria-hidden>{symbol}</span>
      <Input inputMode="decimal" placeholder="0.00" className={cn(symbol.length > 1 ? "pl-10" : "pl-7", className)} {...props} />
    </span>
  );
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const fieldId = useFieldId();
  return (
    <select
      id={props.id ?? fieldId}
      className={cn(
        "h-10 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-900 focus:outline-2 focus:outline-offset-0 focus:outline-brand-500",
        className,
      )}
      {...props}
    />
  );
}

/** Multi-line text. Defaults to four visible lines and grows with the user's drag; pass `rows` for more. */
export function Textarea({ className, rows = 4, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const fieldId = useFieldId();
  return (
    <textarea
      id={props.id ?? fieldId}
      rows={rows}
      className={cn(
        "min-h-24 w-full resize-y rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm leading-6 text-stone-900 placeholder:text-stone-400 focus:outline-2 focus:outline-offset-0 focus:outline-brand-500",
        className,
      )}
      {...props}
    />
  );
}

/**
 * One checkbox row for the whole app: a fixed 16px box aligned to the first
 * line of text, the label beside it, and any explanation on its own line
 * underneath (never wrapped around the box). Works controlled or uncontrolled.
 */
export function Checkbox({ label, hint, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className={cn("flex items-start gap-2.5 text-sm", props.disabled && "opacity-60", className)}>
      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 rounded border-stone-300 accent-brand-600" {...props} />
      <span className="min-w-0">
        <span className="block leading-5 text-stone-800">{label}</span>
        {hint ? <span className="block text-xs leading-4 text-stone-500">{hint}</span> : null}
      </span>
    </label>
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1 block text-sm font-medium text-stone-700", className)} {...props} />;
}

export { Field } from "./form";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-stone-200 bg-white shadow-sm", className)} {...props} />;
}

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children ? <div className="flex max-w-full flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: { href: string; label: string } }) {
  return (
    <div className="rounded-xl border border-dashed border-stone-300 p-10 text-center">
      <Inbox className="mx-auto mb-2 h-6 w-6 text-stone-300" aria-hidden />
      <p className="font-medium text-stone-700">{title}</p>
      {body ? <p className="mt-1 text-sm text-stone-500">{body}</p> : null}
      {action ? <div className="mt-4"><LinkButton href={action.href} variant="primary" size="sm">{action.label}</LinkButton></div> : null}
    </div>
  );
}

/**
 * "← Back" link used in page headers. Goes back to wherever the person came from when that was a page
 * of this app (the overview, a search, a client), and reads "Back"; otherwise, e.g. arriving from a
 * bookmark or a new tab, it goes to `href`, the page's natural parent, and reads that page's name.
 */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();
  const [history, setHistory] = React.useState(false);
  React.useEffect(() => {
    try {
      // In-app navigations are recorded by <NavHistory>; a full page load from another page of ours shows as the referrer.
      const ref = document.referrer ? new URL(document.referrer) : null;
      const cameFromUs = !!previousPath() || (!!ref && ref.origin === window.location.origin && ref.pathname !== window.location.pathname);
      setHistory(cameFromUs && window.history.length > 1);
    } catch {
      setHistory(false);
    }
  }, []);
  return (
    <Link
      href={href}
      onClick={(e) => {
        if (!history) return;
        e.preventDefault();
        router.back();
      }}
      className="inline-flex items-center gap-1 text-sm text-stone-600 hover:text-stone-900"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden /> {history ? "Back" : children}
    </Link>
  );
}

export function Notice({ kind = "error", children }: { kind?: "error" | "success"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-lg px-3 py-2 text-sm",
        kind === "error" ? "bg-red-50 text-red-700 border border-red-200" : "bg-green-50 text-green-700 border border-green-200",
      )}
    >
      {children}
    </div>
  );
}

/** Standard wrapper for a dedicated create/edit page: title, back link, one card. */
export function FormPage({ title, backHref, backLabel, children, width = "max-w-2xl" }: { title: string; backHref: string; backLabel: string; children: React.ReactNode; width?: string }) {
  return (
    <>
      <div className="mb-2"><BackLink href={backHref}>{backLabel}</BackLink></div>
      <PageHeader title={title} />
      <Card className={cn("p-5", width)}>{children}</Card>
    </>
  );
}

export { Tabs } from "./tabs";
