#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const crypto = require("crypto");
const dotenv = require("dotenv");
const StellarSdk = require("stellar-sdk");

const ROOT_DIR = process.cwd();
const DEFAULT_CONFIG_PATH = path.join(ROOT_DIR, "test_config.env");
const DEFAULT_REPORT_PATH = path.join(ROOT_DIR, "test_report.json");

if (fs.existsSync(path.join(ROOT_DIR, ".env"))) {
  dotenv.config({ path: path.join(ROOT_DIR, ".env") });
}
if (fs.existsSync(DEFAULT_CONFIG_PATH)) {
  dotenv.config({ path: DEFAULT_CONFIG_PATH, override: true });
}

const CONFIG = {
  URL_VPS: process.env.URL_VPS || process.env.MIDDLEWARE_URL || "",
  HORIZON_URL: process.env.HORIZON_URL || "https://horizon-testnet.stellar.org",
  NETWORK_PASSPHRASE:
    process.env.NETWORK_PASSPHRASE || StellarSdk.Networks.TESTNET,
  MASTER_SECRET: process.env.MASTER_SECRET || "",
  MERCHANT_WALLET: process.env.MERCHANT_WALLET || "",
  USDC_CODE: process.env.USDC_CODE || "USDC",
  USDC_ISSUER:
    process.env.USDC_ISSUER ||
    "GBBD47IF6LWK7P7MDEVXWR7SDVQDU5KPF5AMDNH2FUAQNQYJ3Q37LWRC",
  MIN_MASTER_USDC: parseFloat(process.env.MIN_MASTER_USDC || "2"),
  PAYMENT_AMOUNT: process.env.PAYMENT_AMOUNT || "0.15",
  PAYMENT_ASSET: (process.env.PAYMENT_ASSET || process.env.USDC_CODE || "USDC").toUpperCase(),
  HEALTH_PATH: process.env.HEALTH_PATH || "/health",
  COMPUTE_PATH: process.env.COMPUTE_PATH || "/api/compute",
  COMPUTE_METHOD: (process.env.COMPUTE_METHOD || "POST").toUpperCase(),
  COMPUTE_REQUEST_BODY: parseJsonEnv(process.env.COMPUTE_REQUEST_BODY, {
    task: "qa-e2e",
  }),
  INTENT_PATH: process.env.INTENT_PATH || "/payment/intent",
  VERIFY_PATH: process.env.VERIFY_PATH || "/payment/verify",
  ADMIN_RESET_PATH: process.env.ADMIN_RESET_PATH || "",
  REQUEST_TIMEOUT_MS: parseInt(process.env.REQUEST_TIMEOUT_MS || "10000", 10),
  MAX_REQ_PER_MIN: parseInt(process.env.MAX_REQ_PER_MIN || "90", 10),
  POLL_CONFIRM_MS: parseInt(process.env.POLL_CONFIRM_MS || "10000", 10),
  POLL_INTERVAL_MS: parseInt(process.env.POLL_INTERVAL_MS || "1000", 10),
  SIGN_RETRY_MAX: parseInt(process.env.SIGN_RETRY_MAX || "3", 10),
  EXPIRED_CHALLENGE_SECONDS: parseInt(
    process.env.EXPIRED_CHALLENGE_SECONDS || "2",
    10
  ),
  EXPIRED_CHALLENGE_WAIT_MS: parseInt(
    process.env.EXPIRED_CHALLENGE_WAIT_MS || "3000",
    10
  ),
  TUNNEL_INTERRUPT_CMD: process.env.TUNNEL_INTERRUPT_CMD || "",
  UNREACHABLE_TEST_URL:
    process.env.UNREACHABLE_TEST_URL || "https://nonexistent.invalid/health",
  REPORT_PATH: process.env.REPORT_PATH || DEFAULT_REPORT_PATH,
  RUN_ONLY: (process.env.RUN_ONLY || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean),
};

const server = new StellarSdk.Horizon.Server(CONFIG.HORIZON_URL);

function getUsdcAsset() {
  return new StellarSdk.Asset(CONFIG.USDC_CODE, CONFIG.USDC_ISSUER);
}

const report = {
  startedAt: new Date().toISOString(),
  target: CONFIG.URL_VPS,
  horizon: CONFIG.HORIZON_URL,
  tests: [],
  summary: {
    passed: 0,
    failed: 0,
    skipped: 0,
    durationMs: 0,
  },
};

const state = {
  requestTimestamps: [],
  agentKeypair: null,
  sinkKeypair: null,
  e2eDestination: "",
  test2: {
    memoHash: "",
    txHash: "",
    challenge: null,
  },
};

function shouldRun(testId) {
  if (!CONFIG.RUN_ONLY.length) return true;
  return CONFIG.RUN_ONLY.includes(String(testId || "").toLowerCase());
}

function paymentAssetIsUsdc() {
  return CONFIG.PAYMENT_ASSET.toUpperCase() === CONFIG.USDC_CODE.toUpperCase();
}

