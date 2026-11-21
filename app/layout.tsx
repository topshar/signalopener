import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "SignalOpener - Evidence-backed cold email openers",
  description:
    "Paste a company website. Get a three-line founder opener grounded in what the site actually says.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full`}>
      <body className="min-h-full bg-canvas text-ink">{children}</body>
    </html>
  );
}
