"use client";

import { useState } from "react";
import {
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  ArrowRight,
} from "lucide-react";

type Step = {
  label: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";
const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL ||
  "https://horizon-testnet.stellar.org";
const USDC_ISSUER =
  process.env.NEXT_PUBLIC_USDC_ISSUER ||
  "GBBD47IF6LWK7P7MDEVXWR7SDVQDU5KPF5AMDNH2FUAQNQYJ3Q37LWRC";

export default function TryItLive() {
  const [wallet, setWallet] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const [trustlineResult, setTrustlineResult] = useState<
    null | { hasTrustline: boolean; balance?: string }
  >(null);

  async function checkTrustline() {
    if (!wallet || wallet.length !== 56 || !wallet.startsWith("G")) return;

    setTrustlineResult(null);
    try {
      const res = await fetch(`${HORIZON_URL}/accounts/${wallet}`);
      if (!res.ok) {
        setTrustlineResult({ hasTrustline: false });
        return;
      }
      const data = await res.json();
      const usdc = data.balances?.find(
        (b: { asset_code?: string; asset_issuer?: string }) =>
          b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER
      );
      setTrustlineResult({
        hasTrustline: !!usdc,
        balance: usdc?.balance,
      });
    } catch {
      setTrustlineResult({ hasTrustline: false });
    }
  }

  async function runDemo() {
    setRunning(true);
    const demoSteps: Step[] = [
      { label: "Checking middleware health", status: "running" },
      { label: "Creating payment intent (402)", status: "pending" },
      { label: "Simulating on-chain payment", status: "pending" },
      { label: "Verifying payment via middleware", status: "pending" },
    ];
    setSteps([...demoSteps]);

    try {
      // Step 1: Health
      const healthRes = await fetch(`${API_URL}/health`);
      if (!healthRes.ok) throw new Error("Middleware unreachable");
      demoSteps[0] = {
        ...demoSteps[0],
        status: "done",
        detail: "VPS online",
      };
      demoSteps[1] = { ...demoSteps[1], status: "running" };
      setSteps([...demoSteps]);

      // Step 2: Intent
      const intentRes = await fetch(`${API_URL}/payment/intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: "0.15", asset: "USDC" }),
      });
      const intent = await intentRes.json();
      const memoShort = intent.memo_hash
        ? `${intent.memo_hash.slice(0, 6)}...${intent.memo_hash.slice(-4)}`
        : "N/A";
      demoSteps[1] = {
        ...demoSteps[1],
        status: "done",
        detail: `memo: ${memoShort}`,
      };
      demoSteps[2] = { ...demoSteps[2], status: "running" };
      setSteps([...demoSteps]);

      // Step 3: Simulate payment (just a delay — real payment would require keys)
      await new Promise((r) => setTimeout(r, 2000));
      demoSteps[2] = {
        ...demoSteps[2],
        status: "done",
        detail: "Simulated (no real keys in browser)",
      };
      demoSteps[3] = { ...demoSteps[3], status: "running" };
      setSteps([...demoSteps]);

      // Step 4: Verify
      const verifyRes = await fetch(`${API_URL}/payment/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memo_hash: intent.memo_hash }),
      });
      const verify = await verifyRes.json();
      demoSteps[3] = {
        ...demoSteps[3],
        status: "done",
        detail: verify.verified
          ? "Payment confirmed on-chain"
          : verify.message || "Not yet confirmed (demo)",
      };
      setSteps([...demoSteps]);
    } catch (err) {
      const current = demoSteps.findIndex((s) => s.status === "running");
      if (current >= 0) {
        demoSteps[current] = {
          ...demoSteps[current],
          status: "error",
          detail: err instanceof Error ? err.message : "Unknown error",
        };
        setSteps([...demoSteps]);
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <section id="try-it-live" className="relative py-24 sm:py-32">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-brand-900/5 to-transparent" />

      <div className="relative mx-auto max-w-7xl px-6">
        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-brand-400">
            Interactive
          </p>
          <h2 className="section-heading mt-2">Try It Live</h2>
          <p className="section-subheading mx-auto">
            Run a demo against the live VPS on Stellar Testnet, or check if your
            wallet has a USDC trustline.
          </p>
        </div>

        <div className="mx-auto mt-16 grid max-w-5xl gap-8 lg:grid-cols-2">
          {/* Left: Demo runner */}
          <div className="card-dark flex flex-col">
            <h3 className="text-lg font-semibold text-white">
              Payment Flow Demo
            </h3>
            <p className="mt-1 text-sm text-gray-400">
              Runs the full 402 flow against the live middleware. No real funds
              are moved from your wallet.
            </p>

            <button
              onClick={runDemo}
              disabled={running || !API_URL}
              className="btn-primary mt-6 disabled:opacity-50"
            >
              {running ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              {running ? "Running..." : "Run Demo"}
            </button>

            {!API_URL && (
              <p className="mt-3 text-xs text-yellow-400/80">
                Set NEXT_PUBLIC_API_URL to enable live demo.
              </p>
            )}

            {/* Steps log */}
            {steps.length > 0 && (
              <div className="mt-6 flex flex-col gap-3">
                {steps.map((step, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3"
                  >
                    {step.status === "done" && (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    )}
                    {step.status === "running" && (
                      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-brand-400" />
                    )}
                    {step.status === "error" && (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                    )}
                    {step.status === "pending" && (
                      <div className="mt-1 h-3 w-3 shrink-0 rounded-full border border-white/20" />
                    )}
                    <div>
                      <p className="text-sm text-gray-300">{step.label}</p>
                      {step.detail && (
                        <p className="mt-0.5 text-xs text-gray-500 font-mono">
                          {step.detail}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Trustline checker */}
          <div className="card-dark flex flex-col">
            <h3 className="text-lg font-semibold text-white">
              Trustline Checker
            </h3>
            <p className="mt-1 text-sm text-gray-400">
              Enter a Stellar Testnet public key to check if it has a USDC
              trustline.
            </p>

            <div className="mt-6 flex gap-2">
              <input
                type="text"
                placeholder="G... (56 characters)"
                value={wallet}
                onChange={(e) => {
                  setWallet(e.target.value.trim());
                  setTrustlineResult(null);
                }}
                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none transition-colors focus:border-brand-500/50"
                maxLength={56}
              />
              <button
                onClick={checkTrustline}
                disabled={
                  !wallet || wallet.length !== 56 || !wallet.startsWith("G")
                }
                className="btn-glow shrink-0 disabled:opacity-30"
              >
                Check
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </button>
            </div>

            {trustlineResult && (
              <div
                className={`mt-4 rounded-lg border p-4 ${
                  trustlineResult.hasTrustline
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-red-500/30 bg-red-500/5"
                }`}
              >
                {trustlineResult.hasTrustline ? (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                    <div>
                      <p className="text-sm font-medium text-emerald-300">
                        USDC Trustline Active
                      </p>
                      {trustlineResult.balance && (
                        <p className="text-xs text-gray-400">
                          Balance: {trustlineResult.balance} USDC
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <XCircle className="h-5 w-5 text-red-400" />
                    <p className="text-sm font-medium text-red-300">
                      No USDC trustline found
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Waitlist */}
            <div id="waitlist" className="mt-auto pt-8">
              <h4 className="text-sm font-semibold text-gray-300">
                Join the Waitlist
              </h4>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.target as HTMLFormElement;
                  const email = new FormData(form).get("email");
                  console.log("[waitlist]", email);
                  form.reset();
                  alert("Thanks! We'll be in touch.");
                }}
                className="mt-3 flex gap-2"
              >
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="you@example.com"
                  className="flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none transition-colors focus:border-brand-500/50"
                />
                <button type="submit" className="btn-primary text-sm">
                  Submit
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