function selectedTestsNeedMasterSecret() {
  if (shouldRun("test1") || shouldRun("test4")) return true;
  if ((shouldRun("test2") || shouldRun("test6")) && paymentAssetIsUsdc()) return true;
  return false;
}

function parseJsonEnv(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function mask(value) {
  if (!value || typeof value !== "string") return "[none]";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function redactMeta(meta) {
  const out = {};
  for (const [k, v] of Object.entries(meta || {})) {
    if (
      /secret|private|seed|token|password|api[_-]?key/i.test(k) &&
      typeof v === "string"
    ) {
      out[k] = "[REDACTED]";
      continue;
    }
    if (/hash|wallet|address|memo|tx|key/i.test(k) && typeof v === "string") {
      out[k] = mask(v);
      continue;
    }
    out[k] = v;
  }
  return out;
}

function log(level, message, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...redactMeta(meta),
  };
  const stream = level === "error" ? process.stderr : process.stdout;
  stream.write(`${JSON.stringify(entry)}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function failNow(msg) {
  log("error", msg);
  writeReport();
  process.exit(1);
}

function normalizeBaseUrl(url) {
  if (!url) return "";
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function buildUrl(base, pth, query = {}) {
  const full = new URL(`${normalizeBaseUrl(base)}${pth}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") {
      full.searchParams.set(k, String(v));
    }
  }
  return full.toString();
}

async function throttleRequests() {
  const windowMs = 60000;
  const now = Date.now();
  state.requestTimestamps = state.requestTimestamps.filter((t) => now - t < windowMs);
  if (state.requestTimestamps.length < CONFIG.MAX_REQ_PER_MIN) return;

  const oldest = state.requestTimestamps[0];
  const waitMs = Math.max(0, windowMs - (now - oldest) + 25);
  log("warn", "rate_guard_wait", {
    waitMs,
    inWindow: state.requestTimestamps.length,
    limit: CONFIG.MAX_REQ_PER_MIN,
  });
  await sleep(waitMs);
}

async function httpRequest(url, options = {}) {
  await throttleRequests();
  state.requestTimestamps.push(Date.now());

  const {
    method = "GET",
    headers = {},
    body,
    timeoutMs = CONFIG.REQUEST_TIMEOUT_MS,
  } = options;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();

  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });

    const elapsedMs = Date.now() - started;
    const text = await response.text();
    const json = safeJsonParse(text);

    const respHeaders = {};
    response.headers.forEach((value, key) => {
      respHeaders[key.toLowerCase()] = value;
    });

    return {
      ok: response.ok,
      status: response.status,
      headers: respHeaders,
      text,
      json,
      elapsedMs,
      error: null,
    };
  } catch (err) {
    const elapsedMs = Date.now() - started;
    return {
      ok: false,
      status: 0,
      headers: {},
      text: "",
      json: null,
      elapsedMs,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  } finally {
    clearTimeout(timer);
  }
}

function safeJsonParse(raw) {
  if (!raw || typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function beginTest(id, name) {
  log("info", `test_start:${id}`, { name });
  return {
    id,
    name,
    startedAt: new Date().toISOString(),
    startedMs: Date.now(),
  };
}

function endTest(ctx, status, details = {}) {
  const endedMs = Date.now();
  const entry = {
    id: ctx.id,
    name: ctx.name,
    status,
    startedAt: ctx.startedAt,
    endedAt: new Date().toISOString(),
    durationMs: endedMs - ctx.startedMs,
    details,
  };
  report.tests.push(entry);
  if (status === "passed") report.summary.passed += 1;
  if (status === "failed") report.summary.failed += 1;
  if (status === "skipped") report.summary.skipped += 1;

  log(status === "failed" ? "error" : "info", `test_end:${ctx.id}`, {
    status,
    durationMs: entry.durationMs,
    ...details,
  });
}

function resultCodesFromError(err) {
  try {
    const data = err?.response?.data || err?.data;
    const codes = data?.extras?.result_codes;
    if (!codes) return null;
    return {
      transaction: String(codes.transaction || "unknown"),
      operations: Array.isArray(codes.operations) ? codes.operations.map(String) : [],
    };
  } catch {
    return null;
  }
}

function classifyStellarError(err) {
  const codes = resultCodesFromError(err);
  const opCodes = codes?.operations || [];
  const txCode = codes?.transaction || "unknown";

  if (opCodes.includes("op_no_trust")) {
    return { code: "OP_NO_TRUST", retryable: false, message: "op_no_trust" };
  }
  if (opCodes.includes("op_underfunded")) {
    return {
      code: "INSUFFICIENT_BALANCE",
      retryable: false,
      message: "op_underfunded",
    };
  }
  if (txCode === "tx_bad_seq") {
    return { code: "TX_BAD_SEQ", retryable: true, message: "tx_bad_seq" };
  }
  if (txCode === "tx_too_late") {
    return { code: "TX_EXPIRED", retryable: true, message: "tx_too_late" };
  }

  return {
    code: "TX_FAILED",
    retryable: false,
    message: err instanceof Error ? err.message : String(err),
  };
}

async function pollTransaction(txHash, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const tx = await server.transactions().transaction(txHash).call();
      if (tx && tx.successful) {
        return { confirmed: true, tx };
      }
      if (tx && tx.successful === false) {
        return { confirmed: false, tx };
      }
    } catch {
      // Not found yet.
    }
    await sleep(CONFIG.POLL_INTERVAL_MS);
  }
  return { confirmed: false, tx: null };
}

