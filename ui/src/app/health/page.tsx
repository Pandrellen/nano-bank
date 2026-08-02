import { API_BASE_URL } from "@/lib/config";

export default async function Page() {
    let result = "";
    try {
        const response = await fetch(`${API_BASE_URL}/health`, { cache: "no-store" });
        if (response.ok) {
            const data = await response.json();
            result = JSON.stringify(data, null, 2);

        } else {
            result = `Error: ${response.status} ${response.statusText}`;
        }
    } catch (error: unknown) {
        result = `Error: ${error instanceof Error ? error.message : String(error)}`;
    }

    return (
        <main className="relative z-10 flex-1 px-6 py-12">
            <div className="w-full max-w-3xl mx-auto bg-gradient-to-br from-white/10 to-white/5 border border-white/15 backdrop-blur-xl rounded-2xl p-8 md:p-12 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
                <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-nanobank-blue-sky bg-clip-text text-transparent">
                    Health Check
                </h1>

                <div className="mt-8 space-y-8 text-sm leading-relaxed text-slate-300">
                    <pre>{result}</pre>
                </div>
            </div>
        </main>

    );
}
