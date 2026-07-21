import Link from "next/link";
import { cookies } from "next/headers";
import { logoutAction } from "../actions/auth";

export default async function Header() {
    const cookieStore = await cookies();
    const isAuthenticated = Boolean(cookieStore.get("access_token")?.value);

    return (
        <header className="relative z-10 w-full max-w-7xl mx-auto px-6 py-6 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 group">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-nanobank-blue-green to-nanobank-blue-sky flex items-center justify-center font-bold text-nanobank-blue-deep shadow-md transform group-hover:scale-105 transition-transform">
                    N
                </div>
                <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-100 to-nanobank-blue-sky bg-clip-text text-transparent">
                    Nano-Bank
                </span>
            </Link>

            {isAuthenticated ? (
                <div className="flex items-center gap-6">
                    <Link
                        href="/dashboard"
                        className="text-sm font-medium text-nanobank-blue-sky hover:text-white transition-colors duration-200"
                    >
                        Dashboard
                    </Link>
                    <form action={logoutAction}>
                        <button
                            type="submit"
                            className="text-sm font-medium text-nanobank-blue-sky hover:text-white transition-colors duration-200"
                        >
                            Log out
                        </button>
                    </form>
                </div>
            ) : (
                <Link
                    href="/auth/signin"
                    className="text-sm font-medium text-nanobank-blue-sky hover:text-white transition-colors duration-200"
                >
                    Sign In
                </Link>
            )}
        </header>
    );
}
