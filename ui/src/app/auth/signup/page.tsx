import Link from "next/link";
import SignupForm from "./SignupForm";

export default async function Page() {
    return (
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
    );
}
