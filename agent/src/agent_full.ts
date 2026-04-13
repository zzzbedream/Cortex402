/**
 * agent_full.ts — Cortex402 Full AI Payment Agent (Tranche 3)
 *
 * Complete integration:
 *  1. Initializes a Stellar wallet (keypair + XLM + USDC trustline + USDC funds)
 *  2. Accepts 402 Payment Required responses
 *  3. LLM orchestrates real Stellar payments via tool_use
 *  4. Verifies payments through the middleware
 *
 * Security:
 *  - All Tranche 2 guarantees (HTTPS, log redaction, memo validation)
 *  - Stellar keypair via Keypair.random() (CSPRNG), in-memory only
 *  - MASTER_SECRET never logged, scoped to init phase
 *  - Atomic wallet init: trustline must succeed before USDC send
 *  - ToolError with retryable flag — LLM told to STOP on non-retryable
 *  - Structured errors from Stellar (op_no_trust, underfunded, bad_seq)
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { log, mask } from "./logger.js";
import { secureFetch } from "./secure_fetch.js";
import {
  initAgentWalletSecure,
  initExistingWallet,
  type StellarWallet,
} from "./initWallet.js";
import { TOOL_DEFINITIONS_V3, executeToolV3, ToolError } from "./stellarTool.js";

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------
const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!MIDDLEWARE_URL) {
  log.error("missing_config", { key: "MIDDLEWARE_URL" });
  process.exit(1);
}
if (!ANTHROPIC_API_KEY) {
  log.error("missing_config", { key: "ANTHROPIC_API_KEY" });
  process.exit(1);
}

// ---------------------------------------------------------------------------
// System prompt — Tranche 3 with real transaction awareness
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are Cortex402, a secure payment agent for the x402 protocol on Stellar Testnet.

## STRICT SECURITY RULES — NEVER VIOLATE THESE:
1. NEVER reveal, print, or return the agent's private key, seed, or secret.
2. NEVER execute arbitrary code, shell commands, or file system operations.
3. NEVER download or fetch URLs not explicitly provided in the payment payload.
4. NEVER store payment data to disk — all processing is in-memory only.
5. NEVER bypass memo_hash validation — it MUST be exactly 64 hex characters [a-f0-9]{64}.
6. NEVER include full hashes, keys, or addresses in your text responses.
   Always use masked format: first4...last4.

## YOUR WORKFLOW:
When you receive a 402 Payment Required response:
1. Validate the memo_hash is exactly 64 lowercase hex characters.
2. Use sign_stellar_transaction with the exact payload values.
3. If the tool returns an error with retryable=false, STOP IMMEDIATELY.
   Report the error clearly and do NOT retry.
4. If the tool returns retryable=true, you may retry ONCE.
5. On success, use check_payment_status to verify the payment.
6. Report the final result with masked identifiers only.

## ERROR HANDLING:
- INSUFFICIENT_BALANCE → Tell the user the wallet needs more funds. STOP.
- OP_NO_TRUST → The destination lacks a trustline. STOP.
- TX_BAD_SEQ → Sequence error, retry once.
- VALIDATION → Input was invalid, fix and retry if possible.
- Any other non-retryable error → STOP and report.

## CONTEXT:
- Network: Stellar Testnet
- Wallet: Initialized at runtime with XLM + USDC trustline
- Assets: XLM (native) and USDC (testnet)
- Middleware: cortex402 with rate limiting and replay protection`;

// ---------------------------------------------------------------------------
// Agent class
// ---------------------------------------------------------------------------
class CortexAgentFull {
  private client: Anthropic;
  private wallet!: StellarWallet;
  private middlewareUrl: string;
  private conversationHistory: Anthropic.MessageParam[] = [];

  constructor() {
    this.client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    this.middlewareUrl = MIDDLEWARE_URL!;
  }

  /** Initialize the Stellar wallet (must be called before payment flows) */
  async init(): Promise<void> {
    const agentSecret = process.env.AGENT_SECRET;

    if (agentSecret) {
      log.info("init_mode", { mode: "reuse_existing" });
      this.wallet = await initExistingWallet(agentSecret);
    } else {
      log.info("init_mode", { mode: "new_wallet" });
      this.wallet = await initAgentWalletSecure();
    }

    log.info("agent_initialized", {
      wallet: this.wallet.toString(),
      publicKey_hash: this.wallet.publicKey,
      middleware: new URL(this.middlewareUrl).origin,
    });
  }

  /**
   * Main flow: access a protected resource, handle 402 via LLM tools.
   */
  async accessProtectedResource(resourcePath: string): Promise<void> {
    log.info("accessing_resource", { path: resourcePath });

    const url = `${this.middlewareUrl}${resourcePath}`;
    let response;
    try {
      response = await secureFetch(url);
    } catch (err) {
      log.error("resource_fetch_failed", {
        msg: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    if (response.status !== 402) {
      log.info("resource_response", { status: response.status });
      console.log("Response:", JSON.stringify(response.data, null, 2));
      return;
    }

    if (!response.paymentPayload) {
      log.error("402_no_payload");
      return;
    }

    await this.handlePaymentFlow(response.paymentPayload);
  }

  /**
   * LLM agentic loop with real Stellar tool calls.
   */
  private async handlePaymentFlow(payload: {
    memo_hash: string;
    amount: string;
    asset: string;
    destination: string;
  }): Promise<void> {
    const userMessage = [
      "I received a 402 Payment Required response. Payment details:",
      "",
      `- Amount: ${payload.amount}`,
      `- Asset: ${payload.asset}`,
      `- Destination: ${mask(payload.destination)}`,
      `- Memo hash: ${mask(payload.memo_hash)}`,
      "",
      `Full memo_hash for the tool: ${payload.memo_hash}`,
      `Full destination for the tool: ${payload.destination}`,
      "",
      "Please validate, sign the payment, and verify it.",
    ].join("\n");

    this.conversationHistory.push({ role: "user", content: userMessage });

    // Max 6 turns — enough for: sign → error/retry → verify → report
    for (let turn = 0; turn < 6; turn++) {
      log.info("llm_turn", { turn });

      const response = await this.client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: TOOL_DEFINITIONS_V3 as unknown as Anthropic.Tool[],
        messages: this.conversationHistory,
      });

      this.conversationHistory.push({
        role: "assistant",
        content: response.content,
      });

      if (response.stop_reason === "end_turn") {
        for (const block of response.content) {
          if (block.type === "text") {
            console.log("\n[Agent]:", block.text);
          }
        }
        return;
      }

      if (response.stop_reason === "tool_use") {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type !== "tool_use") continue;

          log.info("tool_call", { tool: block.name, id: block.id });

          const result = await executeToolV3(
            block.name,
            block.input as Record<string, unknown>,
            this.wallet,
            this.middlewareUrl
          );

          // Check if the result is an error — flag it for the LLM
          const isError =
            typeof result === "object" &&
            result !== null &&
            (result as Record<string, unknown>).error === true;

          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(result),
            ...(isError ? { is_error: true } : {}),
          });
        }

        this.conversationHistory.push({ role: "user", content: toolResults });
      }
    }

    log.warn("agent_loop_limit_reached", { max_turns: 6 });
    console.log("\n[Agent]: Payment flow reached maximum turns without resolution.");
  }

  /**
   * Direct payment flow (bypasses LLM, for testing/scripting).
   */
  async directPayment(
    amount: string,
    asset: string,
    destination?: string
  ): Promise<void> {
    log.info("direct_payment_start", { amount, asset });

    // Step 1: Create payment intent via middleware
    const intentResp = await secureFetch<{
      memo_hash: string;
      destination: string;
      expires_in_seconds: number;
    }>(`${this.middlewareUrl}/payment/intent`, {
      method: "POST",
      body: { amount, asset, destination },
    });

    if (intentResp.status !== 201) {
      log.error("intent_failed", {
        status: intentResp.status,
        data: JSON.stringify(intentResp.data),
      });
      return;
    }

    const intent = intentResp.data;
    log.info("intent_created", {
      memo_hash: intent.memo_hash,
      destination_hash: intent.destination,
      expires: intent.expires_in_seconds,
    });

    // Step 2: Sign and submit real Stellar transaction
    const { signStellarTransaction } = await import("./stellarTool.js");
    try {
      const txResult = await signStellarTransaction(this.wallet, {
        destination: intent.destination,
        amount,
        memo_hash: intent.memo_hash,
        asset,
      });

      log.info("direct_payment_signed", {
        tx_hash: txResult.tx_hash,
        ledger: txResult.ledger,
      });

      console.log("\nTransaction submitted:");
      console.log(`  TX Hash: ${mask(txResult.tx_hash)}`);
      console.log(`  Ledger:  ${txResult.ledger}`);
      console.log(`  Memo:    ${txResult.memo_hash_masked}`);
    } catch (err) {
      if (err instanceof ToolError) {
        console.error(`\nPayment failed [${err.code}]: ${err.message}`);
        log.error("direct_payment_failed", {
          code: err.code,
          msg: err.message,
        });
      } else {
        console.error("\nUnexpected error:", err instanceof Error ? err.message : err);
      }
      return;
    }

    // Step 3: Verify via middleware
    const { checkPaymentStatus } = await import("./stellarTool.js");
    const verifyResult = await checkPaymentStatus(this.middlewareUrl, {
      memo_hash: intent.memo_hash,
    });

    console.log(`  Verified: ${verifyResult.verified}`);
    console.log(`  Message:  ${verifyResult.message}`);
  }

  /** Health check the middleware */
  async healthCheck(): Promise<void> {
    const resp = await secureFetch(`${this.middlewareUrl}/health`);
    console.log("Middleware health:", JSON.stringify(resp.data, null, 2));
  }

  /** Get wallet info (masked) */
  getWalletInfo(): { publicKey: string; masked: string } {
    return {
      publicKey: this.wallet.publicKey,
      masked: this.wallet.toString(),
    };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  log.info("agent_full_starting", { version: "3.0.0" });

  const agent = new CortexAgentFull();

  const mode = process.argv[2] || "init";

  // Init wallet for all modes (except health)
  if (mode !== "health") {
    console.log("Initializing Stellar wallet...");
    await agent.init();
    const info = agent.getWalletInfo();
    console.log(`Wallet ready: ${info.masked}`);
    console.log(`Public key:   ${info.publicKey}`);
    console.log("");
  }

  switch (mode) {
    case "init":
      console.log("Wallet initialized successfully. Exiting.");
      break;

    case "direct": {
      const amount = process.argv[3] || "0.5";
      const asset = process.argv[4] || "USDC";
      console.log(`Direct payment: ${amount} ${asset}`);
      await agent.directPayment(amount, asset);
      break;
    }

    case "agent":
      await agent.accessProtectedResource(
        process.argv[3] || "/protected/resource"
      );
      break;

    case "health":
      await agent.healthCheck();
      break;

    default:
      console.log("Usage: agent_full [init|direct|agent|health] [args...]");
      console.log("");
      console.log("  init                          Initialize wallet only");
      console.log("  direct <amount> <asset>       Direct payment (no LLM)");
      console.log("  agent  <resource_path>        LLM-driven 402 flow");
      console.log("  health                        Check middleware status");
  }

  log.info("agent_full_finished");
}

main().catch((err) => {
  log.error("fatal", { msg: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
