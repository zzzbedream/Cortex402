export default function PoweredByStellar() {
  return (
    <section id="powered-by-stellar" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-brand-400">
            Infrastructure
          </p>
          <h2 className="section-heading mt-2">Powered by Stellar</h2>
          <p className="section-subheading mx-auto">
            The Stellar network provides the speed, low cost, and built-in asset
            controls that make machine-to-machine payments practical.
          </p>
        </div>

        {/* Stellar logo + stats */}
        <div className="mt-16 grid gap-8 lg:grid-cols-2 lg:items-center">
          {/* Left: Logo + description */}
          <div className="card-dark flex flex-col items-center p-10 text-center lg:items-start lg:text-left">
            {/* Stellar wordmark */}
            <div className="mb-6 flex items-center gap-3">
              <svg
                viewBox="0 0 40 40"
                className="h-10 w-10 text-white"
                fill="currentColor"
              >
                <path d="M20 0C8.955 0 0 8.955 0 20s8.955 20 20 20 20-8.955 20-20S31.045 0 20 0zm10.865 9.135l-3.73 1.864A11.96 11.96 0 0 0 20 8c-2.93 0-5.617 1.052-7.702 2.798L20 15l10.865-5.865zM8 20c0-2.93 1.052-5.617 2.798-7.702L15 20l-4.202 7.702A11.927 11.927 0 0 1 8 20zm3.135 10.865l1.864-3.73 8.303-4.433L29.135 31A11.927 11.927 0 0 1 20 32c-3.315 0-6.348-1.345-8.865-1.135zM32 20c0 2.93-1.052 5.617-2.798 7.702L25 20l4.202-7.702A11.927 11.927 0 0 1 32 20z" />
              </svg>
              <span className="text-2xl font-bold text-white">
                Stellar Network
              </span>
            </div>
            <p className="text-gray-400 leading-relaxed">
              Stellar&apos;s consensus protocol settles transactions in 3-5 seconds
              with fees under $0.00001. Built-in trustlines let issuers control
              which accounts can hold an asset — perfect for regulated stablecoins
              and machine payments.
            </p>
            <p className="mt-4 text-gray-400 leading-relaxed">
              Cortex402 uses <span className="text-white font-medium">Stellar Testnet</span> with
              the USDC test asset issued
              by <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-brand-300">GBBD...LWRC</code>.
            </p>
          </div>

          {/* Right: Stats */}
          <div className="grid grid-cols-2 gap-4">
            {[
              {
                value: "3-5s",
                label: "Finality",
                detail: "Consensus-based settlement",
              },
              {
                value: "$0.00001",
                label: "Avg. fee",
                detail: "Per transaction",
              },
              {
                value: "1,000+",
                label: "TPS capacity",
                detail: "Network throughput",
              },
              {
                value: "Testnet",
                label: "Network",
                detail: "Safe for development",
              },
            ].map((stat) => (
              <div key={stat.label} className="card-dark text-center">
                <p className="text-3xl font-bold text-white">{stat.value}</p>
                <p className="mt-1 text-sm font-medium text-brand-400">
                  {stat.label}
                </p>
                <p className="mt-1 text-xs text-gray-500">{stat.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