async function friendbotFund(pubkey) {
  const url = `https://friendbot.stellar.org?addr=${encodeURIComponent(pubkey)}`;
  const resp = await httpRequest(url, { method: "GET", timeoutMs: 15000 });
  if (resp.status === 200) return { ok: true, status: resp.status };

  if (resp.status === 400 && resp.text.includes("createAccountAlreadyExist")) {
    return { ok: true, status: resp.status, alreadyExists: true };
  }

  return { ok: false, status: resp.status, body: resp.text };
}

async function ensureTrustline(keypair) {
  const account = await server.loadAccount(keypair.publicKey());
  const exists = account.balances.some(
    (b) => b.asset_code === CONFIG.USDC_CODE && b.asset_issuer === CONFIG.USDC_ISSUER
  );
  if (exists) {
    return { created: false, txHash: "" };
  }

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: CONFIG.NETWORK_PASSPHRASE,
  })
    .addOperation(
      StellarSdk.Operation.changeTrust({
        asset: getUsdcAsset(),
      })
    )
    .setTimeout(30)
    .build();

  tx.sign(keypair);
  const submit = await server.submitTransaction(tx);
  return { created: true, txHash: submit.hash };
}

function memoHashFromHex(hexMemo) {
  return StellarSdk.Memo.hash(Buffer.from(hexMemo, "hex"));
}

async function submitPaymentTx({
  sourceKeypair,
  destination,
  amount,
  asset,
  memoHash,
}) {
  const account = await server.loadAccount(sourceKeypair.publicKey());
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: CONFIG.NETWORK_PASSPHRASE,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination,
        asset,
        amount,
      })
    )
    .addMemo(memoHashFromHex(memoHash))
    .setTimeout(30)
    .build();

  tx.sign(sourceKeypair);
  const submit = await server.submitTransaction(tx);
  return {
    txHash: submit.hash,
    ledger: submit.ledger,
  };
}

async function getUsdcBalance(pubkey) {
  const account = await server.loadAccount(pubkey);
  const line = account.balances.find(
    (b) => b.asset_code === CONFIG.USDC_CODE && b.asset_issuer === CONFIG.USDC_ISSUER
  );
  return line ? parseFloat(line.balance) : 0;
}

async function getMasterAccountAndBalance() {
  const kp = StellarSdk.Keypair.fromSecret(CONFIG.MASTER_SECRET);
  const account = await server.loadAccount(kp.publicKey());
  const line = account.balances.find(
    (b) => b.asset_code === CONFIG.USDC_CODE && b.asset_issuer === CONFIG.USDC_ISSUER
  );
  return {
    keypair: kp,
    publicKey: kp.publicKey(),
    usdcBalance: line ? parseFloat(line.balance) : 0,
  };
}

async function sponsorAgentUsdc(agentPublicKey, amount = "1") {
  if (!CONFIG.MASTER_SECRET) {
    throw new Error("MASTER_SECRET es requerida para sponsor USDC");
  }

  const master = StellarSdk.Keypair.fromSecret(CONFIG.MASTER_SECRET);
  return submitPaymentTx({
    sourceKeypair: master,
    destination: agentPublicKey,
    amount,
    asset: getUsdcAsset(),
    memoHash: crypto.randomBytes(32).toString("hex"),
  });
}

async function bootstrapAgentWalletForE2E() {
  if (state.agentKeypair) return state.agentKeypair;

  const agent = StellarSdk.Keypair.random();
  const funded = await friendbotFund(agent.publicKey());
  if (!funded.ok) {
    throw new Error(`No se pudo fondear wallet agente via Friendbot: ${funded.status}`);
  }

  if (paymentAssetIsUsdc()) {
    await ensureTrustline(agent);
    await sponsorAgentUsdc(agent.publicKey(), "0.6");
  } else {
    const destination = StellarSdk.Keypair.random();
    const destinationFunded = await friendbotFund(destination.publicKey());
    if (!destinationFunded.ok) {
      throw new Error(
        `No se pudo fondear wallet destino para E2E: ${destinationFunded.status}`
      );
    }
    state.e2eDestination = destination.publicKey();
  }

  state.agentKeypair = agent;
  return agent;
}

function isValidMemoHash(memo) {
  return typeof memo === "string" && /^[a-f0-9]{64}$/.test(memo);
}

