/**
 * stellarTool.ts — Real Stellar transaction tool (Tranche 3)
 *
 * Replaces the mock tools from Tranche 2 with actual on-chain operations:
 *   - sign_stellar_transaction: build, sign, submit a payment with MemoHash
 *   - check_payment_status: verify via middleware /payment/verify
 *
 * Security:
 *  - memo_hash validated as 64-char hex BEFORE any processing
 *  - amount validated as positive number
 *  - Private key never leaves the wallet closure
 *  - Logs show only masked public keys and truncated tx hashes
 *  - Structured error objects returned to LLM (no raw stack traces)
 *  - Specific error handling: op_no_trust, insufficient_balance, tx_bad_seq
 */

import * as StellarSdk from "stellar-sdk";
import { log, mask } from "./logger.js";
import { secureFetch } from "./secure_fetch.js";
import {
  type StellarWallet,
  USDC_ASSET,
  HORIZON_URL,
  NETWORK_PASSPHRASE,
} from "./initWallet.js";

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------
const TX_TIMEOUT_SECONDS = 30;
const POLL_INTERVAL_MS = 2_000;
const POLL_MAX_WAIT_MS = 10_000;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const MEMO_HASH_REGEX = /^[a-f0-9]{64}$/;

export function validateMemoHash(value: unknown): string {
  if (typeof value !== "string") {
    throw new ToolError("VALIDATION", "memo_hash must be a string");
  }
  const trimmed = value.trim().toLowerCase();
  if (!MEMO_HASH_REGEX.test(trimmed)) {
    throw new ToolError(
      "VALIDATION",
      `Invalid memo_hash: must be exactly 64 hex characters, got ${trimmed.length}`
    );
  }
  return trimmed;
}

function validateAmount(value: unknown): string {
  const str = String(value).trim();
  const num = parseFloat(str);
  if (isNaN(num) || num <= 0) {
    throw new ToolError("VALIDATION", `amount must be a positive number, got '${str}'`);
  }
  // Stellar supports up to 7 decimal places
  return num.toFixed(7).replace(/\.?0+$/, "");
}

function validateStellarAddress(value: unknown): string {
  const addr = String(value).trim();
  if (!addr.startsWith("G") || addr.length !== 56) {
    throw new ToolError(
      "VALIDATION",
      `Invalid Stellar address: must be 56 chars starting with G`
    );
  }
  try {
    StellarSdk.Keypair.fromPublicKey(addr);
  } catch {
    throw new ToolError("VALIDATION", "Invalid Stellar address checksum");
  }
  return addr;
}

// ---------------------------------------------------------------------------
// Structured error class for LLM consumption
// ---------------------------------------------------------------------------
export class ToolError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.retryable = retryable;
  }

  toJSON() {
    return {
      error: true,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
  }
}

// ---------------------------------------------------------------------------
// Tool definitions (Anthropic tool_use schema) — Tranche 3
// ---------------------------------------------------------------------------
export const TOOL_DEFINITIONS_V3 = [
  {
    name: "sign_stellar_transaction",
    description:
      "Signs and submits a real Stellar payment transaction on Testnet. " +
      "Builds a transaction with MemoHash, signs with the agent's ephemeral keypair, " +
      "and submits to Horizon. Returns the confirmed transaction hash. " +
      "IMPORTANT: If this tool returns an error with retryable=false, " +
      "do NOT retry — report the failure to the user and stop.",
    input_schema: {
      type: "object" as const,
      properties: {
        destination: {
          type: "string",
          description: "Destination Stellar address (G...56 chars)",
        },
        amount: {
          type: "string",
          description: "Payment amount as a string (e.g. '0.5'). Must be positive.",
        },
        memo_hash: {
          type: "string",
          description: "64-character lowercase hex memo hash from the 402 response",
        },
        asset: {
          type: "string",
          enum: ["XLM", "USDC"],
          description: "Asset to send: 'XLM' for native lumens, 'USDC' for testnet USDC",
        },
      },
      required: ["destination", "amount", "memo_hash"],
    },
  },
  {
    name: "check_payment_status",
    description:
      "Verifies a previously submitted payment by its memo_hash against the " +
      "cortex402 middleware's /payment/verify endpoint. Returns verification status.",
    input_schema: {
      type: "object" as const,
      properties: {
        memo_hash: {
          type: "string",
          description: "The 64-character hex memo hash to verify",
        },
      },
      required: ["memo_hash"],
    },
  },
] as const;

