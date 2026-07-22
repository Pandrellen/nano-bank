import Link from "next/link";
import SigninForm from "./SigninForm";

export default async function Page() {
  return (
    <main className="relative z-10 flex-1 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md bg-gradient-to-br from-white/10 to-white/5 border border-white/15 backdrop-blur-xl rounded-2xl p-8 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
        {/* Form Header */}
        <div className="text-center mb-8">
          <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-nanobank-blue-sky bg-clip-text text-transparent">
            Welcome Back
          </h2>
          <p className="text-slate-400 text-sm mt-2">
            Sign in to manage your vibe-coded account.
          </p>
        </div>

        {/* Render Form */}
        <SigninForm />

        {/* Redirect link */}
        <div className="text-center mt-6 text-xs text-slate-400">
          Don&apos;t have an account?{" "}
          <Link href="/auth/signup" className="text-nanobank-blue-sky font-semibold hover:underline">
            Sign up here
          </Link>
        </div>
      </div>
    </main>
  );
}
