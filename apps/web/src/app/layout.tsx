import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { readFlash } from "@/lib/flash";
import { Toaster } from "@/components/toaster";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Angelic Booking", template: "%s · Angelic Booking" },
  description: "Scheduling and point of sale for salons and spas.",
  applicationName: "Angelic Booking",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const flash = await readFlash();
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen font-sans">
        {children}
        <Toaster initial={flash} />
      </body>
    </html>
  );
}