// ---------------------------------------------------------------------------
// sign_stellar_transaction — REAL implementation
// ---------------------------------------------------------------------------
export async function signStellarTransaction(
  wallet: StellarWallet,
  params: {
    destination: string;
    amount: string;
    memo_hash: string;
    asset?: string;
  }
): Promise<{
  success: boolean;
  tx_hash: string;
  ledger: number;
  memo_hash_masked: string;
}> {
  // ---- Validate all inputs BEFORE touching the network ----
  const memoHex = validateMemoHash(params.memo_hash);
  const amount = validateAmount(params.amount);
  const destination = validateStellarAddress(params.destination);
  const assetCode = (params.asset || "XLM").toUpperCase();

  log.info("stellar_tx_start", {
    destination_hash: destination,
    amount,
    asset: assetCode,
    memo_hash: memoHex,
    wallet: wallet.toString(),
  });

  // ---- Resolve asset ----
  const asset =
    assetCode === "USDC" ? USDC_ASSET : StellarSdk.Asset.native();

  // ---- Build MemoHash from hex ----
  const memoBuffer = Buffer.from(memoHex, "hex");
  const memo = StellarSdk.Memo.hash(memoBuffer);

  // ---- Load account & build transaction ----
  const server = new StellarSdk.Horizon.Server(HORIZON_URL);
  let account: StellarSdk.AccountResponse;

  try {
    account = await server.loadAccount(wallet.publicKey);
  } catch (err) {
    throw new ToolError(
      "ACCOUNT_NOT_FOUND",
      `Agent account ${mask(wallet.publicKey)} not found on network`,
      false
    );
  }

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination,
        asset,
        amount,
      })
    )
    .addMemo(memo)
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build();

  // ---- Sign (private key stays in closure) ----
  wallet.signTransaction(tx);

  // ---- Submit ----
  log.info("stellar_tx_submitting", { tx_hash: tx.hash().toString("hex") });

  let result: StellarSdk.Horizon.HorizonApi.SubmitTransactionResponse;
  try {
    result = await server.submitTransaction(tx);
  } catch (err) {
    handleSubmitError(err);
    // handleSubmitError always throws — this is just for TypeScript
    throw err;
  }

  const txHash = result.hash;
  const ledger = result.ledger;

  log.info("stellar_tx_submitted", { tx_hash: txHash, ledger });

  // ---- Poll for confirmation (max 10s) ----
  await pollConfirmation(server, txHash);

  log.info("stellar_tx_confirmed", {
    tx_hash: txHash,
    ledger,
    memo_hash: memoHex,
  });

  return {
    success: true,
    tx_hash: txHash,
    ledger,
    memo_hash_masked: mask(memoHex),
  };
}

// ---------------------------------------------------------------------------
// check_payment_status — REAL implementation via middleware
// ---------------------------------------------------------------------------
export async function checkPaymentStatus(
  middlewareUrl: string,
  params: { memo_hash: string }
): Promise<{ verified: boolean; message: string; data?: unknown }> {
  const memoHex = validateMemoHash(params.memo_hash);

  log.info("payment_verify_start", { memo_hash: memoHex });

  const resp = await secureFetch<{
    verified?: boolean;
    message?: string;
    error?: string;
  }>(`${middlewareUrl}/payment/verify`, {
    method: "POST",
    body: { memo_hash: memoHex },
  });

  if (resp.status >= 400) {
    const errMsg = resp.data?.error || `HTTP ${resp.status}`;
    log.warn("payment_verify_failed", { memo_hash: memoHex, error: errMsg });
    return {
      verified: false,
      message: errMsg,
    };
  }

  const verified = resp.data?.verified ?? false;
  log.info("payment_verify_result", {
    memo_hash: memoHex,
    verified: String(verified),
  });

  return {
    verified,
    message: resp.data?.message || (verified ? "Payment verified" : "Payment not found yet"),
    data: resp.data,
  };
}

