"use client";
import { createContext, useActionState, useContext, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import type { FormState } from "@/lib/form";
import { cn } from "@/lib/utils";

type Action = (prev: FormState | undefined, fd: FormData) => Promise<FormState>;
const Ctx = createContext<FormState | undefined>(undefined);

/**
 * Form bound to a formAction(). Shows the top-level error, keeps typed values
 * after a failed submit, and lets <Field> render its own error.
 */
export function ActionForm({ action, children, className, onSuccess }: { action: Action; children: React.ReactNode; className?: string; onSuccess?: () => void }) {
  const [state, act] = useActionState(action, undefined);
  useEffect(() => {
    if (state?.ok) onSuccess?.();
  }, [state, onSuccess]);
  return (
    <Ctx.Provider value={state}>
      <form action={act} className={cn("space-y-4", className)} noValidate>
        {state?.error ? (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>
        ) : null}
        {children}
      </form>
    </Ctx.Provider>
  );
}

export function useFormState() {
  return useContext(Ctx);
}

/** Label + control + hint + error. Works inside or outside <ActionForm>. */
export function Field({ label, name, hint, required, children, className }: { label: string; name?: string; hint?: string; required?: boolean; children: React.ReactNode; className?: string }) {
  const state = useContext(Ctx);
  const error = name ? state?.fieldErrors?.[name] : undefined;
  return (
    <div className={className}>
      <label className="mb-1 block text-sm font-medium text-stone-700">
        {label}
        {required ? <span className="ml-0.5 text-red-500" aria-hidden>*</span> : null}
      </label>
      <div className={cn(error && "[&_input]:border-red-400 [&_select]:border-red-400 [&_textarea]:border-red-400")}>{children}</div>
      {error ? <p className="mt-1 text-xs text-red-600" role="alert">{error}</p> : hint ? <p className="mt-1 text-xs text-stone-500">{hint}</p> : null}
    </div>
  );
}

const variants: Record<string, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm",
  secondary: "bg-white text-stone-800 border border-stone-300 hover:bg-stone-50 shadow-sm",
  ghost: "text-stone-700 hover:bg-stone-100",
  danger: "bg-red-600 text-white hover:bg-red-700",
};

/** Submit button that disables itself and shows a spinner while the action runs. */
export function SubmitButton({ children, variant = "primary", size = "md", className, pendingText, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants; size?: "sm" | "md"; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || rest.disabled}
      aria-busy={pending}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
        variants[variant],
        size === "sm" ? "h-8 px-3 text-sm" : "h-10 px-4 text-sm",
        className,
      )}
      {...rest}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {pending && pendingText ? pendingText : children}
    </button>
  );
}

/**
 * A submit button that asks for confirmation first. Renders a small modal
 * (native <dialog>) and submits the enclosing form when confirmed.
 */
export function ConfirmSubmit({ children, title, body, confirmLabel = "Confirm", variant = "danger", size = "sm", className, name, value }: { children: React.ReactNode; title: string; body?: string; confirmLabel?: string; variant?: keyof typeof variants; size?: "sm" | "md"; className?: string; name?: string; value?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn("inline-flex items-center justify-center gap-1 rounded-lg font-medium transition-colors", variants[variant], size === "sm" ? "h-8 px-3 text-sm" : "h-10 px-4 text-sm", className)}>
        {children}
      </button>
      {/* hidden real submit so the enclosing form posts with this button's name/value */}
      <button ref={btn} type="submit" name={name} value={value} className="hidden" tabIndex={-1} aria-hidden />
      <dialog ref={ref} onClose={() => setOpen(false)} className="m-auto w-[min(92vw,26rem)] rounded-xl border border-stone-200 p-0 shadow-xl backdrop:bg-stone-900/40">
        <div className="p-5">
          <h3 className="text-base font-semibold">{title}</h3>
          {body ? <p className="mt-1 text-sm text-stone-600">{body}</p> : null}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-lg border border-stone-300 bg-white px-3 text-sm">Cancel</button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                btn.current?.click();
              }}
              className={cn("h-9 rounded-lg px-3 text-sm font-medium", variants[variant === "ghost" || variant === "secondary" ? "primary" : variant])}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
