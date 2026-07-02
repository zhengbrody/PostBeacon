import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  metadataBase: new URL("https://postbeacon.app"),
  title: "PostBeacon — your AI CMO. URL in, launch plan out.",
  description:
    "Paste your product URL. PostBeacon scans 19+ platforms, ranks where to go all-in, and writes ready-to-post content + a launch calendar. Built for vibecoders.",
  openGraph: {
    title: "PostBeacon — your AI CMO",
    description:
      "Paste a URL. Get a scored multi-platform launch plan + ready-to-post content.",
    url: "https://postbeacon.app",
    siteName: "PostBeacon",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "PostBeacon — your AI CMO" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen font-sans">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