// ---------------------------------------------------------------------------
// Submit error handler — maps Stellar error codes to ToolError
// ---------------------------------------------------------------------------
function handleSubmitError(err: unknown): never {
  const resultCodes = extractResultCodes(err);
  const opCodes: string[] = resultCodes?.operations || [];
  const txCode: string = resultCodes?.transaction || "unknown";

  log.error("stellar_tx_failed", {
    tx_code: txCode,
    op_codes: opCodes.join(","),
  });

  // Map known error codes to structured errors
  if (opCodes.includes("op_no_trust")) {
    throw new ToolError(
      "OP_NO_TRUST",
      "Destination account does not have a trustline for this asset. " +
        "The destination must add a trustline before receiving non-native assets.",
      false
    );
  }

  if (opCodes.includes("op_underfunded")) {
    throw new ToolError(
      "INSUFFICIENT_BALANCE",
      "Agent wallet has insufficient balance for this payment. " +
        "Cannot complete the transaction. Do NOT retry.",
      false
    );
  }

  if (txCode === "tx_bad_seq") {
    throw new ToolError(
      "TX_BAD_SEQ",
      "Transaction sequence number mismatch. This can happen if multiple " +
        "transactions were submitted concurrently. A single retry may resolve this.",
      true
    );
  }

  if (txCode === "tx_too_late") {
    throw new ToolError(
      "TX_EXPIRED",
      "Transaction expired before submission. May retry once.",
      true
    );
  }

  if (opCodes.includes("op_line_full")) {
    throw new ToolError(
      "OP_LINE_FULL",
      "Destination trustline is at its limit. Cannot receive more of this asset.",
      false
    );
  }

  // Generic fallback
  throw new ToolError(
    "TX_FAILED",
    `Transaction failed: tx=${txCode}, ops=[${opCodes.join(",")}]`,
    false
  );
}

function extractResultCodes(
  err: unknown
): { transaction: string; operations: string[] } | null {
  try {
    const e = err as Record<string, unknown>;
    const resp = e.response as Record<string, unknown> | undefined;
    const data = (resp?.data ?? e.data) as Record<string, unknown> | undefined;
    const extras = data?.extras as Record<string, unknown> | undefined;
    const codes = extras?.result_codes as Record<string, unknown> | undefined;

    if (codes) {
      return {
        transaction: String(codes.transaction || "unknown"),
        operations: Array.isArray(codes.operations)
          ? codes.operations.map(String)
          : [],
      };
    }
  } catch {
    // parsing failed
  }
  return null;
}

// ---------------------------------------------------------------------------
// Polling helper
// ---------------------------------------------------------------------------
async function pollConfirmation(
  server: StellarSdk.Horizon.Server,
  txHash: string
): Promise<void> {
  const deadline = Date.now() + POLL_MAX_WAIT_MS;

  while (Date.now() < deadline) {
    try {
      const tx = await server.transactions().transaction(txHash).call();
      if (tx.successful) return;
      if (tx.successful === false) {
        throw new ToolError("TX_FAILED_ON_CHAIN", "Transaction included but failed", false);
      }
    } catch (err) {
      if (err instanceof ToolError) throw err;
      // Not found yet — keep polling
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  log.warn("tx_confirmation_timeout", { tx_hash: txHash });
  // Don't throw — the tx was accepted by Horizon, just not confirmed in 10s
}

// ---------------------------------------------------------------------------
// Tool executor — routes LLM tool calls to real implementations
// ---------------------------------------------------------------------------
export async function executeToolV3(
  toolName: string,
  toolInput: Record<string, unknown>,
  wallet: StellarWallet,
  middlewareUrl: string
): Promise<unknown> {
  try {
    switch (toolName) {
      case "sign_stellar_transaction":
        return await signStellarTransaction(wallet, {
          destination: String(toolInput.destination),
          amount: String(toolInput.amount),
          memo_hash: String(toolInput.memo_hash),
          asset: toolInput.asset ? String(toolInput.asset) : undefined,
        });

      case "check_payment_status":
        return await checkPaymentStatus(middlewareUrl, {
          memo_hash: String(toolInput.memo_hash),
        });

      default:
        throw new ToolError("UNKNOWN_TOOL", `Unknown tool: ${toolName}`, false);
    }
  } catch (err) {
    // If it's already a ToolError, return its structured JSON
    if (err instanceof ToolError) {
      log.error("tool_error_structured", {
        tool: toolName,
        code: err.code,
        msg: err.message,
        retryable: String(err.retryable),
      });
      return err.toJSON();
    }
    // Wrap unexpected errors
    log.error("tool_error_unexpected", {
      tool: toolName,
      msg: err instanceof Error ? err.message : String(err),
    });
    return {
      error: true,
      code: "INTERNAL_ERROR",
      message: err instanceof Error ? err.message : String(err),
      retryable: false,
    };
  }
}
