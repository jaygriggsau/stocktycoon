import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "StockTycoon",
  description: "A large-scale realistic stock market simulator with 5,000 living companies.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">
        <Nav />
        <main className="mx-auto max-w-7xl px-4 pb-16 pt-6">{children}</main>
        <footer className="border-t border-edge py-6 text-center text-xs text-ink-muted">
          StockTycoon — a simulated market. No real money, no real securities.
        </footer>
      </body>
    </html>
  );
}
