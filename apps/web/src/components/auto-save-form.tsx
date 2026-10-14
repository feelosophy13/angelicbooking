"use client";
import { useEffect, useRef } from "react";

/**
 * A row of settings with no Save button: changing a control sends the form (to its server action) once the person is done with it.
 * Buttons inside still work as ordinary submit buttons. Without JavaScript it is a plain form and its buttons submit it.
 */
export function AutoSaveForm({ action, children, className }: { action: (formData: FormData) => void | Promise<void>; children: React.ReactNode; className?: string }) {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const el = form.current;
    if (!el) return;
    const onChange = () => el.requestSubmit();
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, []);
  return <form ref={form} action={action} className={className}>{children}</form>;
}
