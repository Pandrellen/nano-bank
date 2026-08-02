export default function Loading() {
    return (
        <main className="relative z-10 flex-1 flex items-center justify-center px-6 py-12">
            <div className="w-full max-w-3xl bg-gradient-to-br from-white/10 to-white/5 border border-white/15 backdrop-blur-xl rounded-2xl p-8 shadow-[0_20px_50px_rgba(0,0,0,0.5)] animate-pulse">
                <div className="mb-8">
                    <div className="h-8 w-64 rounded-md bg-white/10" />
                    <div className="h-4 w-40 rounded-md bg-white/10 mt-3" />
                </div>

                <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/30 p-8 h-32" />
            </div>
        </main>
    );
}
