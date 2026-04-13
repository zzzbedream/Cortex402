/**
 * initWallet.ts — Secure Stellar wallet initialization (Tranche 3)
 *
 * Atomic init sequence:
 *   1. Generate keypair via StellarSdk.Keypair.random() (CSPRNG entropy)
 *   2. Fund XLM via Friendbot (Testnet)
 *   3. Establish USDC trustline (changeTrust operation)
 *   4. Receive USDC sponsorship from master account
 *
 * Security:
 *  - Keypair exists ONLY in memory (never serialized to disk)
 *  - Master secret read from env, never logged
 *  - Atomic: if trustline fails → USDC send is skipped
 *  - Idempotent: detects existing account/trustline and skips
 */

import * as StellarSdk from "stellar-sdk";
import { log, mask } from "./logger.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const HORIZON_URL =
  process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.NETWORK_PASSPHRASE || StellarSdk.Networks.TESTNET;
const FRIENDBOT_URL = "https://friendbot.stellar.org";

// USDC Testnet issuer
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVXWR7SDVQDU5KPF5AMDNH2FUAQNQYJ3Q37LWRC";
const USDC_ASSET = new StellarSdk.Asset("USDC", USDC_ISSUER);
const USDC_SPONSOR_AMOUNT = "0.5";

// Timing
const FETCH_TIMEOUT_MS = 45_000;
const POLL_INTERVAL_MS = 2_000;
const POLL_MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 1_500;
const MAX_RETRIES = 2;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface StellarWallet {
  /** Stellar public key (G...) */
  readonly publicKey: string;
  /** Sign a Stellar transaction — private key captured in closure */
  signTransaction(tx: StellarSdk.Transaction): void;
  /** Masked public key for logs */
  toString(): string;
}

// ---------------------------------------------------------------------------
// Resilient fetch with timeout + retries
// ---------------------------------------------------------------------------
async function resilientFetch(
  url: string,
  init: RequestInit = {},
  retries = MAX_RETRIES
): Promise<Response> {
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
      log.info("wallet_fetch_retry", { attempt, delay_ms: delay });
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const resp = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      return resp;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      log.warn("wallet_fetch_error", { attempt, msg: lastErr.message });
    }
  }

  throw new Error(
    `Wallet fetch failed after ${retries + 1} attempts: ${lastErr?.message}`
  );
}

// ---------------------------------------------------------------------------
// Horizon helpers
// ---------------------------------------------------------------------------
function getServer(): StellarSdk.Horizon.Server {
  return new StellarSdk.Horizon.Server(HORIZON_URL);
}

/** Wait for a transaction hash to confirm on-ledger. */
async function waitForTransaction(txHash: string, label: string): Promise<void> {
  const server = getServer();
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    try {
      await server.transactions().transaction(txHash).call();
      log.info(`${label}_confirmed`, { tx_hash: txHash });
      return;
    } catch {
      log.debug(`${label}_polling`, { attempt: i + 1 });
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
  // If we get here, the transaction might still be pending but we've waited long enough
  log.warn(`${label}_confirmation_timeout`, { tx_hash: txHash });
}

// ---------------------------------------------------------------------------
// Step 1: Generate keypair
// ---------------------------------------------------------------------------
function generateKeypair(): { keypair: StellarSdk.Keypair; wallet: StellarWallet } {
  // StellarSdk.Keypair.random() uses crypto.randomBytes internally (CSPRNG)
  const keypair = StellarSdk.Keypair.random();

  log.info("keypair_generated", {
    publicKey_hash: keypair.publicKey(),
  });

  // The wallet captures the keypair in closure — secret() is never exposed
  const wallet: StellarWallet = Object.freeze({
    publicKey: keypair.publicKey(),

    signTransaction(tx: StellarSdk.Transaction): void {
      tx.sign(keypair);
    },

    toString(): string {
      return `StellarWallet(${mask(keypair.publicKey())})`;
    },
  });

  return { keypair, wallet };
}

// ---------------------------------------------------------------------------
// Step 2: Fund via Friendbot
// ---------------------------------------------------------------------------
async function fundWithFriendbot(publicKey: string): Promise<void> {
  log.info("friendbot_funding", { publicKey_hash: publicKey });

  const url = `${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`;
  const resp = await resilientFetch(url);

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    // Account already funded is OK (status 400 with "createAccountAlreadyExist")
    if (resp.status === 400 && body.includes("createAccountAlreadyExist")) {
      log.info("friendbot_account_exists", { publicKey_hash: publicKey });
      return;
    }
    throw new Error(`Friendbot failed (${resp.status}): ${body.slice(0, 200)}`);
  }

  const result = await resp.json();
  const txHash = result.hash || result.id || "unknown";
  log.info("friendbot_funded", { tx_hash: txHash, publicKey_hash: publicKey });

  await waitForTransaction(txHash, "friendbot");
}