function isValidStellarPublicKey(value) {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (!v.startsWith("G") || v.length !== 56) return false;
  try {
    StellarSdk.Keypair.fromPublicKey(v);
    return true;
  } catch {
    return false;
  }
}

function decodeChallengeCandidate(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return null;

  const json = safeJsonParse(raw);
  if (json) return json;

  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    const parsed = safeJsonParse(decoded);
    return parsed;
  } catch {
    return null;
  }
}

function normalizeChallenge(candidate) {
  if (!candidate || typeof candidate !== "object") return null;

  const obj = candidate;
  const nested = obj.payment || obj.challenge || obj.data || obj.payload || {};

  const memoHash =
    obj.memo_hash ||
    obj.memoHash ||
    nested.memo_hash ||
    nested.memoHash ||
    "";

  const destination =
    obj.destination ||
    nested.destination ||
    obj.merchant_wallet ||
    CONFIG.MERCHANT_WALLET ||
    "";

  const amount = String(
    obj.amount || nested.amount || CONFIG.PAYMENT_AMOUNT
  );

  const asset = String(obj.asset || nested.asset || CONFIG.PAYMENT_ASSET);

  const expiresAt =
    obj.expires_at ||
    nested.expires_at ||
    (() => {
      const expSecs = Number(
        obj.expires_in_seconds || nested.expires_in_seconds || 0
      );
      return expSecs > 0 ? new Date(Date.now() + expSecs * 1000).toISOString() : null;
    })();

  if (!isValidMemoHash(memoHash) || !isValidStellarPublicKey(destination)) return null;

  return {
    memo_hash: String(memoHash),
    destination: String(destination),
    amount,
    asset,
    expires_at: expiresAt,
  };
}

function extractChallengeFromHttpResponse(resp) {
  const candidates = [];
  if (resp.json) candidates.push(resp.json);
  if (resp.text) candidates.push(resp.text);

  for (const h of [
    "x-payment-challenge",
    "x-402-payment",
    "x-payment-payload",
    "payment-required",
  ]) {
    if (resp.headers[h]) candidates.push(resp.headers[h]);
  }

  for (const raw of candidates) {
    const decoded = decodeChallengeCandidate(raw);
    const normalized = normalizeChallenge(decoded);
    if (normalized) return normalized;
  }
  return null;
}

async function requestComputeChallenge(options = {}) {
  const base = CONFIG.URL_VPS;
  const shortExpiry = options.shortExpiry || false;
  const destinationOverride =
    options.destinationOverride && isValidStellarPublicKey(options.destinationOverride)
      ? options.destinationOverride
      : undefined;

  const body = {
    ...CONFIG.COMPUTE_REQUEST_BODY,
    ...(shortExpiry ? { test_expires_in_seconds: CONFIG.EXPIRED_CHALLENGE_SECONDS } : {}),
  };

  const url = buildUrl(base, CONFIG.COMPUTE_PATH, {
    expires_in_seconds: shortExpiry ? CONFIG.EXPIRED_CHALLENGE_SECONDS : undefined,
  });

  const resp = await httpRequest(url, {
    method: CONFIG.COMPUTE_METHOD,
    headers: shortExpiry ? { "X-Test-Expires-In": String(CONFIG.EXPIRED_CHALLENGE_SECONDS) } : {},
    body: CONFIG.COMPUTE_METHOD === "GET" ? undefined : body,
  });

  if (resp.status === 402) {
    const challenge = extractChallengeFromHttpResponse(resp);
    if (challenge) {
      return {
        ok: true,
        mode: "compute",
        status: resp.status,
        body: resp.json || resp.text,
        challenge,
      };
    }
  }

  // Fallback to payment intent for middleware variants without /api/compute
  // or without inline challenge payload.
  const intentUrl = buildUrl(base, CONFIG.INTENT_PATH, {
    expires_in_seconds: shortExpiry ? CONFIG.EXPIRED_CHALLENGE_SECONDS : undefined,
  });

  const intentResp = await httpRequest(intentUrl, {
    method: "POST",
    headers: shortExpiry
      ? { "X-Test-Expires-In": String(CONFIG.EXPIRED_CHALLENGE_SECONDS) }
      : {},
    body: {
      amount: CONFIG.PAYMENT_AMOUNT,
      asset: CONFIG.PAYMENT_ASSET,
      destination:
        destinationOverride ||
        (isValidStellarPublicKey(CONFIG.MERCHANT_WALLET)
          ? CONFIG.MERCHANT_WALLET
          : undefined),
      ...(shortExpiry ? { expires_in_seconds: CONFIG.EXPIRED_CHALLENGE_SECONDS } : {}),
    },
  });

  const intentChallenge = normalizeChallenge(intentResp.json || {});
  if (!intentChallenge) {
    return {
      ok: false,
      mode: "intent_fallback",
      status: intentResp.status,
      body: {
        computeStatus: resp.status,
        computeBody: resp.json || resp.text,
        intentStatus: intentResp.status,
        intentBody: intentResp.json || intentResp.text,
      },
      challenge: null,
    };
  }

  return {
    ok: true,
    mode: "intent_fallback",
    status: intentResp.status,
    body: {
      computeStatus: resp.status,
      computeBody: resp.json || resp.text,
      intentStatus: intentResp.status,
      intentBody: intentResp.json || intentResp.text,
    },
    challenge: intentChallenge,
  };
}

