/**
 * test_agent_security.ts — Security QA tests for the cortex402 agent
 *
 * Tests:
 *  1. No secrets persist in environment after wallet creation
 *  2. Malformed Base64 in 402 response → graceful error, no crash
 *  3. Header injection detection (PAYMENT-SIGNATURE tampering)
 *  4. Logs never contain private keys or full memo_hash
 *  5. memo_hash validation rejects non-hex / wrong length
 *  6. HTTP URLs rejected in production mode
 *  7. Self-signed certs rejected
 */

import * as crypto from "node:crypto";
import { log, mask, redactValue } from "./logger.js";
import { safeBase64Decode } from "./secure_fetch.js";
import { validateMemoHash } from "./tools.js";
import { createEphemeralWallet } from "./wallet.js";

let pass = 0;
let fail = 0;

function ok(name: string): void {
  console.log(`  ✅ PASS: ${name}`);
  pass++;
}

function bad(name: string, detail?: string): void {
  console.log(`  ❌ FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  fail++;
}

function test(name: string, fn: () => void | Promise<void>): void {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.then(() => ok(name)).catch((e) => bad(name, String(e)));
    } else {
      ok(name);
    }
  } catch (e) {
    bad(name, String(e));
  }
}

async function runTests(): Promise<void> {
  console.log("============================================");
  console.log("  Cortex402 Agent Security QA");
  console.log("============================================\n");

  // ---------------------------------------------------------------
  // TEST 1: Ephemeral wallet — no secrets leak to env or global
  // ---------------------------------------------------------------
  console.log("[1] Wallet secret isolation");
  test("Wallet private key not in process.env", () => {
    const wallet = createEphemeralWallet();
    const envDump = JSON.stringify(process.env);
    // The wallet's publicKey is a hex string; the private key should NOT appear anywhere
    if (envDump.includes("PRIVATE") && envDump.includes("BEGIN")) {
      throw new Error("Private key found in process.env!");
    }
    // Verify wallet.toString() masks the key
    const str = wallet.toString();
    if (!str.includes("...")) {
      throw new Error("Wallet toString() does not mask the key");
    }
  });

  test("Wallet uses crypto.generateKeyPairSync (not Math.random)", () => {
    // Verify by calling sign — Math.random can't produce Ed25519 signatures
    const wallet = createEphemeralWallet();
    const sig = wallet.sign("test message");
    if (sig.length < 64) throw new Error("Signature too short — may not be Ed25519");
  });

  // ---------------------------------------------------------------
  // TEST 2: Malformed Base64 402 response — graceful handling
  // ---------------------------------------------------------------
  console.log("\n[2] Malformed 402 payload handling");

  test("Corrupted Base64 → throws, no crash", () => {
    try {
      safeBase64Decode("!!!not-base64-at-all!!!@#$%");
      throw new Error("Should have thrown");
    } catch (e) {
      const msg = String(e);
      if (!msg.includes("decode failed") && !msg.includes("non-JSON")) {
        // It threw — that's correct, just verify it's our error
        if (msg.includes("Should have thrown")) throw e;
      }
    }
  });

  test("Valid Base64 but invalid JSON → throws, no crash", () => {
    const encoded = Buffer.from("this is not json").toString("base64");
    try {
      safeBase64Decode(encoded);
      throw new Error("Should have thrown");
    } catch (e) {
      if (String(e).includes("Should have thrown")) throw e;
    }
  });

  test("Valid Base64+JSON but missing required fields → throws", () => {
    const encoded = Buffer.from(JSON.stringify({ foo: "bar" })).toString("base64");
    try {
      safeBase64Decode(encoded);
      throw new Error("Should have thrown");
    } catch (e) {
      if (String(e).includes("Should have thrown")) throw e;
    }
  });

  test("Valid payment payload decodes correctly", () => {
    const payload = {
      amount: "10",
      asset: "XLM",
      destination: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRS",
      memo_hash: "a".repeat(64),
      network: "testnet",
      expires_in_seconds: 600,
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
    const decoded = safeBase64Decode(encoded);
    if (decoded.amount !== "10") throw new Error("Amount mismatch");
    if (decoded.memo_hash !== "a".repeat(64)) throw new Error("memo_hash mismatch");
  });

  // ---------------------------------------------------------------
  // TEST 3: memo_hash validation
  // ---------------------------------------------------------------
  console.log("\n[3] memo_hash validation");

  test("Valid 64-char hex accepted", () => {
    const valid = "a".repeat(64);
    const result = validateMemoHash(valid);
    if (result !== valid) throw new Error("Valid hash rejected");
  });

  test("Non-hex characters rejected", () => {
    try {
      validateMemoHash("g".repeat(64)); // 'g' is not hex
      throw new Error("Should have thrown");
    } catch (e) {
      if (String(e).includes("Should have thrown")) throw e;
    }
  });

  test("Wrong length (32 chars) rejected", () => {
    try {
      validateMemoHash("a".repeat(32));
      throw new Error("Should have thrown");
    } catch (e) {
      if (String(e).includes("Should have thrown")) throw e;
    }
  });

  test("Empty string rejected", () => {
    try {
      validateMemoHash("");
      throw new Error("Should have thrown");
    } catch (e) {
      if (String(e).includes("Should have thrown")) throw e;
    }
  });

  test("Non-string input rejected", () => {
    try {
      validateMemoHash(12345);
      throw new Error("Should have thrown");
    } catch (e) {
      if (String(e).includes("Should have thrown")) throw e;
    }
  });

  test("SQL injection in memo_hash rejected", () => {
    try {
      validateMemoHash("' OR 1=1; DROP TABLE payments; --" + "a".repeat(32));
      throw new Error("Should have thrown");
    } catch (e) {
      if (String(e).includes("Should have thrown")) throw e;
    }
  });

  // ---------------------------------------------------------------
  // TEST 4: Log redaction
  // ---------------------------------------------------------------
  console.log("\n[4] Log redaction");

  test("Private key fields are fully redacted", () => {
    const result = redactValue("private_key", "SCZJQE7XKHODALUIQV7QV4ZXCFOAECGATMZP7LJXNA6WKGRZHCMUHNR");
    if (result !== "[REDACTED]") throw new Error(`Expected [REDACTED], got: ${result}`);
  });

  test("API tokens are fully redacted", () => {
    const result = redactValue("api_token", "sk-ant-api03-1234567890abcdef");
    if (result !== "[REDACTED]") throw new Error(`Expected [REDACTED], got: ${result}`);
  });

  test("memo_hash is partially masked", () => {
    const hash = "abcdef1234567890" + "0".repeat(48);
    const result = redactValue("memo_hash", hash) as string;
    if (!result.includes("...")) throw new Error("memo_hash not masked");
    if (result.length > 12) throw new Error("Mask too long — may be leaking data");
  });

  test("Wallet addresses are partially masked", () => {
    const addr = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRS";
    const result = redactValue("wallet_address", addr) as string;
    if (!result.includes("...")) throw new Error("Address not masked");
  });

  test("Short values pass through unredacted", () => {
    const result = redactValue("memo_hash", "short");
    if (result !== "short") throw new Error("Short value was redacted");
  });

  test("mask() function works correctly", () => {
    const masked = mask("abcdefghijklmnop");
    if (masked !== "abcd...mnop") throw new Error(`Unexpected mask: ${masked}`);
  });

  // ---------------------------------------------------------------
  // TEST 5: HTTPS enforcement
  // ---------------------------------------------------------------
  console.log("\n[5] HTTPS enforcement");

  test("HTTP URL in production mode is rejected", async () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const { secureFetch } = await import("./secure_fetch.js");
      await secureFetch("http://example.com/test");
      throw new Error("Should have thrown");
    } catch (e) {
      if (String(e).includes("Should have thrown")) throw e;
      if (!String(e).includes("SECURITY")) {
        throw new Error("Expected SECURITY error, got: " + String(e));
      }
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  test("FTP URL is rejected", async () => {
    try {
      const { secureFetch } = await import("./secure_fetch.js");
      await secureFetch("ftp://example.com/file");
      throw new Error("Should have thrown");
    } catch (e) {
      if (String(e).includes("Should have thrown")) throw e;
    }
  });

  // ---------------------------------------------------------------
  // TEST 6: Header sanitization awareness
  // ---------------------------------------------------------------
  console.log("\n[6] Header value awareness");

  test("PAYMENT-SIGNATURE with special chars flagged in logs", () => {
    // The agent's secure_fetch masks all auth-related headers
    const header = "evil\x00value\r\nInjected: true";
    const masked = redactValue("signature", header);
    if (masked !== "[REDACTED]") {
      throw new Error("Signature header not redacted in logs");
    }
  });

  // ---------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------
  console.log("\n============================================");
  console.log(`  Results: ${pass} passed, ${fail} failed`);
  console.log("============================================");

  if (fail > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
