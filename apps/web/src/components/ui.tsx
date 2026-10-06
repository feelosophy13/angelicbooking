import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

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
}: {
  className?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
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

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-2 focus:outline-offset-0 focus:outline-brand-500",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-900 focus:outline-2 focus:outline-offset-0 focus:outline-brand-500",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-2 focus:outline-offset-0 focus:outline-brand-500",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1 block text-sm font-medium text-stone-700", className)} {...props} />;
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
      {hint ? <p className="mt-1 text-xs text-stone-500">{hint}</p> : null}
    </div>
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-stone-200 bg-white shadow-sm", className)} {...props} />;
}

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children ? <div className="flex items-center gap-2">{children}</div> : null}
    </div>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-stone-300 p-10 text-center">
      <p className="font-medium text-stone-700">{title}</p>
      {body ? <p className="mt-1 text-sm text-stone-500">{body}</p> : null}
    </div>
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
