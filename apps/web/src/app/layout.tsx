import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Angelic Booking",
  description: "Scheduling and point of sale for salons and spas.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