async function retryComputeWithProof(challenge, txHash) {
  const base = CONFIG.URL_VPS;
  const url = buildUrl(base, CONFIG.COMPUTE_PATH);

  const resp = await httpRequest(url, {
    method: CONFIG.COMPUTE_METHOD,
    headers: {
      "X-Payment-Tx-Hash": txHash,
      "X-Payment-Memo-Hash": challenge.memo_hash,
      "X-Payment-Signature": txHash.slice(0, 64),
    },
    body:
      CONFIG.COMPUTE_METHOD === "GET"
        ? undefined
        : {
            ...CONFIG.COMPUTE_REQUEST_BODY,
            payment: {
              tx_hash: txHash,
              memo_hash: challenge.memo_hash,
            },
          },
  });

  if (resp.status === 404) {
    // Fallback for middlewares that validate only via /payment/verify.
    const verifyUrl = buildUrl(base, CONFIG.VERIFY_PATH);
    const verifyResp = await httpRequest(verifyUrl, {
      method: "POST",
      body: { memo_hash: challenge.memo_hash },
    });
    return {
      ...verifyResp,
      usedFallbackVerify: true,
    };
  }

  return {
    ...resp,
    usedFallbackVerify: false,
  };
}

async function runPreparation() {
  const t = beginTest("prep", "Preparacion de entorno");

  if (!CONFIG.URL_VPS) {
    endTest(t, "failed", { reason: "URL_VPS es requerida" });
    return;
  }

  const requiresMaster = selectedTestsNeedMasterSecret();

  const healthUrl = buildUrl(CONFIG.URL_VPS, CONFIG.HEALTH_PATH);
  const health = await httpRequest(healthUrl, { method: "GET", timeoutMs: 8000 });
  if (health.status !== 200) {
    endTest(t, "failed", {
      reason: "VPS no responde health=200",
      status: health.status,
      error: health.error ? health.error.message : undefined,
    });
    return;
  }

  let masterInfo = null;
  if (requiresMaster) {
    if (!CONFIG.MASTER_SECRET) {
      endTest(t, "failed", { reason: "MASTER_SECRET es requerida para las pruebas seleccionadas" });
      return;
    }

    try {
      masterInfo = await getMasterAccountAndBalance();
    } catch (err) {
      endTest(t, "failed", {
        reason: "No fue posible cargar cuenta maestra en Horizon",
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    if (masterInfo.usdcBalance < CONFIG.MIN_MASTER_USDC) {
      endTest(t, "failed", {
        reason: "Fondos USDC insuficientes en cuenta maestra",
        usdcBalance: masterInfo.usdcBalance,
        minRequired: CONFIG.MIN_MASTER_USDC,
        masterPublicKey: masterInfo.publicKey,
      });
      return;
    }
  }

  let resetAttempt = "not_configured";
  if (CONFIG.ADMIN_RESET_PATH) {
    const resetUrl = buildUrl(CONFIG.URL_VPS, CONFIG.ADMIN_RESET_PATH);
    const resetResp = await httpRequest(resetUrl, { method: "POST", body: {} });
    resetAttempt = `${resetResp.status}`;
  }

  endTest(t, "passed", {
    healthStatus: health.status,
    masterCheckRequired: requiresMaster,
    masterPublicKey: masterInfo ? masterInfo.publicKey : "skipped",
    masterUsdcBalance: masterInfo ? masterInfo.usdcBalance : "skipped",
    adminReset: resetAttempt,
  });
}

async function runTest1TrustlineRequired() {
  const t = beginTest("test1", "Trustline obligatoria");

  try {
    const master = StellarSdk.Keypair.fromSecret(CONFIG.MASTER_SECRET);

    const agent = StellarSdk.Keypair.random();
    state.agentKeypair = agent;

    const funded = await friendbotFund(agent.publicKey());
    if (!funded.ok) {
      endTest(t, "failed", {
        step: "friendbot_fund",
        status: funded.status,
        body: funded.body,
      });
      return;
    }

    let noTrustCaptured = false;
    let firstErrorCode = "";
    const testMemo = crypto.randomBytes(32).toString("hex");

    try {
      await submitPaymentTx({
        sourceKeypair: master,
        destination: agent.publicKey(),
        amount: CONFIG.PAYMENT_AMOUNT,
        asset: getUsdcAsset(),
        memoHash: testMemo,
      });
    } catch (err) {
      const classified = classifyStellarError(err);
      firstErrorCode = classified.code;
      noTrustCaptured = classified.code === "OP_NO_TRUST";
    }

    if (!noTrustCaptured) {
      endTest(t, "failed", {
        step: "send_without_trustline",
        reason: "No se capturo op_no_trust",
        capturedCode: firstErrorCode || "none",
      });
      return;
    }

    const trust = await ensureTrustline(agent);
    if (trust.created && trust.txHash) {
      await pollTransaction(trust.txHash, CONFIG.POLL_CONFIRM_MS);
    }

    const secondMemo = crypto.randomBytes(32).toString("hex");
    const sent = await submitPaymentTx({
      sourceKeypair: master,
      destination: agent.publicKey(),
      amount: CONFIG.PAYMENT_AMOUNT,
      asset: getUsdcAsset(),
      memoHash: secondMemo,
    });

    const confirmed = await pollTransaction(sent.txHash, CONFIG.POLL_CONFIRM_MS);
    const agentUsdc = await getUsdcBalance(agent.publicKey());

    endTest(t, "passed", {
      firstAttemptCode: firstErrorCode,
      trustlineCreated: trust.created,
      secondTxHash: sent.txHash,
      secondTxConfirmed: Boolean(confirmed.confirmed),
      agentUsdcBalance: agentUsdc,
      agentWallet: agent.publicKey(),
    });
  } catch (err) {
    endTest(t, "failed", {
      reason: "Excepcion en test 1",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function runTest2RealE2E() {
  const t = beginTest("test2", "Pago real end-to-end");
  const startedMs = Date.now();

  try {
    const agentWallet = await bootstrapAgentWalletForE2E();

    const challengeResp = await requestComputeChallenge({
      shortExpiry: false,
      destinationOverride: state.e2eDestination || undefined,
    });
    if (!challengeResp.ok || !challengeResp.challenge) {
      endTest(t, "failed", {
        step: "get_402_challenge",
        status: challengeResp.status,
        mode: challengeResp.mode,
        body: challengeResp.body,
      });
      return;
    }

    const challenge = challengeResp.challenge;
    const amount = String(challenge.amount || CONFIG.PAYMENT_AMOUNT);
    const assetCode = String(challenge.asset || CONFIG.USDC_CODE).toUpperCase();
    const asset = assetCode === "XLM" ? StellarSdk.Asset.native() : getUsdcAsset();

    const sent = await submitPaymentTx({
      sourceKeypair: agentWallet,
      destination: challenge.destination,
      amount,
      asset,
      memoHash: challenge.memo_hash,
    });

    const chain = await pollTransaction(sent.txHash, 10000);
    const verification = await retryComputeWithProof(challenge, sent.txHash);

    const totalMs = Date.now() - startedMs;

    state.test2.memoHash = challenge.memo_hash;
    state.test2.txHash = sent.txHash;
    state.test2.challenge = challenge;

    if (verification.status !== 200) {
      endTest(t, "failed", {
        step: "retry_compute_with_payment",
        verificationStatus: verification.status,
        usedFallbackVerify: verification.usedFallbackVerify,
        txHash: sent.txHash,
        memoHash: challenge.memo_hash,
        totalMs,
        body: verification.json || verification.text,
      });
      return;
    }

    if (totalMs >= 25000) {
      endTest(t, "failed", {
        step: "latency_check",
        reason: "Tiempo total supera 25s",
        totalMs,
        txHash: sent.txHash,
      });
      return;
    }

    endTest(t, "passed", {
      challengeMode: challengeResp.mode,
      txHash: sent.txHash,
      memoHash: challenge.memo_hash,
      onChainConfirmed: Boolean(chain.confirmed),
      computeStatus: verification.status,
      totalMs,
    });
  } catch (err) {
    endTest(t, "failed", {
      reason: "Excepcion en test 2",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function runTest3ReplayAttack() {
  const t = beginTest("test3", "Replay attack");

  if (!state.test2.challenge || !state.test2.txHash) {
    endTest(t, "failed", { reason: "Test 2 no genero artefactos para replay" });
    return;
  }

  try {
    const replay = await retryComputeWithProof(state.test2.challenge, state.test2.txHash);
    const bodyText = JSON.stringify(replay.json || replay.text || "");
    const looksLikeReplay =
      /already redeemed|replay|already used|memo_hash already used/i.test(bodyText);

    if (replay.status === 400 && looksLikeReplay) {
      endTest(t, "passed", {
        status: replay.status,
        message: bodyText.slice(0, 200),
      });
      return;
    }

    endTest(t, "failed", {
      reason: "Replay no fue rechazado como se esperaba",
      status: replay.status,
      message: bodyText.slice(0, 300),
    });
  } catch (err) {
    endTest(t, "failed", {
      reason: "Excepcion en test 3",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function drainAgentUsdcToSink() {
  if (!state.agentKeypair) {
    return { ok: false, reason: "agent_missing" };
  }

  const sink = StellarSdk.Keypair.random();
  state.sinkKeypair = sink;

  const funded = await friendbotFund(sink.publicKey());
  if (!funded.ok) {
    return { ok: false, reason: "sink_friendbot_failed", details: funded };
  }

  await ensureTrustline(sink);

  const balance = await getUsdcBalance(state.agentKeypair.publicKey());
  if (balance <= 0) {
    return {
      ok: true,
      sink: sink.publicKey(),
      drainedAmount: "0",
      txHash: "",
      alreadyEmpty: true,
    };
  }

  const amount = balance.toFixed(7).replace(/\.0+$/, "");
  const tx = await submitPaymentTx({
    sourceKeypair: state.agentKeypair,
    destination: sink.publicKey(),
    amount,
    asset: getUsdcAsset(),
    memoHash: crypto.randomBytes(32).toString("hex"),
  });

  return {
    ok: true,
    sink: sink.publicKey(),
    drainedAmount: amount,
    txHash: tx.txHash,
    alreadyEmpty: false,
  };
}

async function attemptSignWithRetry(challenge, maxAttempts) {
  const results = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const assetCode = String(challenge.asset || CONFIG.USDC_CODE).toUpperCase();
      const asset = assetCode === "XLM" ? StellarSdk.Asset.native() : getUsdcAsset();
      const sent = await submitPaymentTx({
        sourceKeypair: state.agentKeypair,
        destination: challenge.destination,
        amount: String(challenge.amount || CONFIG.PAYMENT_AMOUNT),
        asset,
        memoHash: challenge.memo_hash,
      });

      results.push({ attempt, success: true, txHash: sent.txHash });
      return { ok: true, attempts: results, finalCode: "SUCCESS" };
    } catch (err) {
      const classified = classifyStellarError(err);
      results.push({
        attempt,
        success: false,
        code: classified.code,
        message: classified.message,
      });

      if (classified.code === "INSUFFICIENT_BALANCE") {
        return {
          ok: false,
          attempts: results,
          finalCode: "INSUFFICIENT_BALANCE",
        };
      }

      if (!classified.retryable || attempt >= maxAttempts) {
        return {
          ok: false,
          attempts: results,
          finalCode: classified.code,
        };
      }

      await sleep(300 * attempt);
    }
  }

  return { ok: false, attempts: results, finalCode: "MAX_RETRIES_REACHED" };
}

async function runTest4InsufficientFunds() {
  const t = beginTest("test4", "Fondos insuficientes");

  if (!state.agentKeypair) {
    endTest(t, "failed", { reason: "No hay wallet de agente disponible" });
    return;
  }

  try {
    const drained = await drainAgentUsdcToSink();
    if (!drained.ok) {
      endTest(t, "failed", {
        reason: "No se pudo drenar wallet del agente",
        details: drained,
      });
      return;
    }

    const challengeResp = await requestComputeChallenge({ shortExpiry: false });
    if (!challengeResp.ok || !challengeResp.challenge) {
      endTest(t, "failed", {
        reason: "No se pudo obtener challenge para flujo de fondos insuficientes",
        status: challengeResp.status,
        mode: challengeResp.mode,
      });
      return;
    }

    const retry = await attemptSignWithRetry(
      challengeResp.challenge,
      CONFIG.SIGN_RETRY_MAX
    );

    const anySuccess = retry.attempts.some((x) => x.success === true);
    const attemptsCount = retry.attempts.length;

    if (
      retry.finalCode === "INSUFFICIENT_BALANCE" &&
      !anySuccess &&
      attemptsCount <= CONFIG.SIGN_RETRY_MAX
    ) {
      endTest(t, "passed", {
        drainedAmount: drained.drainedAmount,
        sinkWallet: drained.sink,
        attempts: attemptsCount,
        finalCode: retry.finalCode,
      });
      return;
    }

    endTest(t, "failed", {
      reason: "No se capturo INSUFFICIENT_BALANCE de forma controlada",
      drainedAmount: drained.drainedAmount,
      attempts: retry.attempts,
      finalCode: retry.finalCode,
    });
  } catch (err) {
    endTest(t, "failed", {
      reason: "Excepcion en test 4",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function resilientHealthCheck(url, maxAttempts) {
  const attempts = [];

  for (let i = 1; i <= maxAttempts; i++) {
    const resp = await httpRequest(url, {
      method: "GET",
      timeoutMs: 2500,
    });

    const ok = resp.status === 200;
    attempts.push({
      attempt: i,
      status: resp.status,
      error: resp.error ? resp.error.message : "",
      elapsedMs: resp.elapsedMs,
    });

    if (ok) {
      return { ok: true, attempts };
    }

    if (i < maxAttempts) {
      const backoffMs = Math.pow(2, i - 1) * 1000;
      await sleep(backoffMs);
    }
  }

  return {
    ok: false,
    attempts,
    message: "VPS unreachable",
  };
}

function launchTunnelInterruptIfConfigured() {
  if (!CONFIG.TUNNEL_INTERRUPT_CMD) {
    return { launched: false, mode: "simulated" };
  }

  try {
    cp.spawn(CONFIG.TUNNEL_INTERRUPT_CMD, {
      shell: true,
      detached: true,
      stdio: "ignore",
    }).unref();
    return { launched: true, mode: "real" };
  } catch (err) {
    return {
      launched: false,
      mode: "real",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runTest5TimeoutResilience() {
  const t = beginTest("test5", "Timeout y resiliencia de red");

  try {
    const interrupt = launchTunnelInterruptIfConfigured();
    if (interrupt.mode === "real") {
      await sleep(350);
    }

    const targetUrl =
      interrupt.mode === "real"
        ? buildUrl(CONFIG.URL_VPS, CONFIG.HEALTH_PATH)
        : CONFIG.UNREACHABLE_TEST_URL;

    const res = await resilientHealthCheck(targetUrl, 3);

    if (!res.ok && res.message === "VPS unreachable") {
      endTest(t, "passed", {
        mode: interrupt.mode,
        targetUrl,
        attempts: res.attempts,
        log: "VPS unreachable",
      });
      return;
    }

    endTest(t, "failed", {
      reason: "No se activo la ruta de fallo controlado en resiliencia",
      mode: interrupt.mode,
      targetUrl,
      attempts: res.attempts,
      launchError: interrupt.error,
    });
  } catch (err) {
    endTest(t, "failed", {
      reason: "Excepcion no manejada en test 5",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function runTest6ExpiredMemo() {
  const t = beginTest("test6", "Validacion de memo_hash expirado");

  if (!state.agentKeypair) {
    endTest(t, "failed", { reason: "No hay wallet de agente disponible" });
    return;
  }

  try {
    const challengeResp = await requestComputeChallenge({ shortExpiry: true });
    if (!challengeResp.ok || !challengeResp.challenge) {
      endTest(t, "failed", {
        reason: "No se pudo obtener challenge de expiracion corta",
        status: challengeResp.status,
        mode: challengeResp.mode,
        body: challengeResp.body,
      });
      return;
    }

    const challenge = challengeResp.challenge;
    await sleep(CONFIG.EXPIRED_CHALLENGE_WAIT_MS);

    const assetCode = String(challenge.asset || CONFIG.USDC_CODE).toUpperCase();
    const asset = assetCode === "XLM" ? StellarSdk.Asset.native() : getUsdcAsset();

    const sent = await submitPaymentTx({
      sourceKeypair: state.agentKeypair,
      destination: challenge.destination,
      amount: String(challenge.amount || CONFIG.PAYMENT_AMOUNT),
      asset,
      memoHash: challenge.memo_hash,
    });

    const verify = await retryComputeWithProof(challenge, sent.txHash);

    if (verify.status === 400 || verify.status === 402) {
      endTest(t, "passed", {
        verifyStatus: verify.status,
        txHash: sent.txHash,
        memoHash: challenge.memo_hash,
      });
      return;
    }

    endTest(t, "failed", {
      reason: "Middleware acepto pago con memo expirado",
      verifyStatus: verify.status,
      body: verify.json || verify.text,
      txHash: sent.txHash,
    });
  } catch (err) {
    endTest(t, "failed", {
      reason: "Excepcion en test 6",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function writeReport() {
  report.summary.durationMs =
    Date.now() - new Date(report.startedAt).getTime();

  const out = JSON.stringify(report, null, 2);
  fs.writeFileSync(CONFIG.REPORT_PATH, out, "utf8");
}

async function main() {
  log("info", "qa_suite_start", {
    target: CONFIG.URL_VPS,
    horizon: CONFIG.HORIZON_URL,
    computePath: CONFIG.COMPUTE_PATH,
    verifyPath: CONFIG.VERIFY_PATH,
  });

  if (shouldRun("prep")) await runPreparation();
  if (shouldRun("test1")) await runTest1TrustlineRequired();
  if (shouldRun("test2")) await runTest2RealE2E();
  if (shouldRun("test3")) await runTest3ReplayAttack();
  if (shouldRun("test4")) await runTest4InsufficientFunds();
  if (shouldRun("test5")) await runTest5TimeoutResilience();
  if (shouldRun("test6")) await runTest6ExpiredMemo();

  writeReport();

  const failed = report.summary.failed;
  const passed = report.summary.passed;
  const skipped = report.summary.skipped;

  log("info", "qa_suite_end", {
    passed,
    failed,
    skipped,
    report: CONFIG.REPORT_PATH,
  });

  if (failed > 0) {
    console.error(`\nQA suite finished with failures. See: ${CONFIG.REPORT_PATH}`);
    process.exit(1);
  }

  console.log(`\nQA suite passed. Report: ${CONFIG.REPORT_PATH}`);
  process.exit(0);
}

main().catch((err) => {
  log("error", "qa_suite_fatal", {
    error: err instanceof Error ? err.message : String(err),
  });
  writeReport();
  process.exit(1);
});
