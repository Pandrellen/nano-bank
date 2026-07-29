"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled error in route segment:", error);
  }, [error]);

  return (
    <main className="relative z-10 flex-1 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg text-center bg-gradient-to-br from-white/10 to-white/5 border border-white/15 backdrop-blur-xl rounded-2xl p-8 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
        <div className="mx-auto mb-6 w-14 h-14 rounded-full bg-nanobank-orange-deep/10 border border-nanobank-orange-deep/30 flex items-center justify-center text-2xl">
          ⚠️
        </div>

        <h1 className="text-2xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-nanobank-blue-sky bg-clip-text text-transparent">
          Something went wrong
        </h1>

        <p className="text-slate-400 text-sm mt-3 leading-relaxed">
          We hit a snag reaching Nano-Bank. Your session is untouched — this looks like a
          temporary issue on our end, not something wrong with your account.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-8">
          <button
            type="button"
            onClick={reset}
            className="px-6 py-3 rounded-xl font-bold text-center text-nanobank-blue-deep bg-gradient-to-r from-nanobank-blue-sky via-nanobank-blue-green to-nanobank-amber-deep bg-[size:200%_auto] hover:bg-right transition-all duration-500 shadow-[0_0_20px_rgba(33,158,188,0.3)] hover:shadow-[0_0_30px_rgba(251,133,0,0.5)] transform hover:-translate-y-0.5 active:translate-y-0"
          >
            Try again
          </button>
          <Link
            href="/"
            className="px-6 py-3 rounded-xl font-semibold text-center border border-slate-700 hover:border-slate-500 bg-slate-900/30 hover:bg-slate-900/50 transition-all duration-300 backdrop-blur-sm"
          >
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
