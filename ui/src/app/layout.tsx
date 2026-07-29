import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Nano-Bank",
  description: "Nano-Bank",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <div className="relative min-h-screen flex flex-col justify-between bg-nanobank-blue-deep text-white overflow-hidden font-sans">
          {/* Background Gradient Orbs and Grid */}
          <div className="absolute inset-0 z-0">
            {/* Ambient background grid */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#0c2b3e_1px,transparent_1px),linear-gradient(to_bottom,#0c2b3e_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-60"></div>

            {/* Glow effects */}
            <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-nanobank-blue-sky/20 blur-[120px]"></div>
            <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-nanobank-orange-deep/10 blur-[120px]"></div>
          </div>

          <Suspense fallback={null}>
            <Header />
          </Suspense>

          {children}

          <Footer />

          <Toaster position="top-center" richColors />
        </div>
      </body>
    </html>
  );
}
