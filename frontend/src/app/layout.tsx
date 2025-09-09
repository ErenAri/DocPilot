import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import TopNav from "@/components/top-nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DocPilot",
  description: "Evidence-based assistant",
  themeColor: "#0ea5e9",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <div className="min-h-screen bg-gradient-to-br from-slate-950 to-slate-900 text-white">
          <div className="mx-auto max-w-5xl p-4">
            {/* Top navigation */}
            <div className="mb-6">
              <TopNav />
            </div>
            <div className="mb-4 text-right text-sm">
              <a href="/login" className="text-sky-300 hover:text-sky-200 underline">Login</a>
            </div>
            {children}
            <footer className="mt-10 py-6 text-xs text-white/60">
              <div className="border-t border-white/10 pt-4 flex items-center justify-between">
                <div>© {new Date().getFullYear()} DocPilot</div>
                <div className="space-x-3">
                  <a href="/ask" className="hover:underline">Ask</a>
                  <a href="/ops" className="hover:underline">Ops</a>
                </div>
              </div>
            </footer>
          </div>
        </div>
        <Toaster position="top-right" />
      </body>
    </html>
  );
}
