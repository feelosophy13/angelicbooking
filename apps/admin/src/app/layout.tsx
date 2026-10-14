import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Platform admin", template: "%s · Platform admin" },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
