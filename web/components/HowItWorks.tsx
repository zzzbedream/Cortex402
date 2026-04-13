"use client";

import { FileCode2, CreditCard, ShieldCheck, Zap } from "lucide-react";

const STEPS = [
  {
    icon: FileCode2,
    title: "Agent requests a resource",
    description:
      "An AI agent sends a standard HTTP request to a protected API endpoint. No wallet setup required upfront.",
  },
  {
    icon: CreditCard,
    title: "Middleware returns 402",
    description:
      "Cortex402 intercepts the request and responds with HTTP 402 Payment Required, including a unique memo_hash, amount, and destination.",
  },
  {
    icon: Zap,
    title: "Agent pays on Stellar",
    description:
      "The agent builds, signs, and submits a Stellar transaction with the memo_hash. Settlement completes in under 3 seconds.",
  },
  {
    icon: ShieldCheck,
    title: "Middleware verifies & serves",
    description:
      "Cortex402 verifies the on-chain payment, marks the memo_hash as used (replay protection), and returns the requested resource.",
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6">
        {/* Header */}
        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-brand-400">
            Protocol
          </p>
          <h2 className="section-heading mt-2">How It Works</h2>
          <p className="section-subheading mx-auto">
            Four steps from request to response. No wallet popups, no browser
            extensions, no manual approvals.
          </p>
        </div>

        {/* Steps grid */}
        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <div key={step.title} className="card-dark group relative">
              {/* Step connector line (desktop) */}
              {i < STEPS.length - 1 && (
                <div className="absolute -right-3 top-1/2 hidden h-px w-6 bg-white/10 lg:block" />
              )}

              <div className="step-number mb-4">{i + 1}</div>
              <step.icon className="mb-3 h-6 w-6 text-brand-400 transition-colors group-hover:text-brand-300" />
              <h3 className="text-lg font-semibold text-white">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-400">
                {step.description}
              </p>
            </div>
          ))}
        </div>

        {/* Code preview */}
        <div className="mx-auto mt-16 max-w-3xl overflow-hidden rounded-xl border border-white/10 bg-[#0d1117]">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
            <span className="h-3 w-3 rounded-full bg-red-500/80" />
            <span className="h-3 w-3 rounded-full bg-yellow-500/80" />
            <span className="h-3 w-3 rounded-full bg-green-500/80" />
            <span className="ml-4 text-xs text-gray-500">
              agent &rarr; middleware &rarr; stellar
            </span>
          </div>
          <pre className="overflow-x-auto p-6 text-sm leading-relaxed">
            <code className="text-gray-300">
              <span className="text-gray-500">{"// 1. Agent requests protected resource"}</span>
              {"\n"}
              <span className="text-blue-400">const</span> res ={" "}
              <span className="text-blue-400">await</span>{" "}
              <span className="text-yellow-300">fetch</span>(
              <span className="text-green-400">&quot;/api/compute&quot;</span>);
              {"\n"}
              <span className="text-gray-500">{"// res.status === 402"}</span>
              {"\n\n"}
              <span className="text-gray-500">{"// 2. Extract payment details"}</span>
              {"\n"}
              <span className="text-blue-400">const</span> {"{ "}
              <span className="text-orange-300">memo_hash</span>,{" "}
              <span className="text-orange-300">amount</span>,{" "}
              <span className="text-orange-300">destination</span>
              {" }"} = <span className="text-blue-400">await</span> res.
              <span className="text-yellow-300">json</span>();
              {"\n\n"}
              <span className="text-gray-500">{"// 3. Sign & submit on Stellar (< 3s)"}</span>
              {"\n"}
              <span className="text-blue-400">const</span> tx ={" "}
              <span className="text-blue-400">await</span>{" "}
              <span className="text-yellow-300">signStellarTransaction</span>({"{\n"}
              {"  "}destination, amount, memo_hash, asset:{" "}
              <span className="text-green-400">&quot;USDC&quot;</span>
              {"\n}"});
              {"\n\n"}
              <span className="text-gray-500">{"// 4. Middleware verifies on-chain → 200 OK"}</span>
              {"\n"}
              <span className="text-blue-400">const</span> data ={" "}
              <span className="text-blue-400">await</span>{" "}
              <span className="text-yellow-300">fetch</span>(
              <span className="text-green-400">&quot;/api/compute&quot;</span>,{" "}
              {"{\n"}
              {"  "}headers: {"{ "}
              <span className="text-green-400">&quot;X-Tx-Hash&quot;</span>: tx.hash{" }"}
              {"\n}"});
            </code>
          </pre>
        </div>
      </div>
    </section>
  );
}
