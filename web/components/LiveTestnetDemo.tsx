"use client";

import { useState, useRef } from "react";
import {
  Wallet,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  Send,
  Coins,
  ShieldPlus,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WalletState = {
  publicKey: string;
  secret: string;
} | null;

type TxResult = {
  hash: string;
  ledger?: number;
} | null;

type AccountInfo = {
  funded: boolean;
  xlmBalance: string;
  usdcBalance: string | null;
  hasUsdcTrustline: boolean;
} | null;

type Status = {
  type: "idle" | "loading" | "success" | "error";
  message: string;
};

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

// We lazy-load the SDK to avoid SSR issues with Node.js polyfills
let _sdk: typeof import("@stellar/stellar-sdk") | null = null;

async function getSdk() {
  if (!_sdk) {
    _sdk = await import("@stellar/stellar-sdk");
  }
  return _sdk;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LiveTestnetDemo() {
  // Wallet state — lives only in React state, never persisted
  const [wallet, setWallet] = useState<WalletState>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [secretRevealed, setSecretRevealed] = useState(false);
  const [account, setAccount] = useState<AccountInfo>(null);

  // Friendbot
  const [fundStatus, setFundStatus] = useState<Status>({
    type: "idle",
    message: "",
  });
  const [fundTx, setFundTx] = useState<TxResult>(null);

  // Trustline
  const [trustlineStatus, setTrustlineStatus] = useState<Status>({
    type: "idle",
    message: "",
  });

  // Payment form
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("0.15");
  const [asset, setAsset] = useState<"XLM" | "USDC">("XLM");
  const [payStatus, setPayStatus] = useState<Status>({
    type: "idle",
    message: "",
  });
  const [payTx, setPayTx] = useState<TxResult>(null);

  // Ref to prevent double-clicks during async ops
  const busyRef = useRef(false);

  // ---- Helpers ----

  function maskKey(key: string): string {
    return key.slice(0, 4) + "..." + key.slice(-4);
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  }

  async function refreshAccount(pubKey: string) {
    try {
      const res = await fetch(`${HORIZON_URL}/accounts/${pubKey}`);
      if (!res.ok) {
        setAccount({ funded: false, xlmBalance: "0", usdcBalance: null, hasUsdcTrustline: false });
        return;
      }
      const data = await res.json();
      const balances: Array<{
        asset_type: string;
        asset_code?: string;
        asset_issuer?: string;
        balance: string;
      }> = data.balances || [];

      const xlm = balances.find((b) => b.asset_type === "native");
      const usdc = balances.find(
        (b) => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER
      );

      setAccount({
        funded: true,
        xlmBalance: xlm?.balance || "0",
        usdcBalance: usdc?.balance ?? null,
        hasUsdcTrustline: !!usdc,
      });
    } catch {
      setAccount(null);
    }
  }

  // ---- 1. Generate Wallet ----

  async function generateWallet() {
    if (busyRef.current) return;
    busyRef.current = true;

    try {
      const sdk = await getSdk();
      const keypair = sdk.Keypair.random();

      const newWallet: WalletState = {
        publicKey: keypair.publicKey(),
        secret: keypair.secret(),
      };

      // Reset all state for the new wallet
      setWallet(newWallet);
      setShowSecret(false);
      setSecretRevealed(false);
      setAccount(null);
      setFundStatus({ type: "idle", message: "" });
      setFundTx(null);
      setTrustlineStatus({ type: "idle", message: "" });
      setPayStatus({ type: "idle", message: "" });
      setPayTx(null);
    } catch (err) {
      console.error("Failed to generate keypair:", err);
    } finally {
      busyRef.current = false;
    }
  }

  // ---- 2. Fund with Friendbot ----

  async function fundWithFriendbot() {
    if (!wallet || busyRef.current) return;
    busyRef.current = true;
    setFundStatus({ type: "loading", message: "Requesting XLM from Friendbot..." });
    setFundTx(null);

    try {
      const res = await fetch(
        `${FRIENDBOT_URL}?addr=${encodeURIComponent(wallet.publicKey)}`
      );

      if (!res.ok) {
        const text = await res.text();
        // Friendbot returns 400 if already funded
        if (text.includes("createAccountAlreadyExist")) {
          setFundStatus({
            type: "success",
            message: "Account already funded on Testnet.",
          });
          await refreshAccount(wallet.publicKey);
          return;
        }
        throw new Error(`Friendbot returned ${res.status}: ${text.slice(0, 120)}`);
      }

      const data = await res.json();
      const hash = data.hash || data.id || "";

      setFundTx({ hash, ledger: data.ledger });
      setFundStatus({
        type: "success",
        message: "Account funded with 10,000 XLM (Testnet).",
      });

      await refreshAccount(wallet.publicKey);
    } catch (err) {
      setFundStatus({
        type: "error",
        message: err instanceof Error
          ? err.message
          : "Friendbot request failed. Try again.",
      });
    } finally {
      busyRef.current = false;
    }
  }

  // ---- 3. Add USDC Trustline ----

  async function addUsdcTrustline() {
    if (!wallet || busyRef.current) return;
    busyRef.current = true;
    setTrustlineStatus({ type: "loading", message: "Building changeTrust transaction..." });

    try {
      const sdk = await getSdk();
      const server = new sdk.Horizon.Server(HORIZON_URL);

      const sourceAccount = await server.loadAccount(wallet.publicKey);
      const usdcAsset = new sdk.Asset("USDC", USDC_ISSUER);

      const tx = new sdk.TransactionBuilder(sourceAccount, {
        fee: sdk.BASE_FEE,
        networkPassphrase: sdk.Networks.TESTNET,
      })
        .addOperation(sdk.Operation.changeTrust({ asset: usdcAsset }))
        .setTimeout(30)
        .build();

      const keypair = sdk.Keypair.fromSecret(wallet.secret);
      tx.sign(keypair);

      setTrustlineStatus({ type: "loading", message: "Submitting to Horizon..." });

      const result = await server.submitTransaction(tx);

      setTrustlineStatus({
        type: "success",
        message: `Trustline added. Tx: ${maskKey(result.hash)}`,
      });

      await refreshAccount(wallet.publicKey);
    } catch (err) {
      const message = extractStellarError(err) || "Failed to add trustline.";
      setTrustlineStatus({ type: "error", message });
    } finally {
      busyRef.current = false;
    }
  }

  // ---- 4. Send Payment ----

  async function sendPayment() {
    if (!wallet || busyRef.current) return;
    if (!destination || !amount) return;
    busyRef.current = true;
    setPayStatus({ type: "loading", message: "Building payment transaction..." });
    setPayTx(null);

    try {
      const sdk = await getSdk();
      const server = new sdk.Horizon.Server(HORIZON_URL);

      // Validate destination
      try {
        sdk.Keypair.fromPublicKey(destination);
      } catch {
        throw new UserError("Invalid destination address.");
      }

      // Validate amount
      const numAmount = parseFloat(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        throw new UserError("Amount must be a positive number.");
      }

      const sourceAccount = await server.loadAccount(wallet.publicKey);

      const paymentAsset =
        asset === "USDC"
          ? new sdk.Asset("USDC", USDC_ISSUER)
          : sdk.Asset.native();

      const tx = new sdk.TransactionBuilder(sourceAccount, {
        fee: sdk.BASE_FEE,
        networkPassphrase: sdk.Networks.TESTNET,
      })
        .addOperation(
          sdk.Operation.payment({
            destination,
            asset: paymentAsset,
            amount: numAmount.toFixed(7),
          })
        )
        .setTimeout(30)
        .build();

      const keypair = sdk.Keypair.fromSecret(wallet.secret);
      tx.sign(keypair);

      setPayStatus({ type: "loading", message: "Submitting to Horizon..." });

      const result = await server.submitTransaction(tx);

      setPayTx({ hash: result.hash, ledger: result.ledger });
      setPayStatus({
        type: "success",
        message: `Payment sent! Ledger #${result.ledger}`,
      });

      await refreshAccount(wallet.publicKey);
    } catch (err) {
      if (err instanceof UserError) {
        setPayStatus({ type: "error", message: err.message });
      } else {
        const stellarMsg = extractStellarError(err);
        setPayStatus({
          type: "error",
          message: stellarMsg || "Transaction failed.",
        });
      }
    } finally {
      busyRef.current = false;
    }
  }

  // ---- Render ----

  return (
    <div className="card-dark">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Wallet className="h-5 w-5 text-brand-400" />
        <h2 className="text-lg font-semibold text-white">
          Live Testnet Demo
        </h2>
      </div>
      <p className="mt-1 text-sm text-gray-400">
        Generate a real wallet, fund it, and send a payment on Stellar Testnet
        &mdash; all from your browser.
      </p>

      {/* Security warning */}
      <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
        <p className="text-xs leading-relaxed text-yellow-300/90">
          These keys are generated in your browser and exist only in memory.
          They are <span className="font-semibold">never sent to any server</span>.
          This is Testnet only &mdash; do not use real Mainnet keys here.
        </p>
      </div>

      {/* ── Step 1: Generate Wallet ── */}
      <div className="mt-6">
        <SectionLabel step={1} label="Generate Wallet" />

        <button
          onClick={generateWallet}
          className="btn-primary mt-3 text-sm"
        >
          <Wallet className="mr-2 h-4 w-4" />
          {wallet ? "Generate New Wallet" : "Generate Wallet"}
        </button>

        {wallet && (
          <div className="mt-4 space-y-3">
            {/* Public key */}
            <KeyDisplay
              label="Public Key"
              value={wallet.publicKey}
              mono
              onCopy={() => copyToClipboard(wallet.publicKey)}
            />

            {/* Secret key — show once with toggle */}
            <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">Secret Key</p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setShowSecret(!showSecret);
                      if (!secretRevealed) setSecretRevealed(true);
                    }}
                    className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-300"
                  >
                    {showSecret ? (
                      <EyeOff className="h-3 w-3" />
                    ) : (
                      <Eye className="h-3 w-3" />
                    )}
                    {showSecret ? "Hide" : "Reveal"}
                  </button>
                  <button
                    onClick={() => copyToClipboard(wallet.secret)}
                    className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-300"
                  >
                    <Copy className="h-3 w-3" />
                    Copy
                  </button>
                </div>
              </div>
              <p className="mt-1 break-all font-mono text-sm text-white">
                {showSecret ? wallet.secret : "S" + "*".repeat(51) + wallet.secret.slice(-4)}
              </p>
              {secretRevealed && (
                <p className="mt-2 text-[10px] text-yellow-400/70">
                  Secret revealed. Only visible during this session.
                </p>
              )}
            </div>

            {/* Account info */}
            {account && account.funded && (
              <div className="grid grid-cols-3 gap-2">
                <MiniStat label="XLM" value={formatBalance(account.xlmBalance)} />
                <MiniStat
                  label="USDC"
                  value={
                    account.hasUsdcTrustline
                      ? formatBalance(account.usdcBalance || "0")
                      : "No trustline"
                  }
                />
                <MiniStat
                  label="Status"
                  value={
                    <span className="flex items-center gap-1 text-emerald-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      Funded
                    </span>
                  }
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Step 2: Fund with Friendbot ── */}
      {wallet && (
        <div className="mt-8">
          <SectionLabel step={2} label="Fund with Friendbot" />

          <button
            onClick={fundWithFriendbot}
            disabled={fundStatus.type === "loading"}
            className="btn-glow mt-3 text-sm disabled:opacity-50"
          >
            {fundStatus.type === "loading" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Coins className="mr-2 h-4 w-4" />
            )}
            {fundStatus.type === "loading" ? "Funding..." : "Fund with Friendbot"}
          </button>

          <StatusMessage status={fundStatus} />

          {fundTx?.hash && (
            <TxLink hash={fundTx.hash} label="Funding transaction" />
          )}
        </div>
      )}

      {/* ── Step 2.5: Add USDC Trustline ── */}
      {wallet && account?.funded && !account.hasUsdcTrustline && (
        <div className="mt-8">
          <SectionLabel step={2.5} label="Add USDC Trustline (optional)" />
          <p className="mt-1 text-xs text-gray-500">
            Required before you can send or receive USDC. The changeTrust
            operation costs a small XLM reserve.
          </p>

          <button
            onClick={addUsdcTrustline}
            disabled={trustlineStatus.type === "loading"}
            className="btn-glow mt-3 text-sm disabled:opacity-50"
          >
            {trustlineStatus.type === "loading" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ShieldPlus className="mr-2 h-4 w-4" />
            )}
            {trustlineStatus.type === "loading"
              ? "Adding..."
              : "Add USDC Trustline"}
          </button>

          <StatusMessage status={trustlineStatus} />
        </div>
      )}

      {/* Trustline active badge */}
      {wallet && account?.hasUsdcTrustline && (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span className="text-xs text-emerald-300">
            USDC Trustline active &mdash; balance: {formatBalance(account.usdcBalance || "0")}
          </span>
        </div>
      )}

      {/* ── Step 3: Send Payment ── */}
      {wallet && account?.funded && (
        <div className="mt-8">
          <SectionLabel step={3} label="Send Test Payment" />

          <div className="mt-3 space-y-3">
            {/* Destination */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Destination
              </label>
              <input
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value.trim())}
                placeholder="G... (56 characters)"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 font-mono text-sm text-white placeholder-gray-600 outline-none transition-colors focus:border-brand-500/50"
                maxLength={56}
              />
            </div>

            {/* Amount + Asset row */}
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Amount
                </label>
                <input
                  type="text"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.15"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 font-mono text-sm text-white placeholder-gray-600 outline-none transition-colors focus:border-brand-500/50"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Asset
                </label>
                <select
                  value={asset}
                  onChange={(e) => setAsset(e.target.value as "XLM" | "USDC")}
                  className="h-[42px] rounded-lg border border-white/10 bg-white/5 px-4 text-sm text-white outline-none transition-colors focus:border-brand-500/50"
                >
                  <option value="XLM">XLM</option>
                  <option value="USDC" disabled={!account.hasUsdcTrustline}>
                    USDC {!account.hasUsdcTrustline ? "(need trustline)" : ""}
                  </option>
                </select>
              </div>
            </div>

            {/* USDC without trustline warning */}
            {asset === "USDC" && !account.hasUsdcTrustline && (
              <div className="flex items-center gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 text-yellow-400" />
                <span className="text-xs text-yellow-300">
                  You need a USDC trustline to send USDC. Add one above.
                </span>
              </div>
            )}

            {/* Send button */}
            <button
              onClick={sendPayment}
              disabled={
                payStatus.type === "loading" ||
                !destination ||
                !amount ||
                destination.length !== 56
              }
              className="btn-primary w-full text-sm disabled:opacity-50"
            >
              {payStatus.type === "loading" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              {payStatus.type === "loading"
                ? "Sending..."
                : `Send ${amount || "0"} ${asset}`}
            </button>
          </div>

          <StatusMessage status={payStatus} />

          {payTx?.hash && (
            <TxLink hash={payTx.hash} label="Payment transaction" />
          )}
        </div>
      )}

      {/* Explorer link for the wallet */}
      {wallet && (
        <div className="mt-8 border-t border-white/5 pt-4">
          <a
            href={`${EXPLORER_BASE}/account/${wallet.publicKey}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300"
          >
            View account on Stellar Expert
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionLabel({ step, label }: { step: number | string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-brand-500/30 bg-brand-500/10 text-[11px] font-bold text-brand-400">
        {step}
      </span>
      <h3 className="text-sm font-semibold text-white">{label}</h3>
    </div>
  );
}

function KeyDisplay({
  label,
  value,
  mono,
  onCopy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{label}</p>
        <button
          onClick={onCopy}
          className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-300"
        >
          <Copy className="h-3 w-3" />
          Copy
        </button>
      </div>
      <p
        className={`mt-1 break-all text-sm text-white ${mono ? "font-mono" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

function MiniStat({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2 text-center">
      <p className="text-[10px] text-gray-500">{label}</p>
      <p className="mt-0.5 text-xs font-semibold text-white">{value}</p>
    </div>
  );
}

function StatusMessage({ status }: { status: Status }) {
  if (status.type === "idle") return null;

  const styles = {
    loading: "border-brand-500/20 bg-brand-500/5 text-brand-300",
    success: "border-emerald-500/20 bg-emerald-500/5 text-emerald-300",
    error: "border-red-500/20 bg-red-500/5 text-red-300",
  };
  const icons = {
    loading: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
    success: <CheckCircle2 className="h-3.5 w-3.5" />,
    error: <XCircle className="h-3.5 w-3.5" />,
  };

  return (
    <div
      className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 ${
        styles[status.type as keyof typeof styles]
      }`}
    >
      <span className="mt-0.5 shrink-0">
        {icons[status.type as keyof typeof icons]}
      </span>
      <p className="text-xs leading-relaxed">{status.message}</p>
    </div>
  );
}

function TxLink({ hash, label }: { hash: string; label: string }) {
  return (
    <div className="mt-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
      <p className="text-[10px] text-gray-500">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="text-xs text-gray-300 font-mono truncate">
          {hash}
        </code>
        <a
          href={`${EXPLORER_BASE}/tx/${hash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-brand-400 hover:text-brand-300"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
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

      if (opCodes.includes("op_no_trust")) {
        return "Destination account does not have a trustline for this asset. Add a USDC trustline on the destination first.";
      }
      if (opCodes.includes("op_underfunded")) {
        return "Insufficient balance. Fund your wallet with more XLM or USDC.";
      }
      if (opCodes.includes("op_line_full")) {
        return "Destination trustline is at its limit. Cannot receive more of this asset.";
      }
      if (txCode === "tx_bad_seq") {
        return "Sequence number mismatch. Please try again.";
      }
      if (txCode === "tx_too_late") {
        return "Transaction expired. Please try again.";
      }

      return `Transaction failed: tx=${txCode}, ops=[${opCodes.join(",")}]`;
    }
  } catch {
    // Parsing failed
  }

  if (err instanceof Error) {
    return err.message;
  }
  return null;
}

function formatBalance(balance: string): string {
  const num = parseFloat(balance);
  if (isNaN(num)) return balance;
  if (num === 0) return "0";
  // Show up to 4 decimal places, trim trailing zeros
  return num.toFixed(4).replace(/\.?0+$/, "");
}
