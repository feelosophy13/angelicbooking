"use client";
import { useEffect, useState } from "react";

/**
 * False until the page's JavaScript has taken over. A form that submits through JavaScript (no `action`) falls back to a plain GET before
 * then, which would put what was typed (name, phone, email) into the address bar. Keep such a form's submit button disabled until this is true;
 * a disabled default button also blocks submitting with Enter.
 */
export function useHydrated(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready;
}
