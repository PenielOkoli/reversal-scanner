import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Reversal Scanner",
  description: "Staged double top / double bottom signals across your Bybit watchlist.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-bg-base text-text-primary">{children}</body>
    </html>
  );
}
