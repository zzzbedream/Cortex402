"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
  Play,
  Search,
  RefreshCcw,
  ArrowRight,
} from "lucide-react";

// Dynamic imports — stellar-sdk uses Node.js APIs that break during SSR
const AutoDemo = dynamic(
  () => import("@/components/AutoDemo"),
  { ssr: false, loading: () => <DemoSkeleton /> }
);

function DemoSkeleton() {
  return (
    <div className="card-dark animate-pulse">
      <div className="h-5 w-48 rounded bg-white/10" />
      <div className="mt-3 h-4 w-72 rounded bg-white/5" />
      <div className="mt-6 h-10 w-44 rounded-full bg-white/5" />
    </div>
  );
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";
const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL ||
  "https://horizon-testnet.stellar.org";
const USDC_ISSUER =
  process.env.NEXT_PUBLIC_USDC_ISSUER ||
  "GBBD47IF6LWK7P7MDEVXWR7SDVQDU5KPF5AMDNH2FUAQNQYJ3Q37LWRC";

// ─── VPS Monitor ─────────────────────────────────────────────────────────────

type HealthData = {
  status: string;
  uptime: number;
  cacheSize: number;
  memoStoreSize: number;
} | null;

function VpsMonitor() {
  const [health, setHealth] = useState<HealthData>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [lastCheck, setLastCheck] = useState<string>("");

  const check = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
        setOnline(true);
      } else {
        setOnline(false);
      }
    } catch {
      setOnline(false);
    }
    setLastCheck(new Date().toLocaleTimeString());
  }, []);

  useEffect(() => {
    if (!API_URL) return;
    check();
    const interval = setInterval(check, 30_000);
    return () => clearInterval(interval);
  }, [check]);

  return (
    <div className="card-dark">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
          <Activity className="h-5 w-5 text-brand-400" />
          VPS Monitor
        </h2>
        <button onClick={check} className="text-gray-500 hover:text-white">
          <RefreshCcw className="h-4 w-4" />
        </button>
      </div>

      {!API_URL && (
        <p className="mt-4 text-sm text-yellow-400/80">
          Configure NEXT_PUBLIC_API_URL to enable monitoring.
        </p>
      )}

      {API_URL && (
        <div className="mt-6 grid grid-cols-2 gap-4">
          <Stat
            label="Status"
            value={
              online === null ? (
                <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
              ) : online ? (
                <span className="flex items-center gap-1 text-emerald-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  Online
                </span>
              ) : (
                <span className="flex items-center gap-1 text-red-400">
                  <span className="h-2 w-2 rounded-full bg-red-400" />
                  Offline
                </span>
              )
            }
          />
          <Stat
            label="Uptime"
            value={
              health ? formatUptime(health.uptime) : "--"
            }
          />
          <Stat
            label="Cache entries"
            value={health?.cacheSize ?? "--"}
          />
          <Stat
            label="Active memos"
            value={health?.memoStoreSize ?? "--"}
          />
        </div>
      )}

      {lastCheck && (
        <p className="mt-4 text-xs text-gray-600">
          Last check: {lastCheck} (auto-refreshes every 30s)
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ─── Agent Simulator ─────────────────────────────────────────────────────────

type SimStep = {
  label: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
  ts?: string;
};

function AgentSimulator() {
  const [steps, setSteps] = useState<SimStep[]>([]);
  const [running, setRunning] = useState(false);

  async function simulate() {
    setRunning(true);
    const simSteps: SimStep[] = [
      { label: "POST /payment/intent", status: "running", ts: ts() },
      { label: "Build Stellar transaction", status: "pending" },
      { label: "Sign & submit to Horizon", status: "pending" },
      { label: "POST /payment/verify", status: "pending" },
      { label: "Receive 200 OK", status: "pending" },
    ];
    setSteps([...simSteps]);

    try {
      // 1: intent
      const intentRes = await fetch(`${API_URL}/payment/intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: "0.15", asset: "USDC" }),
      });
      const intent = await intentRes.json();
      simSteps[0] = done(simSteps[0], `memo: ${mask(intent.memo_hash)}`);
      simSteps[1] = run(simSteps[1]);
      setSteps([...simSteps]);

      // 2: simulate build
      await delay(800);
      simSteps[1] = done(simSteps[1], "MemoHash attached, 0.15 USDC");
      simSteps[2] = run(simSteps[2]);
      setSteps([...simSteps]);

      // 3: simulate sign+submit
      await delay(1500);
      simSteps[2] = done(
        simSteps[2],
        "Simulated — tx_hash: " + fakeHash()
      );
      simSteps[3] = run(simSteps[3]);
      setSteps([...simSteps]);

      // 4: verify
      const verifyRes = await fetch(`${API_URL}/payment/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memo_hash: intent.memo_hash }),
      });
      const verify = await verifyRes.json();
      simSteps[3] = done(
        simSteps[3],
        verify.verified ? "Verified on-chain" : verify.message || "Pending"
      );
      simSteps[4] = done(simSteps[4], "Resource delivered (simulated)");
      setSteps([...simSteps]);
    } catch (err) {
      const i = simSteps.findIndex((s) => s.status === "running");
      if (i >= 0) {
        simSteps[i] = {
          ...simSteps[i],
          status: "error",
          detail: err instanceof Error ? err.message : "Error",
          ts: ts(),
        };
        setSteps([...simSteps]);
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="card-dark">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
        <Play className="h-5 w-5 text-brand-400" />
        Agent Simulator
      </h2>
      <p className="mt-1 text-sm text-gray-400">
        Simulate a full 402 payment flow against the live middleware.
      </p>

      <button
        onClick={simulate}
        disabled={running || !API_URL}
        className="btn-primary mt-4 text-sm disabled:opacity-50"
      >
        {running ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Play className="mr-2 h-4 w-4" />
        )}
        {running ? "Simulating..." : "Start Simulation"}
      </button>

      {steps.length > 0 && (
        <div className="mt-6 space-y-2">
          {steps.map((step, i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2"
            >
              <StepIcon status={step.status} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-300">{step.label}</p>
                {step.detail && (
                  <p className="mt-0.5 truncate text-xs font-mono text-gray-500">
                    {step.detail}
                  </p>
                )}
              </div>
              {step.ts && (
                <span className="shrink-0 text-[10px] text-gray-600">
                  {step.ts}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Trustline Verifier ──────────────────────────────────────────────────────

function TrustlineVerifier() {
  const [address, setAddress] = useState("");
  const [result, setResult] = useState<null | {
    found: boolean;
    balance?: string;
    xlm?: string;
    trustlines?: number;
  }>(null);
  const [loading, setLoading] = useState(false);

  async function verify() {
    if (!address || address.length !== 56 || !address.startsWith("G")) return;
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch(`${HORIZON_URL}/accounts/${address}`);
      if (!res.ok) {
        setResult({ found: false });
        return;
      }
      const data = await res.json();
      const balances: Array<{
        asset_type: string;
        asset_code?: string;
        asset_issuer?: string;
        balance: string;
      }> = data.balances || [];

      const usdc = balances.find(
        (b) => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER
      );
      const xlm = balances.find((b) => b.asset_type === "native");

      setResult({
        found: true,
        balance: usdc?.balance,
        xlm: xlm?.balance,
        trustlines: balances.filter((b) => b.asset_type !== "native").length,
      });
    } catch {
      setResult({ found: false });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card-dark">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
        <Search className="h-5 w-5 text-brand-400" />
        Trustline Verifier
      </h2>
      <p className="mt-1 text-sm text-gray-400">
        Check if a Stellar Testnet account has a USDC trustline.
      </p>

      <div className="mt-4 flex gap-2">
        <input
          type="text"
          value={address}
          onChange={(e) => {
            setAddress(e.target.value.trim());
            setResult(null);
          }}
          placeholder="G... (56 characters)"
          className="flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none transition-colors focus:border-brand-500/50 font-mono"
          maxLength={56}
        />
        <button
          onClick={verify}
          disabled={
            loading ||
            !address ||
            address.length !== 56 ||
            !address.startsWith("G")
          }
          className="btn-glow shrink-0 disabled:opacity-30"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              Verify <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </>
          )}
        </button>
      </div>

      {result && (
        <div className="mt-4 space-y-3">
          {!result.found ? (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
              <XCircle className="h-5 w-5 text-red-400" />
              <p className="text-sm text-red-300">
                Account not found on Testnet
              </p>
            </div>
          ) : (
            <>
              <div
                className={`flex items-center gap-2 rounded-lg border p-3 ${
                  result.balance !== undefined
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-yellow-500/30 bg-yellow-500/5"
                }`}
              >
                {result.balance !== undefined ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                ) : (
                  <XCircle className="h-5 w-5 text-yellow-400" />
                )}
                <div>
                  <p
                    className={`text-sm font-medium ${
                      result.balance !== undefined
                        ? "text-emerald-300"
                        : "text-yellow-300"
                    }`}
                  >
                    {result.balance !== undefined
                      ? "USDC Trustline Active"
                      : "No USDC Trustline"}
                  </p>
                  {result.balance !== undefined && (
                    <p className="text-xs text-gray-400">
                      USDC Balance: {result.balance}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                  <p className="text-xs text-gray-500">XLM Balance</p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    {result.xlm || "0"}
                  </p>
                </div>
                <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                  <p className="text-xs text-gray-500">Trustlines</p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    {result.trustlines ?? 0}
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StepIcon({ status }: { status: SimStep["status"] }) {
  switch (status) {
    case "done":
      return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />;
    case "running":
      return <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-brand-400" />;
    case "error":
      return <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />;
    default:
      return <div className="mt-1 h-3 w-3 shrink-0 rounded-full border border-white/20" />;
  }
}

function done(step: SimStep, detail: string): SimStep {
  return { ...step, status: "done", detail, ts: ts() };
}
function run(step: SimStep): SimStep {
  return { ...step, status: "running", ts: ts() };
}
function ts(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
function mask(s?: string): string {
  if (!s || s.length < 8) return s || "";
  return s.slice(0, 6) + "..." + s.slice(-4);
}
function fakeHash(): string {
  const chars = "abcdef0123456789";
  let h = "";
  for (let i = 0; i < 12; i++) h += chars[Math.floor(Math.random() * 16)];
  return h + "...";
}
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-white">Control Panel</h1>
        <p className="mt-2 text-gray-400">
          Monitor the VPS, simulate agent payments, and verify trustlines.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <VpsMonitor />
        <AgentSimulator />
        <div className="lg:col-span-2">
          <TrustlineVerifier />
        </div>
        <div className="lg:col-span-2">
          <AutoDemo />
        </div>
      </div>
    </div>
  );
}
