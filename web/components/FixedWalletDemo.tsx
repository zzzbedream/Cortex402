"use client";

import { useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  Play,
  XCircle,
} from "lucide-react";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "").trim();
const HORIZON_URL =
  (process.env.NEXT_PUBLIC_HORIZON_URL ||
    "https://horizon-testnet.stellar.org").trim();
const DEMO_AMOUNT = "0.1500000";
const FIXED_SECRET_KEY =
  (process.env.NEXT_PUBLIC_DEMO_SECRET_KEY || "").trim();
const MERCHANT_PUBLIC_KEY =
  (process.env.NEXT_PUBLIC_MERCHANT_WALLET || "").trim();

const EXPLORER_BASE = "https://stellar.expert/explorer/testnet/tx";
const FRIENDBOT_URL = "https://friendbot.stellar.org";

let _sdk: typeof import("@stellar/stellar-sdk") | null = null;

async function getSdk() {
  if (!_sdk) {
    _sdk = await import("@stellar/stellar-sdk");
  }
  return _sdk;
}

type DemoStatus = "idle" | "running" | "success" | "error";

type IntentResponse = {
  memo_hash?: string;
  destination?: string;
  amount?: string;
  asset?: string;
  expires_in_seconds?: number;
};

type VerifyResponse = {
  verified?: boolean;
  message?: string;
  error?: string;
};

