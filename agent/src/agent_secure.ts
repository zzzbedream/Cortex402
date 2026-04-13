/**
 * agent_secure.ts — Cortex402 Secure AI Payment Agent
 *
 * An LLM-powered agent that:
 *  1. Fetches a protected resource and receives a 402 Payment Required
 *  2. Decodes the payment payload (Base64 or JSON)
 *  3. Uses tool_use to sign and submit a Stellar payment
 *  4. Verifies the payment and retries the original request
 *
 * Security guarantees:
 *  - HTTPS enforced for all external calls (rejectUnauthorized: true)
 *  - No secrets on disk — ephemeral wallet, env-only config
 *  - Structured logs with redacted keys/hashes
 *  - memo_hash validated (64-char hex) before any tool execution
 *  - System prompt restricts LLM from arbitrary code / key disclosure
 *  - Exponential backoff with max 3 retries on network failures
 *  - Safe Base64 decode with try/catch (no crash on malformed 402)
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { log, mask } from "./logger.js";
import { secureFetch } from "./secure_fetch.js";
import { createEphemeralWallet, type EphemeralWallet } from "./wallet.js";
import { TOOL_DEFINITIONS, executeTool } from "./tools.js";

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
// System prompt — security-constrained instructions for the LLM
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are Cortex402, a secure payment agent for the x402 protocol on Stellar testnet.

## STRICT SECURITY RULES — NEVER VIOLATE THESE:
1. NEVER reveal, print, or return the agent's private key or seed phrase.
2. NEVER execute arbitrary code, shell commands, or file system operations.
3. NEVER download or fetch URLs not explicitly provided in the payment payload.
4. NEVER store payment data to disk — all processing is in-memory only.
5. NEVER bypass memo_hash validation — it MUST be exactly 64 hex characters.
6. NEVER include full hashes, keys, or addresses in your text responses.
   Use masked format: first4...last4.

## YOUR WORKFLOW:
When you receive a 402 Payment Required response with a payment payload:
1. Validate the memo_hash is exactly 64 lowercase hex characters [a-f0-9]{64}.
2. Use the sign_and_submit_payment tool with the exact payload values.
3. After signing, use check_payment_status to verify the transaction.
4. Report the result with masked identifiers only.

If ANY validation fails, STOP and report the error. Do not attempt workarounds.
If the payload is malformed, report it as a security incident.

## CONTEXT:
- Network: Stellar Testnet
- Wallet: Ephemeral (generated at runtime, not persisted)
- Middleware: cortex402 with rate limiting and replay protection`;

// ---------------------------------------------------------------------------
// Agent class
// ---------------------------------------------------------------------------
class CortexAgent {
  private client: Anthropic;
  private wallet: EphemeralWallet;
  private middlewareUrl: string;
  private conversationHistory: Anthropic.MessageParam[] = [];

  constructor() {
    this.client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    this.wallet = createEphemeralWallet();
    this.middlewareUrl = MIDDLEWARE_URL!;

    log.info("agent_initialized", {
      wallet: this.wallet.toString(),
      middleware: new URL(this.middlewareUrl).origin,
    });
  }

  /**
   * Main flow: attempt to access a protected resource,
   * handle 402 via LLM-driven tool calls.
   */
  async accessProtectedResource(resourcePath: string): Promise<void> {
    log.info("accessing_resource", { path: resourcePath });

    // Step 1: Fetch the protected resource
    const url = `${this.middlewareUrl}${resourcePath}`;
    let response;
    try {
      response = await secureFetch(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("resource_fetch_failed", { msg });
      return;
    }

    // Step 2: If not 402, handle normally
    if (response.status !== 402) {
      log.info("resource_response", { status: response.status });
      console.log("Response:", JSON.stringify(response.data, null, 2));
      return;
    }

    // Step 3: 402 received — delegate to LLM for payment orchestration
    if (!response.paymentPayload) {
      log.error("402_no_payload", { status: 402 });
      return;
    }

    const payload = response.paymentPayload;
    log.info("402_payment_required", {
      memo_hash: payload.memo_hash,
      amount: payload.amount,
      asset: payload.asset,
      destination_hash: payload.destination,
    });

    await this.handlePaymentFlow(payload);
  }

  /**
   * LLM agentic loop: send the payment payload context,
   * let the model call tools to sign/verify, iterate until done.
   */
  private async handlePaymentFlow(
    payload: {
      memo_hash: string;
      amount: string;
      asset: string;
      destination: string;
    }
  ): Promise<void> {
    const userMessage = [
      "I received a 402 Payment Required response. Here is the payment payload:",
      "",
      "```json",
      JSON.stringify(
        {
          memo_hash: mask(payload.memo_hash),
          amount: payload.amount,
          asset: payload.asset,
          destination: mask(payload.destination),
          // Include full values as structured data for the tool, not in chat text
        },
        null,
        2
      ),
      "```",
      "",
      "The full memo_hash for the tool call is: " + payload.memo_hash,
      "The full destination for the tool call is: " + payload.destination,
      "",
      "Please validate the memo_hash format, sign the payment, and verify it.",
    ].join("\n");

    this.conversationHistory.push({ role: "user", content: userMessage });

    // Agentic loop — max 10 iterations to prevent runaway
    for (let turn = 0; turn < 10; turn++) {
      log.info("llm_turn", { turn });

      const response = await this.client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: TOOL_DEFINITIONS as unknown as Anthropic.Tool[],
        messages: this.conversationHistory,
      });

      // Collect assistant response
      this.conversationHistory.push({ role: "assistant", content: response.content });

      // If model is done (no more tool calls), print final text and exit
      if (response.stop_reason === "end_turn") {
        for (const block of response.content) {
          if (block.type === "text") {
            console.log("\n[Agent]:", block.text);
          }
        }
        return;
      }

      // Process tool calls
      if (response.stop_reason === "tool_use") {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type !== "tool_use") continue;

          log.info("tool_call", {
            tool: block.name,
            id: block.id,
          });

          try {
            const result = await executeTool(
              block.name,
              block.input as Record<string, unknown>,
              this.wallet,
              this.middlewareUrl
            );

            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            log.error("tool_error", { tool: block.name, msg: errMsg });

            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify({ error: errMsg }),
              is_error: true,
            });
          }
        }

        this.conversationHistory.push({ role: "user", content: toolResults });
      }
    }

    log.warn("agent_loop_limit_reached", { max_turns: 10 });
  }

  /**
   * Direct payment intent creation + verification
   * (bypasses LLM for testing / scripted flows).
   */
  async createAndVerifyPayment(amount: string, asset: string): Promise<void> {
    log.info("direct_payment_flow", { amount, asset });

    // Step 1: Create payment intent
    const intentResp = await secureFetch<{
      memo_hash: string;
      destination: string;
      expires_in_seconds: number;
    }>(`${this.middlewareUrl}/payment/intent`, {
      method: "POST",
      body: { amount, asset },
    });

    if (intentResp.status !== 201) {
      log.error("intent_creation_failed", { status: intentResp.status });
      return;
    }

    const { memo_hash, destination } = intentResp.data;
    log.info("intent_created", { memo_hash, destination_hash: destination });

    // Step 2: Mock sign the payment
    const { mockSignAndSubmitPayment } = await import("./tools.js");
    const signResult = await mockSignAndSubmitPayment(this.wallet, {
      memo_hash,
      amount,
      asset,
      destination,
    });

    log.info("payment_mock_signed", {
      tx_hash: signResult.tx_hash,
      memo_hash: memo_hash,
    });

    // Step 3: Verify payment
    const verifyResp = await secureFetch<{ verified: boolean; message?: string }>(
      `${this.middlewareUrl}/payment/verify`,
      {
        method: "POST",
        body: { memo_hash },
      }
    );

    log.info("payment_verification_result", {
      status: verifyResp.status,
      verified: String(verifyResp.data?.verified ?? false),
    });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  log.info("agent_starting", { version: "1.0.0" });

  const agent = new CortexAgent();

  const mode = process.argv[2] || "direct";

  switch (mode) {
    case "direct":
      // Direct payment flow (no LLM, for testing)
      await agent.createAndVerifyPayment("10", "XLM");
      break;

    case "agent":
      // Full LLM-driven flow — access a protected resource
      await agent.accessProtectedResource(process.argv[3] || "/protected/resource");
      break;

    case "health":
      // Just check middleware health
      try {
        const resp = await secureFetch(`${MIDDLEWARE_URL}/health`);
        console.log("Middleware health:", JSON.stringify(resp.data, null, 2));
      } catch (err) {
        log.error("health_check_failed", {
          msg: err instanceof Error ? err.message : String(err),
        });
      }
      break;

    default:
      console.log("Usage: agent_secure [direct|agent|health] [resource_path]");
  }

  log.info("agent_finished");
}

main().catch((err) => {
  log.error("fatal", { msg: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
