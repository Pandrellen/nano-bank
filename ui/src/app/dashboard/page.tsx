import TokenCountdown from "@/components/TokenCountdown";
import { decodeJwtExpiry } from "@/lib/jwt";
import { requireSession } from "@/lib/session";
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Nano-Bank - Dashboard',
};

export default async function Page() {
    const { accessToken, profile } = await requireSession();
    const tokenExpiry = decodeJwtExpiry(accessToken);

    return (
        <main className="relative z-10 flex-1 flex items-center justify-center px-6 py-12">
            <div className="w-full max-w-3xl bg-gradient-to-br from-white/10 to-white/5 border border-white/15 backdrop-blur-xl rounded-2xl p-8 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
                <div className="mb-8">
                    <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-nanobank-blue-sky bg-clip-text text-transparent">
                        Welcome back, {profile.first_name}
                    </h1>
                    <p className="text-slate-400 text-sm mt-2">{profile.email}</p>
                    {tokenExpiry !== null && (
                        <p className="text-xs mt-2">
                            <TokenCountdown expiresAt={tokenExpiry} />
                        </p>
                    )}
                </div>

                <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/30 p-8 text-center text-sm text-slate-400">
                    Your accounts, cards, and transactions will show up here.
                </div>
            </div>
        </main>
    );
}
