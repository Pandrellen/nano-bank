import Link from "next/link";
import Header from "../components/Header";
import Footer from "../components/Footer";

export default function Home() {
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

      {/* Main Hero Section */}
      <main className="relative z-10 flex-1 flex items-center">
        <div className="w-full max-w-7xl mx-auto px-6 py-12 md:py-20 grid md:grid-cols-12 gap-12 items-center">
          {/* Hero Content */}
          <div className="md:col-span-7 space-y-8 text-center md:text-left flex flex-col items-center md:items-start">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-nanobank-blue-sky/30 bg-nanobank-blue-sky/10 text-nanobank-blue-sky text-xs font-semibold tracking-wide backdrop-blur-sm">
              ✨ The Future of Micro-Banking
            </div>
            
            <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight leading-none">
              Welcome to{" "}
              <span className="block mt-2 bg-gradient-to-r from-nanobank-blue-sky via-nanobank-blue-green to-nanobank-amber-deep bg-clip-text text-transparent">
                Nano-Bank
              </span>
            </h1>
            
            <p className="text-lg md:text-xl text-slate-300 max-w-lg leading-relaxed">
              Your vibe-coded bank! Experience lightning-fast transactions, modern micro-savings, and beautiful financial analytics built for the next generation.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
              <Link
                href="/auth/signin"
                className="relative group px-8 py-4 rounded-xl font-bold text-center text-nanobank-blue-deep bg-gradient-to-r from-nanobank-blue-sky via-nanobank-blue-green to-nanobank-amber-deep bg-[size:200%_auto] hover:bg-right transition-all duration-500 shadow-[0_0_20px_rgba(33,158,188,0.3)] hover:shadow-[0_0_30px_rgba(251,133,0,0.5)] transform hover:-translate-y-0.5 active:translate-y-0"
              >
                Get Started
              </Link>
              <Link
                href="#features"
                className="px-8 py-4 rounded-xl font-semibold text-center border border-slate-700 hover:border-slate-500 bg-slate-900/30 hover:bg-slate-900/50 transition-all duration-300 backdrop-blur-sm"
              >
                Learn More
              </Link>
            </div>
          </div>

          {/* Hero Visual (Mock Card) */}
          <div className="md:col-span-5 flex justify-center items-center">
            <div className="relative group w-full max-w-[360px] aspect-[1.586/1] rounded-2xl p-6 bg-gradient-to-br from-white/10 to-white/5 border border-white/20 backdrop-blur-xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] hover:shadow-[0_20px_60px_rgba(142,202,230,0.2)] transition-all duration-500 transform hover:scale-[1.03] hover:-rotate-1">
              {/* Card Glow Overlay */}
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-nanobank-blue-sky/10 via-transparent to-nanobank-orange-deep/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>

              {/* Card Details */}
              <div className="h-full flex flex-col justify-between relative z-10">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-nanobank-blue-sky font-bold">Nano Platinum</p>
                    <p className="text-xs text-slate-300 mt-0.5">Vibe Credit</p>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center font-bold text-sm border border-white/20">
                    N
                  </div>
                </div>

                <div className="my-auto py-4">
                  {/* Card Chip */}
                  <div className="w-10 h-8 rounded-md bg-gradient-to-br from-nanobank-amber-deep to-nanobank-orange-deep opacity-80 mb-4 shadow-inner"></div>
                  <div className="text-xl font-mono tracking-widest text-slate-100">
                    •••• •••• •••• 8820
                  </div>
                </div>

                <div className="flex justify-between items-end">
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-slate-400">Card Holder</p>
                    <p className="text-sm font-semibold tracking-wide text-slate-200">Vibe Coder</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[9px] uppercase tracking-wider text-slate-400">Expires</p>
                    <p className="text-xs font-semibold text-slate-200">12/29</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer
        links={[
          { label: "Privacy Policy", href: "#" },
          { label: "Terms of Service", href: "#" },
          { label: "Contact", href: "#" },
        ]}
      />
    </div>
  );
}
