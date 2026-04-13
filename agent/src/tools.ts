/**
 * Agent tools — callable functions exposed to the LLM via tool_use.
 *
 * Tranche 2: mock payment signing with secure logging.
 * Tranche 3: real Stellar transaction submission.
 *
 * Security:
 *  - memo_hash validated (hex, 64 chars) BEFORE any processing
 *  - Logs show only first4...last4 of hashes
 *  - Simulated signing has a 3s delay (mimics real latency)
 *  - No disk writes — results stay in memory
 */

import { log, mask } from "./logger.js";
import type { EphemeralWallet } from "./wallet.js";
import type { PaymentPayload } from "./secure_fetch.js";

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------
const MEMO_HASH_REGEX = /^[a-f0-9]{64}$/;

export function validateMemoHash(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("memo_hash must be a string");
  }
  const trimmed = value.trim().toLowerCase();
  if (!MEMO_HASH_REGEX.test(trimmed)) {
    throw new Error(
      `Invalid memo_hash: must be exactly 64 hex characters, got ${trimmed.length} chars`
    );
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Tool definitions (Anthropic tool_use schema)
// ---------------------------------------------------------------------------
export const TOOL_DEFINITIONS = [
  {
    name: "sign_and_submit_payment",
    description:
      "Signs a Stellar payment transaction using the agent's ephemeral wallet " +
      "and submits it to the network. Requires a valid payment payload with " +
      "memo_hash (64-char hex), amount, asset, and destination.",
    input_schema: {
      type: "object" as const,
      properties: {
        memo_hash: {
          type: "string",
          description: "The 64-character hex memo hash from the 402 response",
        },
        amount: {
          type: "string",
          description: "Payment amount as a string (e.g. '10')",
        },
        asset: {
          type: "string",
          description: "Asset code (e.g. 'XLM')",
        },
        destination: {
          type: "string",
          description: "Destination Stellar address",
        },
      },
      required: ["memo_hash", "amount", "asset", "destination"],
    },
  },
  {
    name: "check_payment_status",
    description:
      "Verifies a previously submitted payment by its memo_hash against the " +
      "cortex402 middleware. Returns whether the payment was confirmed.",
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
// Tool implementations
// ---------------------------------------------------------------------------

/**
 * MOCK sign_and_submit_payment (Tranche 2)
 * Simulates a 3-second signing delay, logs partial hashes only.
 */
export async function mockSignAndSubmitPayment(
  wallet: EphemeralWallet,
  params: { memo_hash: string; amount: string; asset: string; destination: string }
): Promise<{ success: boolean; tx_hash: string; memo_hash_masked: string }> {
  // Validate memo_hash strictly BEFORE any processing
  const validMemo = validateMemoHash(params.memo_hash);

  log.info("payment_signing_start", {
    memo_hash: validMemo,
    amount: params.amount,
    asset: params.asset,
    destination_hash: params.destination,
    wallet: wallet.toString(),
  });

  // Simulate signing delay (3 seconds)
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Mock signature — in Tranche 3 this becomes a real Stellar tx
  const mockPayload = `${validMemo}:${params.amount}:${params.asset}:${params.destination}`;
  const signature = wallet.sign(mockPayload);

  // Generate a mock transaction hash
  const { createHash } = await import("node:crypto");
  const txHash = createHash("sha256").update(signature).digest("hex");

  log.info("payment_signed_mock", {
    tx_hash: txHash,
    memo_hash: validMemo,
    signature_hash: signature,
  });

  return {
    success: true,
    tx_hash: txHash,
    memo_hash_masked: mask(validMemo),
  };
}

/**
 * MOCK check_payment_status (Tranche 2)
 * In Tranche 3 this calls the middleware's /payment/verify endpoint.
 */
export async function mockCheckPaymentStatus(
  middlewareUrl: string,
  params: { memo_hash: string }
): Promise<{ verified: boolean; message: string }> {
  const validMemo = validateMemoHash(params.memo_hash);

  log.info("payment_verify_start", { memo_hash: validMemo });

  // Mock: simulate network call
  await new Promise((resolve) => setTimeout(resolve, 500));

  log.info("payment_verify_mock", {
    memo_hash: validMemo,
    result: "mock_verified",
  });

  return {
    verified: true,
    message: `[MOCK] Payment ${mask(validMemo)} verified successfully`,
  };
}

/**
 * Route a tool call from the LLM to the correct handler.
 */
export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  wallet: EphemeralWallet,
  middlewareUrl: string
): Promise<unknown> {
  switch (toolName) {
    case "sign_and_submit_payment":
      return mockSignAndSubmitPayment(wallet, {
        memo_hash: String(toolInput.memo_hash),
        amount: String(toolInput.amount),
        asset: String(toolInput.asset || "XLM"),
        destination: String(toolInput.destination),
      });

    case "check_payment_status":
      return mockCheckPaymentStatus(middlewareUrl, {
        memo_hash: String(toolInput.memo_hash),
      });

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
