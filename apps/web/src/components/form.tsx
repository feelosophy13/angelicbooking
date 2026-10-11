"use client";
import { createContext, isValidElement, useActionState, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import type { FormState } from "@/lib/form";
import { cn } from "@/lib/utils";

type Action = (prev: FormState | undefined, fd: FormData) => Promise<FormState>;
const Ctx = createContext<FormState | undefined>(undefined);
/** Fields announce their visible label so error summaries can use it instead of the input name. */
const LabelsCtx = createContext<((name: string, label: string) => void) | undefined>(undefined);

/**
 * Form bound to a formAction(). Keeps typed values after a failed submit and lets <Field> render
 * its own error under the control. A banner at the top appears only for errors no field on the
 * page shows (a hidden input, a form-level failure), worded with the field's visible label.
 * Edits are guarded: leaving the page with unsaved changes asks first.
 */
export function ActionForm({ action, children, className, onSuccess }: { action: Action; children: React.ReactNode; className?: string; onSuccess?: () => void }) {
  const [state, act] = useActionState(action, undefined);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const register = useCallback((name: string, label: string) => {
    setLabels((cur) => (cur[name] === label ? cur : { ...cur, [name]: label }));
  }, []);
  const formRef = useRef<HTMLFormElement>(null);
  const dirty = useRef(false);
  useEffect(() => {
    if (state?.ok) {
      dirty.current = false;
      onSuccess?.();
    }
  }, [state, onSuccess]);
  // After a failed submit, bring the first field with an error into view.
  useEffect(() => {
    if (!state || state.ok || !state.fieldErrors) return;
    const el = formRef.current?.querySelector<HTMLElement>("[data-field-error]");
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [state]);
  useUnsavedChanges(dirty);
  const fieldErrors = Object.entries(state?.fieldErrors ?? {}).filter(([k]) => k !== "_");
  const unshown = fieldErrors.filter(([k]) => !(k in labels));
  const banner = state?.fieldErrors?._ ?? (unshown.length ? `Please check: ${unshown.map(([k, m]) => `${labels[k] ?? labelFor(k)}: ${m}`).join(" · ")}` : fieldErrors.length ? null : state?.error);
  return (
    <Ctx.Provider value={state}>
      <LabelsCtx.Provider value={register}>
        <form ref={formRef} action={act} className={cn("space-y-4", className)} noValidate onInput={() => { dirty.current = true; }} onSubmit={() => { dirty.current = false; }}>
          {banner ? (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{banner}</div>
          ) : null}
          {children}
        </form>
      </LabelsCtx.Provider>
    </Ctx.Provider>
  );
}

/** "Interval count" from "intervalCount": the fallback when a field never registered a label. */
function labelFor(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_.]+/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Ask before the browser leaves or an in-app link navigates while the form has unsaved edits. */
function useUnsavedChanges(dirty: React.MutableRefObject<boolean>) {
  useEffect(() => {
    const message = "You have unsaved changes. Leave this page?";
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      e.preventDefault();
      e.returnValue = message;
    };
    const onClick = (e: MouseEvent) => {
      if (!dirty.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const to = new URL(a.href, location.href);
      if (to.origin !== location.origin || to.pathname + to.search === location.pathname + location.search) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      } else dirty.current = false;
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);
}

export function useFormState() {
  return useContext(Ctx);
}

/** The id a <Field> assigns to the control inside it; Input/Select/Textarea pick it up when they have none. */
const FieldIdCtx = createContext<string | undefined>(undefined);
export function useFieldId() {
  return useContext(FieldIdCtx);
}

/**
 * Label + control + hint + error. Works inside or outside <ActionForm>.
 * The label points at `f-<name>` (or a stable generated id) and the control inside
 * reads that id from context, so server and client always render the same markup
 * whatever the child is (a plain input, a wrapper div, a server component).
 */
export function Field({ label, name, hint, required, children, className }: { label: string; name?: string; hint?: string; required?: boolean; children: React.ReactNode; className?: string }) {
  const state = useContext(Ctx);
  const auto = useId();
  // Errors are keyed by input name; fall back to the single child's name when the Field has none.
  const childName = isValidElement<{ name?: string }>(children) && typeof children.props.name === "string" ? children.props.name : undefined;
  const fieldName = name ?? childName;
  const id = `f-${(name ?? auto).replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const error = fieldName ? state?.fieldErrors?.[fieldName] : undefined;
  const errId = `${id}-error`;
  const register = useContext(LabelsCtx);
  useEffect(() => {
    if (register && fieldName && label) register(fieldName, label);
  }, [register, fieldName, label]);
  return (
    <div className={className} data-field-error={error ? "" : undefined}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-stone-700">
        {label}
        {required ? <span className="ml-0.5 text-red-500" aria-hidden>*</span> : null}
      </label>
      <div className={cn(error && "[&_input]:border-red-400 [&_select]:border-red-400 [&_textarea]:border-red-400")} aria-describedby={error ? errId : undefined}>
        <FieldIdCtx.Provider value={id}>{children}</FieldIdCtx.Provider>
      </div>
      {error ? <p id={errId} className="mt-1 text-xs text-red-600" role="alert">{error}</p> : hint ? <p className="mt-1 text-xs text-stone-500">{hint}</p> : null}
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
