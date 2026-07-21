import Header from "../../components/Header";
import Footer from "../../components/Footer";

export default function Page() {
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
      <main className="relative z-10 flex-1 px-6 py-12">
        <div className="w-full max-w-3xl mx-auto bg-gradient-to-br from-white/10 to-white/5 border border-white/15 backdrop-blur-xl rounded-2xl p-8 md:p-12 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-nanobank-blue-sky bg-clip-text text-transparent">
            Terms of Service
          </h1>
          <p className="text-slate-400 text-sm mt-2">
            Last updated: {new Date().getFullYear()}
          </p>

          <div className="mt-8 space-y-8 text-sm leading-relaxed text-slate-300">
            <p>
              Nano-Bank is an experimental, vibe-coded banking project built for demonstration
              purposes only. By creating an account or otherwise using the app, you agree to
              these terms. Nano-Bank is not a real bank, is not insured, and must not be used to
              hold or move real funds.
            </p>

            <section className="space-y-2">
              <h2 className="text-lg font-bold text-white">Eligibility</h2>
              <p>
                You must be at least 18 years old to create an account. You are responsible for
                providing accurate information during sign-up and for keeping your password
                confidential.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-bold text-white">Account Responsibility</h2>
              <p>
                You are responsible for all activity that occurs under your account. Notify us
                immediately if you believe your credentials have been compromised or if you see
                a transaction you did not authorize.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-bold text-white">Acceptable Use</h2>
              <p>
                You agree not to use Nano-Bank for any unlawful purpose, to attempt to
                circumvent its security controls, or to submit transactions or data that are
                fraudulent, harmful, or not your own.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-bold text-white">No Warranty</h2>
              <p>
                Nano-Bank is provided &quot;as is,&quot; without warranty of any kind, express or
                implied. As an experimental project, features may change, break, or be removed
                without notice, and data may be reset at any time.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-bold text-white">Limitation of Liability</h2>
              <p>
                To the fullest extent permitted by law, Nano-Bank and its creators are not liable
                for any loss or damage arising from your use of, or inability to use, the app.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-bold text-white">Changes to These Terms</h2>
              <p>
                We may update these terms from time to time. Continued use of Nano-Bank after a
                change means you accept the revised terms.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-bold text-white">Contact Us</h2>
              <p>
                Questions about these terms can be directed to{" "}
                <a href="mailto:legal@nano.bank" className="text-nanobank-blue-sky hover:underline">
                  legal@nano.bank
                </a>
                .
              </p>
            </section>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
