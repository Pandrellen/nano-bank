import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Header from "../../components/Header";
import Footer from "../../components/Footer";
import TokenCountdown from "../../components/TokenCountdown";
import { decodeJwtExpiry } from "../../lib/jwt";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8081";

interface CustomerProfile {
    first_name: string;
    last_name: string;
    email: string;
}

export default async function Page() {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get("access_token")?.value;

    if (!accessToken) {
        redirect("/auth/signin");
    }

    let profile: CustomerProfile | null = null;
    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/customers/profile`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: "no-store",
        });
        if (response.ok) {
            profile = await response.json();
        }
    } catch (error) {
        console.error("Failed to verify session:", error);
    }

    if (!profile) {
        redirect("/auth/signin");
    }

    const tokenExpiry = decodeJwtExpiry(accessToken);

    return (
        <div className="relative min-h-screen flex flex-col justify-between bg-nanobank-blue-deep text-white overflow-hidden font-sans">
            {/* Background Gradient Orbs and Grid */}
            <div className="absolute inset-0 z-0">
                {/* Ambient background grid */}
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#0c2b3e_1px,transparent_1px),linear-gradient(to_bottom,#0c2b3e_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-60"></div>

                {/* Glow effects */}
                <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-nanobank-blue-sky/20 blur-[120px]"></div>
                <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-nanobank-orange-deep/10 blur-[120px]"></div>
            </div>

            <Header />

            {/* Main Content */}
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

            <Footer />
        </div>
    );
}
