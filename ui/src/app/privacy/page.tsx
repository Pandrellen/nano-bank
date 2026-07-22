export default function Page() {
  return (
    <main className="relative z-10 flex-1 px-6 py-12">
      <div className="w-full max-w-3xl mx-auto bg-gradient-to-br from-white/10 to-white/5 border border-white/15 backdrop-blur-xl rounded-2xl p-8 md:p-12 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-nanobank-blue-sky bg-clip-text text-transparent">
          Privacy Policy
        </h1>
        <p className="text-slate-400 text-sm mt-2">
          Last updated: {new Date().getFullYear()}
        </p>

        <div className="mt-8 space-y-8 text-sm leading-relaxed text-slate-300">
          <p>
            Nano-Bank is an experimental, vibe-coded banking project built for demonstration
            purposes. This policy explains, in plain terms, what information the app handles
            and how it&apos;s used. It is not a substitute for the privacy policy of a real
            financial institution.
          </p>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-white">Information We Collect</h2>
            <p>
              When you create an account, we collect the details you provide directly: your
              name, email address, phone number, date of birth, and Social Insurance Number
              (SIN). We also record account and transaction activity you generate while using
              the product, such as deposits, withdrawals, transfers, and card or wire
              transactions.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-white">How We Use Information</h2>
            <p>
              We use your information to open and maintain your account, authenticate you when
              you sign in, process the transactions you request, and detect fraudulent or
              unauthorized activity. We do not sell your personal information to third parties.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-white">Data Security</h2>
            <p>
              Passwords are hashed before storage and are never stored or logged in plain text.
              Access to your account is protected by short-lived session tokens, and sign-in
              attempts are rate-limited to guard against credential-guessing attacks.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-white">Third-Party Sharing</h2>
            <p>
              Payment rails such as Interac e-Transfer, AFT/EFT, and Lynx wires necessarily
              share the minimum transaction details required to move funds between financial
              institutions. We do not share your information with anyone else except where
              required by law.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-white">Your Rights</h2>
            <p>
              You may request a copy of the personal information we hold about you, or ask that
              it be corrected or deleted, by contacting us using the details below.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-white">Contact Us</h2>
            <p>
              Questions about this policy can be directed to{" "}
              <a href="mailto:privacy@nano.bank" className="text-nanobank-blue-sky hover:underline">
                privacy@nano.bank
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
