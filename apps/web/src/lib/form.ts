import { z } from "zod";
import { setFlash } from "./flash";

/** Shape every form action returns so <ActionForm> can render it. */
export interface FormState {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Echo of submitted values so fields keep what the user typed after an error. */
  values?: Record<string, string>;
}

export class FormError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
  }
}

function isNextControlFlow(e: unknown): boolean {
  const digest = (e as { digest?: unknown })?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND"));
}

/**
 * Wrap a zod schema and a handler into a server action usable with useActionState.
 * - zod issues → fieldErrors keyed by path (first message wins)
 * - FormError / known domain errors → top-level error (or a field error)
 * - handler may redirect() (propagated) or return a success message (becomes a toast)
 */
export function formAction<S extends z.ZodTypeAny>(
  schema: S,
  handler: (data: z.infer<S>, formData: FormData) => Promise<string | void>,
  opts: { knownErrors?: Array<new (...args: never[]) => Error> } = {},
) {
  return async (_prev: FormState | undefined, formData: FormData): Promise<FormState> => {
    const raw: Record<string, string> = {};
    for (const [k, v] of formData.entries()) if (typeof v === "string") raw[k] = v;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "_";
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return { fieldErrors, values: raw, error: fieldErrors._ };
    }
    try {
      const message = await handler(parsed.data, formData);
      if (message) await setFlash(message, "success");
      return { ok: true };
    } catch (e) {
      if (isNextControlFlow(e)) throw e;
      if (e instanceof FormError) return e.field ? { fieldErrors: { [e.field]: e.message }, values: raw } : { error: e.message, values: raw };
      if (opts.knownErrors?.some((K) => e instanceof K)) return { error: (e as Error).message, values: raw };
      if (e instanceof Error && /permission/i.test(e.message)) return { error: e.message, values: raw };
      throw e;
    }
  };
}

/** Common zod helpers for form fields (all inputs arrive as strings). */
export const f = {
  text: (min = 1, max = 120) => z.string().trim().min(min, min === 1 ? "Required" : `At least ${min} characters`).max(max, `At most ${max} characters`),
  optional: (max = 500) => z.string().trim().max(max, `At most ${max} characters`).transform((v) => v || null),
  email: () => z.string().trim().email("Enter a valid email").or(z.literal("")).transform((v) => v || null),
  money: (label = "amount") =>
    z
      .string()
      .trim()
      .regex(/^\$?\d{1,7}(\.\d{1,2})?$/, `Enter a valid ${label} like 45 or 45.50`)
      .transform((v) => Math.round(Number(v.replace("$", "")) * 100)),
  moneyOptional: () =>
    z
      .string()
      .trim()
      .regex(/^(\$?\d{1,7}(\.\d{1,2})?)?$/, "Enter an amount like 45 or 45.50")
      .transform((v) => (v ? Math.round(Number(v.replace("$", "")) * 100) : 0)),
  int: (min: number, max: number) => z.coerce.number({ message: "Enter a number" }).int("Whole numbers only").min(min, `At least ${min}`).max(max, `At most ${max}`),
  num: (min: number, max: number) => z.coerce.number({ message: "Enter a number" }).min(min, `At least ${min}`).max(max, `At most ${max}`),
  checkbox: () => z.string().optional().transform((v) => v === "on"),
  isoDate: () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  hhmm: () => z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time"),
  id: () => z.string().min(1, "Required"),
};
