import Link from "next/link";
import SignupForm from "./SignupForm";

export default async function Page() {
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

            {/* Header */}
            <header className="relative z-10 w-full max-w-7xl mx-auto px-6 py-6 flex items-center justify-between">
                <Link href="/" className="flex items-center gap-2 group">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-nanobank-blue-green to-nanobank-blue-sky flex items-center justify-center font-bold text-nanobank-blue-deep shadow-md transform group-hover:scale-105 transition-transform">
                        N
                    </div>
                    <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-100 to-nanobank-blue-sky bg-clip-text text-transparent">
                        Nano-Bank
                    </span>
                </Link>
            </header>

            {/* Main Form Container */}
            <main className="relative z-10 flex-1 flex items-center justify-center px-6 py-12">
                <div className="w-full max-w-lg bg-gradient-to-br from-white/10 to-white/5 border border-white/15 backdrop-blur-xl rounded-2xl p-8 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
                    {/* Form Header */}
                    <div className="text-center mb-8">
                        <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-nanobank-blue-sky bg-clip-text text-transparent">
                            Create an Account
                        </h2>
                        <p className="text-slate-400 text-sm mt-2">
                            Start your micro-banking journey with Nano-Bank today.
                        </p>
                    </div>

                    {/* Render Form */}
                    <SignupForm />

                    {/* Redirect link */}
                    <div className="text-center mt-6 text-xs text-slate-400">
                        Already have an account?{" "}
                        <Link href="/auth/signin" className="text-nanobank-blue-sky font-semibold hover:underline">
                            Sign in here
                        </Link>
                    </div>
                </div>
            </main>

            {/* Footer */}
            <footer className="relative z-10 w-full max-w-7xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between border-t border-white/5 gap-4">
                <p className="text-xs text-slate-500">&copy; {new Date().getFullYear()} Nano-Bank. All rights reserved.</p>
                <div className="flex gap-6 text-xs text-slate-500">
                    <a href="#" className="hover:text-slate-300 transition-colors">Privacy Policy</a>
                    <a href="#" className="hover:text-slate-300 transition-colors">Terms of Service</a>
                </div>
            </footer>
        </div>
    );
}
