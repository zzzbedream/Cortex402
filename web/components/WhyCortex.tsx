import {
  Shield,
  Zap,
  RefreshCcw,
  Lock,
  Globe,
  Cpu,
} from "lucide-react";

const FEATURES = [
  {
    icon: Zap,
    title: "No Cold Start",
    description:
      "Ephemeral wallets are initialized in milliseconds. Trustlines are established atomically before the first payment.",
  },
  {
    icon: Shield,
    title: "Replay Protection",
    description:
      "Every payment uses a unique memo_hash. Once verified, it's marked as used — duplicate submissions are rejected instantly.",
  },
  {
    icon: Lock,
    title: "Trustline Enforcement",
    description:
      "The middleware validates that the destination has an active USDC trustline before accepting payment. No lost funds.",
  },
  {
    icon: RefreshCcw,
    title: "Structured Error Recovery",
    description:
      "Stellar error codes (op_no_trust, underfunded, bad_seq) are mapped to typed errors with retryable flags for the AI agent.",
  },
  {
    icon: Globe,
    title: "Edge-Ready Deployment",
    description:
      "Runs on any VPS behind Cloudflare Tunnel. Rate-limited, helmet-hardened, with structured JSON logging out of the box.",
  },
  {
    icon: Cpu,
    title: "AI-Native Design",
    description:
      "Built for LLM tool_use. The agent receives the 402 challenge, orchestrates the payment, and verifies — all autonomously.",
  },
];

export default function WhyCortex() {
  return (
    <section id="features" className="relative py-24 sm:py-32">
      {/* Subtle gradient bg */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-brand-900/5 to-transparent" />

      <div className="relative mx-auto max-w-7xl px-6">
        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-brand-400">
            Features
          </p>
          <h2 className="section-heading mt-2">Why Cortex402</h2>
          <p className="section-subheading mx-auto">
            Security, speed, and developer experience — without compromise.
          </p>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="card-dark group">
              <div className="mb-4 inline-flex rounded-lg border border-brand-500/20 bg-brand-500/10 p-2.5">
                <feature.icon className="h-5 w-5 text-brand-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-400">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
