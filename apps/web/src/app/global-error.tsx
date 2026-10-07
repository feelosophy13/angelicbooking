"use client";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 32, maxWidth: 520, margin: "0 auto", textAlign: "center" }}>
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>Something went wrong</h1>
        <p style={{ color: "#57534e" }}>We&apos;ve been notified. Please try again, and contact support if it keeps happening.{error.digest ? ` Reference: ${error.digest}` : ""}</p>
        <button onClick={reset} style={{ marginTop: 16, padding: "8px 16px", borderRadius: 8, background: "#6d28d9", color: "#fff", border: 0 }}>Try again</button>
      </body>
    </html>
  );
}