// ---------------------------------------------------------------------------
// Step 3: Establish USDC trustline (idempotent)
// ---------------------------------------------------------------------------
async function establishTrustline(
  keypair: StellarSdk.Keypair
): Promise<void> {
  const server = getServer();
  const publicKey = keypair.publicKey();

  // Check if trustline already exists
  try {
    const account = await server.loadAccount(publicKey);
    const hasTrust = account.balances.some(
      (b: StellarSdk.Horizon.HorizonApi.BalanceLine) =>
        "asset_code" in b &&
        b.asset_code === "USDC" &&
        "asset_issuer" in b &&
        b.asset_issuer === USDC_ISSUER
    );

    if (hasTrust) {
      log.info("trustline_exists", {
        publicKey_hash: publicKey,
        asset: "USDC",
      });
      return;
    }
  } catch (err) {
    throw new Error(
      `Cannot load account ${mask(publicKey)}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Build changeTrust transaction
  log.info("trustline_creating", { publicKey_hash: publicKey, asset: "USDC" });

  const account = await server.loadAccount(publicKey);
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      StellarSdk.Operation.changeTrust({
        asset: USDC_ASSET,
      })
    )
    .setTimeout(30)
    .build();

  tx.sign(keypair);

  try {
    const result = await server.submitTransaction(tx);
    const txHash =
      typeof result === "object" && result !== null && "hash" in result
        ? String((result as { hash: string }).hash)
        : "unknown";

    log.info("trustline_submitted", { tx_hash: txHash });
    await waitForTransaction(txHash, "trustline");
  } catch (err) {
    const msg = extractStellarError(err);
    throw new Error(`Trustline creation failed: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Step 4: USDC sponsorship from master account
// ---------------------------------------------------------------------------
async function sponsorUSDC(agentPublicKey: string): Promise<void> {
  const masterSecret = process.env.MASTER_SECRET;
  if (!masterSecret) {
    log.warn("master_secret_missing", {
      msg: "MASTER_SECRET not set — skipping USDC sponsorship",
    });
    return;
  }

  // Never log the master secret — only use it in this scope
  let masterKeypair: StellarSdk.Keypair;
  try {
    masterKeypair = StellarSdk.Keypair.fromSecret(masterSecret);
  } catch {
    throw new Error("Invalid MASTER_SECRET — cannot decode Stellar seed");
  }

  const masterPublic = masterKeypair.publicKey();
  log.info("usdc_sponsorship_start", {
    master_address: masterPublic,
    agent_address: agentPublicKey,
    amount: USDC_SPONSOR_AMOUNT,
  });

  const server = getServer();
  const masterAccount = await server.loadAccount(masterPublic);

  const tx = new StellarSdk.TransactionBuilder(masterAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: agentPublicKey,
        asset: USDC_ASSET,
        amount: USDC_SPONSOR_AMOUNT,
      })
    )
    .setTimeout(30)
    .build();

  tx.sign(masterKeypair);

  try {
    const result = await server.submitTransaction(tx);
    const txHash =
      typeof result === "object" && result !== null && "hash" in result
        ? String((result as { hash: string }).hash)
        : "unknown";

    log.info("usdc_sponsored", {
      tx_hash: txHash,
      amount: USDC_SPONSOR_AMOUNT,
    });
    await waitForTransaction(txHash, "usdc_sponsor");
  } catch (err) {
    const msg = extractStellarError(err);
    throw new Error(`USDC sponsorship failed: ${msg}`);
  }

  // Clear the master keypair from this scope (GC will collect)
  // @ts-expect-error — intentional nullification for security
  masterKeypair = null;
}

// ---------------------------------------------------------------------------
// Error extraction for Stellar submit failures
// ---------------------------------------------------------------------------
function extractStellarError(err: unknown): string {
  if (err instanceof Error) {
    // Stellar SDK wraps errors with response data
    const extras = (err as Record<string, unknown>).response;
    if (extras && typeof extras === "object") {
      const data = (extras as Record<string, unknown>).data;
      if (data && typeof data === "object") {
        const resultCodes = (data as Record<string, unknown>).extras;
        if (resultCodes && typeof resultCodes === "object") {
          const codes = (resultCodes as Record<string, unknown>).result_codes;
          if (codes) {
            return JSON.stringify(codes);
          }
        }
      }
    }
    return err.message;
  }
  return String(err);
}

// ---------------------------------------------------------------------------
// Public API: atomic initialization
// ---------------------------------------------------------------------------

/**
 * Initialize an agent wallet with full Stellar setup.
 *
 * Atomic sequence:
 *   1. Keypair.random()
 *   2. Friendbot funding (XLM)
 *   3. USDC trustline (changeTrust) — MUST succeed before step 4
 *   4. USDC sponsorship from master (0.5 USDC)
 *
 * If step 3 fails, step 4 is NOT attempted.
 * All keypair material stays in memory — nothing written to disk.
 */
export async function initAgentWalletSecure(): Promise<StellarWallet> {
  log.info("wallet_init_start");

  // Step 1: Generate
  const { keypair, wallet } = generateKeypair();
  const publicKey = keypair.publicKey();

  // Step 2: Fund
  await fundWithFriendbot(publicKey);

  // Step 3: Trustline (MUST succeed before USDC send)
  await establishTrustline(keypair);

  // Step 4: Sponsor USDC (only if trustline succeeded)
  await sponsorUSDC(publicKey);

  log.info("wallet_init_complete", {
    publicKey_hash: publicKey,
    wallet: wallet.toString(),
  });

  return wallet;
}

/**
 * Initialize using an existing keypair (for re-runs).
 * Checks if account + trustline exist; creates only what's missing.
 */
export async function initExistingWallet(
  secret: string
): Promise<StellarWallet> {
  let keypair: StellarSdk.Keypair;
  try {
    keypair = StellarSdk.Keypair.fromSecret(secret);
  } catch {
    throw new Error("Invalid agent secret — cannot decode Stellar seed");
  }

  const publicKey = keypair.publicKey();
  log.info("wallet_reuse_start", { publicKey_hash: publicKey });

  const wallet: StellarWallet = Object.freeze({
    publicKey,
    signTransaction(tx: StellarSdk.Transaction): void {
      tx.sign(keypair);
    },
    toString(): string {
      return `StellarWallet(${mask(publicKey)})`;
    },
  });

  // Check if account exists, fund if not
  const server = getServer();
  try {
    await server.loadAccount(publicKey);
    log.info("wallet_reuse_account_exists", { publicKey_hash: publicKey });
  } catch {
    log.info("wallet_reuse_funding", { publicKey_hash: publicKey });
    await fundWithFriendbot(publicKey);
  }

  // Ensure trustline
  await establishTrustline(keypair);

  log.info("wallet_reuse_complete", { publicKey_hash: publicKey });
  return wallet;
}

export { USDC_ASSET, USDC_ISSUER, HORIZON_URL, NETWORK_PASSPHRASE };
