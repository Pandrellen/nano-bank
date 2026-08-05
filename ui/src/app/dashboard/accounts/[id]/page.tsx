import { requireSession } from "@/lib/session";
import { Metadata } from 'next';
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export const metadata: Metadata = {
  title: 'Nano-Bank - Account Details',
};

type Props = {
  params: Promise<{ id: string }>;
};

export default async function AccountDetailsPage({ params }: Props) {
    await requireSession();
    const { id } = await params;

    return (
        <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-12">
            <div className="w-full max-w-3xl">
                {/* Back Button */}
                <Link href="/dashboard/accounts" className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm mb-6 group">
                    <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
                    Back to Accounts
                </Link>

                {/* Details Card */}
                <div className="w-full bg-gradient-to-br from-white/10 to-white/5 border border-white/15 backdrop-blur-xl rounded-2xl p-8 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
                    <div className="mb-8 border-b border-white/10 pb-6">
                        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-nanobank-blue-sky bg-clip-text text-transparent">
                            Account Details
                        </h1>
                        <p className="text-slate-400 text-xs mt-1 font-mono">
                            Account ID: {id}
                        </p>
                    </div>

                    <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/30 p-8 text-center text-sm text-slate-400">
                        Your account details will show up here.
                    </div>
                </div>
            </div>
        </main>
    );
}
