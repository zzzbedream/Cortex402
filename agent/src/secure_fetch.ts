/**
 * Secure fetch wrapper with:
 *  - HTTPS enforcement (rejects http:// and self-signed certs)
 *  - 30s timeout with exponential backoff retries (max 3)
 *  - Safe Base64 decoding for 402 payloads
 *  - Zero disk persistence — all data stays in memory
 *  - Credential scrubbing in all log output
 */

import * as https from "node:https";
import { log, mask } from "./logger.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DEFAULT_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT_MS || "30000", 10);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || "3", 10);
const BASE_DELAY_MS = 1000;

// Strict TLS agent — rejects self-signed certificates
const tlsAgent = new https.Agent({
  rejectUnauthorized: true,   // MITM protection
  minVersion: "TLSv1.2",
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface SecureFetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export interface SecureResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  data: T;
  paymentPayload?: PaymentPayload;
}

export interface PaymentPayload {
  amount: string;
  asset: string;
  destination: string;
  memo_hash: string;
  network: string;
  expires_in_seconds: number;
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------
function assertHttps(url: string): void {
  const parsed = new URL(url);
  // Allow http only for localhost in development
  if (parsed.protocol === "http:") {
    const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (!isLocal || process.env.NODE_ENV === "production") {
      throw new Error(`SECURITY: Refusing non-HTTPS URL: ${parsed.origin}`);
    }
    log.warn("http_allowed_localhost", { host: parsed.hostname });
    return;
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`SECURITY: Unsupported protocol: ${parsed.protocol}`);
  }
}

// ---------------------------------------------------------------------------
// Safe Base64 decode
// ---------------------------------------------------------------------------
export function safeBase64Decode(encoded: string): PaymentPayload {
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf-8");
  } catch {
    throw new Error("Base64 decode failed — payload corrupted or not valid Base64");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error("Base64 decoded to non-JSON content");
  }

  // Validate expected shape
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.amount !== "string" && typeof obj.amount !== "number") {
    throw new Error("Invalid payment payload: missing or invalid 'amount'");
  }
  if (typeof obj.destination !== "string") {
    throw new Error("Invalid payment payload: missing 'destination'");
  }

  return {
    amount: String(obj.amount),
    asset: String(obj.asset || "XLM"),
    destination: String(obj.destination),
    memo_hash: String(obj.memo_hash || ""),
    network: String(obj.network || "testnet"),
    expires_in_seconds: Number(obj.expires_in_seconds || 600),
  };
}

// ---------------------------------------------------------------------------
// Core fetch with retries
// ---------------------------------------------------------------------------
export async function secureFetch<T = unknown>(
  url: string,
  opts: SecureFetchOptions = {}
): Promise<SecureResponse<T>> {
  assertHttps(url);

  const { method = "GET", headers = {}, body, timeoutMs = DEFAULT_TIMEOUT } = opts;

  // Never log authorization headers
  const safeHeaders = { ...headers };
  const logHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(safeHeaders)) {
    logHeaders[k] = /auth|token|key|secret|signature/i.test(k) ? mask(v) : v;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      log.info("retry_backoff", { attempt, delay_ms: delay, url: new URL(url).pathname });
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      log.debug("fetch_request", {
        method,
        url: new URL(url).pathname,
        attempt,
        headers: logHeaders,
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const fetchOpts: RequestInit = {
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...safeHeaders,
        },
        signal: controller.signal,
      };

      // Use the strict TLS agent for https URLs
      if (url.startsWith("https://")) {
        // @ts-expect-error — Node fetch supports dispatcher/agent via undici
        fetchOpts.dispatcher = tlsAgent;
      }

      if (body !== undefined) {
        fetchOpts.body = JSON.stringify(body);
      }

      const response = await fetch(url, fetchOpts);
      clearTimeout(timer);

      // Collect response headers
      const respHeaders: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        respHeaders[k] = v;
      });

      // Handle 402 Payment Required — decode the payment payload
      if (response.status === 402) {
        const raw = await response.text();
        log.info("402_received", { url: new URL(url).pathname });

        let paymentPayload: PaymentPayload;
        try {
          // Try Base64 first, then raw JSON
          paymentPayload = safeBase64Decode(raw);
        } catch {
          try {
            paymentPayload = JSON.parse(raw) as PaymentPayload;
          } catch {
            throw new Error("402 response contains neither valid Base64 nor JSON payload");
          }
        }

        log.info("payment_payload_decoded", {
          memo_hash: paymentPayload.memo_hash,
          amount: paymentPayload.amount,
          asset: paymentPayload.asset,
          destination_hash: paymentPayload.destination,
        });

        return {
          status: 402,
          headers: respHeaders,
          data: null as T,
          paymentPayload,
        };
      }

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = parseInt(respHeaders["retry-after"] || "5", 10);
        log.warn("rate_limited", { retry_after: retryAfter });
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, retryAfter * 1000));
          continue;
        }
      }

      // Success or client error — no retry
      const data = (await response.json().catch(() => null)) as T;

      log.info("fetch_response", {
        status: response.status,
        url: new URL(url).pathname,
      });

      return { status: response.status, headers: respHeaders, data };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't retry on security errors or client errors
      if (lastError.message.startsWith("SECURITY:")) throw lastError;
      if (lastError.name === "AbortError") {
        log.warn("request_timeout", { url: new URL(url).pathname, attempt });
      } else {
        log.warn("fetch_error", { msg: lastError.message, attempt });
      }
    }
  }

  throw new Error(`All ${MAX_RETRIES + 1} attempts failed: ${lastError?.message}`);
}
