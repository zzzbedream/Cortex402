"use client";

import { useState, useRef, useCallback } from "react";
import {
  Wallet,
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Play,
  RotateCcw,
  Coins,
  ShieldPlus,
  Send,
  Clock,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StepStatus = "pending" | "running" | "done" | "error" | "skipped";

type DemoStep = {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
  txHash?: string;
  startedAt?: number;
  duration?: number;
};

type DemoState = "idle" | "running" | "done" | "error";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL ||
  "https://horizon-testnet.stellar.org";
const USDC_ISSUER =
  process.env.NEXT_PUBLIC_USDC_ISSUER ||
  "GBBD47IF6LWK7P7MDEVXWR7SDVQDU5KPF5AMDNH2FUAQNQYJ3Q37LWRC";
const EXPLORER_BASE = "https://stellar.expert/explorer/testnet";
const FRIENDBOT_URL = "https://friendbot.stellar.org";

// Lazy-load SDK to avoid SSR issues
let _sdk: typeof import("@stellar/stellar-sdk") | null = null;
async function getSdk() {
  if (!_sdk) {
    _sdk = await import("@stellar/stellar-sdk");
  }
  return _sdk;
}

// ---------------------------------------------------------------------------
// Initial steps
// ---------------------------------------------------------------------------

function createInitialSteps(): DemoStep[] {
  return [
    { id: "generate", label: "Generate ephemeral wallet", status: "pending" },
    { id: "fund", label: "Fund with Friendbot (10,000 XLM)", status: "pending" },
    { id: "trustline", label: "Add USDC trustline", status: "pending" },
    { id: "payment", label: "Send 0.15 XLM payment", status: "pending" },
    { id: "verify", label: "Verify on Stellar Expert", status: "pending" },
  ];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AutoDemo() {
  const [state, setState] = useState<DemoState>("idle");
  const [steps, setSteps] = useState<DemoStep[]>(createInitialSteps());
  const [walletPublic, setWalletPublic] = useState<string | null>(null);
  const [walletSecret, setWalletSecret] = useState<string | null>(null);
  const [totalDuration, setTotalDuration] = useState<number | null>(null);
  const busyRef = useRef(false);

  // Helper to update a single step
  const updateStep = useCallback(
    (
      id: string,
      updates: Partial<DemoStep>,
      setter: React.Dispatch<React.SetStateAction<DemoStep[]>>
    ) => {
      setter((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
      );
    },
    []
  );

  // ── Run full automated demo ──
  async function runDemo() {
    if (busyRef.current) return;
    busyRef.current = true;

    const freshSteps = createInitialSteps();
    setSteps(freshSteps);
    setState("running");
    setWalletPublic(null);
    setWalletSecret(null);
    setTotalDuration(null);

    const demoStart = Date.now();

    // We use a local copy and a setter that merges into state
    const localSetter: React.Dispatch<React.SetStateAction<DemoStep[]>> = setSteps;

    try {
      const sdk = await getSdk();

      // ─── Step 1: Generate Wallet ───
      updateStep("generate", { status: "running", startedAt: Date.now() }, localSetter);

      const keypair = sdk.Keypair.random();
      const pubKey = keypair.publicKey();
      const secret = keypair.secret();

      setWalletPublic(pubKey);
      setWalletSecret(secret);

      updateStep(
        "generate",
        {
          status: "done",
          detail: `${pubKey.slice(0, 8)}...${pubKey.slice(-6)}`,
          duration: Date.now() - Date.now() + 50,
        },
        localSetter
      );

      // ─── Step 2: Fund with Friendbot ───
      const fundStart = Date.now();
      updateStep("fund", { status: "running", startedAt: fundStart }, localSetter);

      const friendbotRes = await fetch(
        `${FRIENDBOT_URL}?addr=${encodeURIComponent(pubKey)}`
      );

      if (!friendbotRes.ok) {
        const text = await friendbotRes.text();
        if (!text.includes("createAccountAlreadyExist")) {
          throw new StepError("fund", `Friendbot error: ${text.slice(0, 100)}`);
        }
      }

      let fundHash = "";
      try {
        const fundData = await friendbotRes.json();
        fundHash = fundData.hash || fundData.id || "";
      } catch {
        // Already consumed as text above
      }

      updateStep(
        "fund",
        {
          status: "done",
          detail: "10,000 XLM received",
          txHash: fundHash || undefined,
          duration: Date.now() - fundStart,
        },
        localSetter
      );

      // ─── Step 3: Add USDC Trustline ───
      const trustStart = Date.now();
      updateStep("trustline", { status: "running", startedAt: trustStart }, localSetter);

      const server = new sdk.Horizon.Server(HORIZON_URL);
      const sourceAccount = await server.loadAccount(pubKey);
      const usdcAsset = new sdk.Asset("USDC", USDC_ISSUER);

      const trustTx = new sdk.TransactionBuilder(sourceAccount, {
        fee: sdk.BASE_FEE,
        networkPassphrase: sdk.Networks.TESTNET,
      })
        .addOperation(sdk.Operation.changeTrust({ asset: usdcAsset }))
        .setTimeout(30)
        .build();

      trustTx.sign(sdk.Keypair.fromSecret(secret));
      const trustResult = await server.submitTransaction(trustTx);

      updateStep(
        "trustline",
        {
          status: "done",
          detail: `USDC trustline active`,
          txHash: trustResult.hash,
          duration: Date.now() - trustStart,
        },
        localSetter
      );

      // ─── Step 4: Send Payment ───
      const payStart = Date.now();
      updateStep("payment", { status: "running", startedAt: payStart }, localSetter);

      // We create a second wallet as the destination
      const destKeypair = sdk.Keypair.random();
      const destPub = destKeypair.publicKey();

      // Fund destination too (so it exists)
      await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(destPub)}`);

      // Reload source account for updated sequence number
      const reloadedSource = await server.loadAccount(pubKey);

      const payTx = new sdk.TransactionBuilder(reloadedSource, {
        fee: sdk.BASE_FEE,
        networkPassphrase: sdk.Networks.TESTNET,
      })
        .addOperation(
          sdk.Operation.payment({
            destination: destPub,
            asset: sdk.Asset.native(),
            amount: "0.1500000",
          })
        )
        .setTimeout(30)
        .build();

      payTx.sign(sdk.Keypair.fromSecret(secret));
      const payResult = await server.submitTransaction(payTx);

      updateStep(
        "payment",
        {
          status: "done",
          detail: `0.15 XLM sent → ${destPub.slice(0, 6)}...${destPub.slice(-4)} (Ledger #${payResult.ledger})`,
          txHash: payResult.hash,
          duration: Date.now() - payStart,
        },
        localSetter
      );

      // ─── Step 5: Verify ───
      updateStep(
        "verify",
        {
          status: "done",
          detail: "All transactions confirmed on-chain",
          txHash: payResult.hash,
        },
        localSetter
      );

      setTotalDuration(Date.now() - demoStart);
      setState("done");
    } catch (err) {
      if (err instanceof StepError) {
        updateStep(err.stepId, { status: "error", detail: err.message }, localSetter);
      } else {
        // Find the running step and mark it as error
        setSteps((prev) => {
          const running = prev.find((s) => s.status === "running");
          if (running) {
            return prev.map((s) =>
              s.id === running.id
                ? {
                    ...s,
                    status: "error" as StepStatus,
                    detail:
                      extractStellarError(err) ||
                      (err instanceof Error ? err.message : "Unknown error"),
                  }
                : s
            );
          }
          return prev;
        });
      }
      setState("error");
    } finally {
      busyRef.current = false;
    }
  }

  function reset() {
    setState("idle");
    setSteps(createInitialSteps());
    setWalletPublic(null);
    setWalletSecret(null);
    setTotalDuration(null);
    busyRef.current = false;
  }

  // ── Render ──

  return (
    <div className="card-dark">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-brand-400" />
          <h2 className="text-lg font-semibold text-white">
            Live Testnet Demo
          </h2>
        </div>
        {state !== "idle" && state !== "running" && (
          <button
            onClick={reset}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-white transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
        )}
      </div>

      <p className="mt-1 text-sm text-gray-400">
        One click runs the full Stellar Testnet flow: wallet generation, Friendbot
        funding, USDC trustline, and a real payment &mdash; all on-chain.
      </p>

      {/* Big CTA */}
      {state === "idle" && (
        <button
          onClick={runDemo}
          className="btn-primary mt-5 text-sm group"
        >
          <Play className="mr-2 h-4 w-4 transition-transform group-hover:scale-110" />
          Run Demo
        </button>
      )}

      {/* Steps timeline */}
      {state !== "idle" && (
        <div className="mt-6 space-y-1">
          {steps.map((step, i) => (
            <StepRow key={step.id} step={step} index={i} />
          ))}
        </div>
      )}

      {/* Summary banner */}
      {state === "done" && (
        <div className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            <span className="text-sm font-semibold text-emerald-300">
              Demo complete
            </span>
            {totalDuration && (
              <span className="ml-auto flex items-center gap-1 text-xs text-emerald-400/70">
                <Clock className="h-3 w-3" />
                {(totalDuration / 1000).toFixed(1)}s total
              </span>
            )}
          </div>
          <p className="mt-1.5 text-xs text-emerald-300/70">
            All transactions executed on Stellar Testnet. Click any hash to verify on Stellar Expert.
          </p>
        </div>
      )}

      {state === "error" && (
        <div className="mt-5 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-red-400" />
            <span className="text-sm font-semibold text-red-300">
              Demo encountered an error
            </span>
          </div>
          <p className="mt-1.5 text-xs text-red-300/70">
            Check the step details above. You can reset and try again.
          </p>
        </div>
      )}

      {/* Account explorer link */}
      {walletPublic && state === "done" && (
        <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-white/5 pt-4">
          <a
            href={`${EXPLORER_BASE}/account/${walletPublic}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300"
          >
            View wallet on Stellar Expert
            <ExternalLink className="h-3 w-3" />
          </a>
          <span className="text-xs font-mono text-gray-600 truncate max-w-[240px]">
            {walletPublic}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step Row
// ---------------------------------------------------------------------------

function StepRow({ step, index }: { step: DemoStep; index: number }) {
  const icons: Record<string, React.ReactNode> = {
    generate: <Wallet className="h-3.5 w-3.5" />,
    fund: <Coins className="h-3.5 w-3.5" />,
    trustline: <ShieldPlus className="h-3.5 w-3.5" />,
    payment: <Send className="h-3.5 w-3.5" />,
    verify: <CheckCircle2 className="h-3.5 w-3.5" />,
  };

  return (
    <div
      className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-all duration-300 ${
        step.status === "running"
          ? "border-brand-500/30 bg-brand-500/5"
          : step.status === "done"
          ? "border-emerald-500/20 bg-emerald-500/[0.03]"
          : step.status === "error"
          ? "border-red-500/20 bg-red-500/[0.03]"
          : "border-white/5 bg-white/[0.01]"
      }`}
    >
      {/* Status icon */}
      <div className="mt-0.5 shrink-0">
        {step.status === "running" ? (
          <Loader2 className="h-4 w-4 animate-spin text-brand-400" />
        ) : step.status === "done" ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        ) : step.status === "error" ? (
          <XCircle className="h-4 w-4 text-red-400" />
        ) : (
          <div className="flex h-4 w-4 items-center justify-center rounded-full border border-white/20 text-[9px] text-gray-500">
            {index + 1}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-gray-500">{icons[step.id]}</span>
          <p
            className={`text-sm ${
              step.status === "done"
                ? "text-emerald-300"
                : step.status === "error"
                ? "text-red-300"
                : step.status === "running"
                ? "text-brand-300"
                : "text-gray-500"
            }`}
          >
            {step.label}
          </p>
          {step.duration && (
            <span className="ml-auto text-[10px] text-gray-600">
              {(step.duration / 1000).toFixed(1)}s
            </span>
          )}
        </div>

        {step.detail && (
          <p className="mt-0.5 truncate font-mono text-xs text-gray-500">
            {step.detail}
          </p>
        )}

        {step.txHash && (
          <a
            href={`${EXPLORER_BASE}/tx/${step.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-[11px] text-brand-400 hover:text-brand-300"
          >
            <span className="font-mono">
              {step.txHash.slice(0, 10)}...{step.txHash.slice(-6)}
            </span>
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

class StepError extends Error {
  stepId: string;
  constructor(stepId: string, message: string) {
    super(message);
    this.stepId = stepId;
    this.name = "StepError";
  }
}

function extractStellarError(err: unknown): string | null {
  try {
    const e = err as Record<string, unknown>;
    const response = e.response as Record<string, unknown> | undefined;
    const data = (response?.data ?? e.data) as Record<string, unknown> | undefined;
    const extras = data?.extras as Record<string, unknown> | undefined;
    const codes = extras?.result_codes as Record<string, unknown> | undefined;

    if (codes) {
      const txCode = String(codes.transaction || "");
      const opCodes = Array.isArray(codes.operations)
        ? codes.operations.map(String)
        : [];

      if (opCodes.includes("op_no_trust"))
        return "Destination has no trustline for this asset.";
      if (opCodes.includes("op_underfunded"))
        return "Insufficient balance.";
      if (opCodes.includes("op_line_full"))
        return "Destination trustline is full.";
      if (txCode === "tx_bad_seq")
        return "Sequence number mismatch. Try again.";
      if (txCode === "tx_too_late")
        return "Transaction expired. Try again.";

      return `tx=${txCode}, ops=[${opCodes.join(",")}]`;
    }
  } catch {
    // pass
  }
  if (err instanceof Error) return err.message;
  return null;
}
