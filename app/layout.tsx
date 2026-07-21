import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  metadataBase: new URL("https://postbeacon.app"),
  title: "PostBeacon — know the next growth move, then learn from it.",
  description:
    "Paste your product URL. PostBeacon verifies the facts, chooses one focused growth experiment, prepares the draft, and turns the real result into your next move.",
  openGraph: {
    title: "PostBeacon — one growth experiment at a time",
    description:
      "Start with verified product facts, publish by hand, record the signal, and get the next experiment.",
    url: "https://postbeacon.app",
    siteName: "PostBeacon",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "PostBeacon — know the next growth move",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen font-sans">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