function maskKey(value: string): string {
  if (!value) return "[missing]";
  if (value.length <= 10) return "****";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export default function FixedWalletDemo() {
  const [status, setStatus] = useState<DemoStatus>("idle");
  const [txHash, setTxHash] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [memoHash, setMemoHash] = useState("");
  const [verifyMessage, setVerifyMessage] = useState("");

  const sourceWalletMasked = FIXED_SECRET_KEY ? "configured" : "[not configured]";

  const runDemo = async () => {
    setStatus("running");
    setTxHash("");
    setErrorMsg("");
    setMemoHash("");
    setVerifyMessage("");

    try {
      if (!API_URL) {
        throw new Error("Set NEXT_PUBLIC_API_URL to enable live demo.");
      }
      if (!FIXED_SECRET_KEY) {
        throw new Error("Set NEXT_PUBLIC_DEMO_SECRET_KEY in web/.env.local.");
      }

      const sdk = await getSdk();
      const sourceKeypair = sdk.Keypair.fromSecret(FIXED_SECRET_KEY);
      const sourcePublicKey = sourceKeypair.publicKey();
      const server = new sdk.Horizon.Server(HORIZON_URL);

      // Avoid self-payment: if merchant equals source wallet, use an ephemeral
      // destination account funded via Friendbot for a deterministic verify flow.
      let requestedDestination = MERCHANT_PUBLIC_KEY;
      if (!requestedDestination || requestedDestination === sourcePublicKey) {
        const ephemeralDestination = sdk.Keypair.random().publicKey();
        const friendbotRes = await fetch(
          `${FRIENDBOT_URL}?addr=${encodeURIComponent(ephemeralDestination)}`
        );
        if (!friendbotRes.ok) {
          const friendbotText = await friendbotRes.text();
          if (!friendbotText.includes("createAccountAlreadyExist")) {
            throw new Error(
              `Friendbot failed for destination wallet (${friendbotRes.status}).`
            );
          }
        }
        requestedDestination = ephemeralDestination;
      }

      // 1) Challenge / Intent from middleware
      const intentRes = await fetch(`/api/demo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "intent",
          amount: DEMO_AMOUNT,
          asset: "XLM",
          destination: requestedDestination,
        }),
      });

      const intentJson = (await intentRes.json()) as IntentResponse;
      if (!intentRes.ok) {
        throw new Error(
          `Intent failed (${intentRes.status}): ${
            (intentJson as { error?: string }).error || "unknown"
          }`
        );
      }

      const intentMemoHash = String(intentJson.memo_hash || "").toLowerCase();
      const intentAmount = String(intentJson.amount || DEMO_AMOUNT);
      const intentDestination = String(
        intentJson.destination || MERCHANT_PUBLIC_KEY || ""
      );

      if (!/^[a-f0-9]{64}$/.test(intentMemoHash)) {
        throw new Error("Invalid memo_hash received from middleware.");
      }
      if (!intentDestination) {
        throw new Error("Intent response missing destination.");
      }
      try {
        sdk.Keypair.fromPublicKey(intentDestination);
      } catch {
        throw new Error("Invalid destination received from middleware.");
      }

      setMemoHash(intentMemoHash);

      // 2) Build and submit real Stellar payment
      const account = await server.loadAccount(sourcePublicKey);

      const tx = new sdk.TransactionBuilder(account, {
        fee: sdk.BASE_FEE,
        networkPassphrase: sdk.Networks.TESTNET,
      })
        .addOperation(
          sdk.Operation.payment({
            destination: intentDestination,
            asset: sdk.Asset.native(),
            amount: intentAmount,
          })
        )
        .addMemo(sdk.Memo.hash(intentMemoHash))
        .setTimeout(30)
        .build();

      tx.sign(sourceKeypair);
      const submit = await server.submitTransaction(tx);
      const hash = submit.hash;
      setTxHash(hash);

      // 3) Verify in middleware with memo_hash (polling max 10s)
      let verified = false;
      let verifyPayload: VerifyResponse = {};
      const verifyStarted = Date.now();

      while (Date.now() - verifyStarted < 20000) {
        const verifyRes = await fetch(`/api/demo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "verify",
            memo_hash: intentMemoHash,
          }),
        });

        verifyPayload = (await verifyRes.json()) as VerifyResponse;
        if (verifyRes.ok && verifyPayload.verified === true) {
          verified = true;
          break;
        }
        await wait(1500);
      }

      if (!verified) {
        throw new Error(
          verifyPayload.message ||
            verifyPayload.error ||
            "Payment submitted, but middleware verification did not return success in time."
        );
      }

      setVerifyMessage("Payment validated by middleware (HTTP 200).");
      setStatus("success");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unexpected error in live demo.";
      setErrorMsg(message);
      setStatus("error");
    }
  };

  return (
    <section id="try-it-live" className="relative py-24 sm:py-32">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-brand-900/5 to-transparent" />

      <div className="relative mx-auto max-w-5xl px-6">
        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-brand-400">
            Live Testnet
          </p>
          <h2 className="section-heading mt-2">Try It Live</h2>
          <p className="section-subheading mx-auto">
            Fixed Wallet demo with real Stellar Testnet payment and middleware
            verification.
          </p>
        </div>

        <div className="card-dark mx-auto mt-12 max-w-3xl">
          <h3 className="text-xl font-semibold text-white">
            Live Demo - Fixed Wallet (Testnet)
          </h3>
          <p className="mt-2 text-sm text-gray-400">
            This demo uses a pre-funded Testnet wallet. Click Run Demo to execute
            intent -&gt; payment -&gt; verify.
          </p>

          <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs text-gray-400">
            <p>
              Source wallet: <span className="font-mono">{sourceWalletMasked}</span>
            </p>
            <p>
              Merchant wallet: <span className="font-mono">{maskKey(MERCHANT_PUBLIC_KEY)}</span>
            </p>
          </div>

          <button
            onClick={runDemo}
            disabled={status === "running"}
            className="btn-primary mt-6 disabled:opacity-50"
          >
            {status === "running" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            {status === "running" ? "Sending payment..." : "Run Demo"}
          </button>

          {!API_URL && (
            <p className="mt-3 text-xs text-yellow-400/80">
              Set NEXT_PUBLIC_API_URL to enable live demo.
            </p>
          )}

          {status === "success" && txHash && (
            <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-300">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5" />
                <p>Payment sent and verified successfully.</p>
              </div>
              {memoHash && (
                <p className="mt-2 font-mono text-xs text-emerald-200/90">
                  memo_hash: {memoHash.slice(0, 10)}...{memoHash.slice(-8)}
                </p>
              )}
              {verifyMessage && (
                <p className="mt-1 text-xs text-emerald-200/80">{verifyMessage}</p>
              )}
              <a
                href={`${EXPLORER_BASE}/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-sm underline hover:text-white"
              >
                View on Stellar Expert
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}

          {status === "error" && (
            <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-300">
              <div className="flex items-center gap-2">
                <XCircle className="h-5 w-5" />
                <p>Error: {errorMsg}</p>
              </div>
              <p className="mt-2 text-xs text-red-200/80">
                Ensure NEXT_PUBLIC_API_URL, NEXT_PUBLIC_DEMO_SECRET_KEY and wallet
                funding are correct.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
