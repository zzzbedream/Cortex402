"use strict";

const crypto = require("crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const cors = require("cors");

require("dotenv").config();

// ---------------------------------------------------------------------------
// Config & validation
// ---------------------------------------------------------------------------
const REQUIRED_ENV = ["MERCHANT_WALLET", "HORIZON_URL"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(JSON.stringify({ level: "fatal", msg: `Missing env: ${key}` }));
    process.exit(1);
  }
}

const PORT = parseInt(process.env.PORT, 10) || 3000;
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000;
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100;
const CACHE_TTL = (parseInt(process.env.CACHE_TTL_SECONDS, 10) || 300) * 1000;
const MERCHANT_WALLET = process.env.MERCHANT_WALLET;
const HORIZON_URL = process.env.HORIZON_URL;
const MAX_CACHE_ENTRIES = 10000;
const MEMO_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// Structured logger — never logs secrets or full IPs
// ---------------------------------------------------------------------------
function log(level, msg, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...meta
  };
  // Redact any field that looks like a key/secret
  for (const [k, v] of Object.entries(entry)) {
    if (typeof v === "string" && v.length > 12) {
      if (/secret|key|token|password|private/i.test(k)) {
        entry[k] = v.slice(0, 4) + "..." + v.slice(-4);
      }
    }
  }
  const out = level === "error" ? process.stderr : process.stdout;
  out.write(JSON.stringify(entry) + "\n");
}

function maskIP(ip) {
  if (!ip) return "unknown";
  // IPv4: show first two octets only
  const v4 = ip.replace(/^::ffff:/, "");
  const parts = v4.split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.x.x`;
  // IPv6: show first 4 groups
  return v4.split(":").slice(0, 4).join(":") + ":*";
}

// ---------------------------------------------------------------------------
// In-memory cache with TTL + size cap (LRU-style eviction)
// ---------------------------------------------------------------------------
class BoundedCache {
  constructor(maxEntries, ttlMs) {
    this.max = maxEntries;
    this.ttl = ttlMs;
    this.store = new Map();
  }

  set(key, value) {
    // Evict oldest if at capacity
    if (this.store.size >= this.max) {
      const oldest = this.store.keys().next().value;
      this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: Date.now() + this.ttl });
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expires) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  delete(key) {
    this.store.delete(key);
  }

  get size() {
    return this.store.size;
  }

  // Periodic sweep of expired entries
  sweep() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expires) this.store.delete(key);
    }
  }
}

const paymentCache = new BoundedCache(MAX_CACHE_ENTRIES, CACHE_TTL);
const memoStore = new BoundedCache(MAX_CACHE_ENTRIES, MEMO_EXPIRY_MS);

// Sweep expired entries every 60s
setInterval(() => {
  paymentCache.sweep();
  memoStore.sweep();
}, 60000).unref();

// ---------------------------------------------------------------------------
// Header sanitization
// ---------------------------------------------------------------------------
const HEADER_REGEX = /^[\x20-\x7E]{1,512}$/; // printable ASCII, max 512 chars

function sanitizeHeader(value) {
  if (typeof value !== "string") return null;
  if (!HEADER_REGEX.test(value)) return null;
  return value;
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();

// Security headers via helmet
app.use(helmet());

// CORS — restrict in production
app.use(cors({
  origin: process.env.NODE_ENV === "production"
    ? (process.env.CORS_ORIGIN || false)
    : true,
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Payment-Signature"]
}));

// Payload size limit — 1 MB
app.use(express.json({ limit: "1mb" }));

// Rate limiter per IP
const limiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
  keyGenerator: (req) => req.ip
});
app.use(limiter);

// Request logging (masked IP)
app.use((req, res, next) => {
  log("info", "request", {
    method: req.method,
    path: req.path,
    ip: maskIP(req.ip)
  });
  next();
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    cacheSize: paymentCache.size,
    memoStoreSize: memoStore.size
  });
});

// Generate a new memo_hash for a payment intent
app.post("/payment/intent", (req, res) => {
  const { amount, asset, destination } = req.body;

  if (!amount || !asset) {
    return res.status(400).json({ error: "amount and asset are required" });
  }

  const memoHash = crypto.randomBytes(32).toString("hex");

  memoStore.set(memoHash, {
    amount: String(amount),
    asset: String(asset).slice(0, 56),
    destination: destination ? String(destination).slice(0, 56) : MERCHANT_WALLET,
    createdAt: Date.now(),
    used: false
  });

  log("info", "intent_created", {
    memo: memoHash.slice(0, 8) + "...",
    amount,
    asset: String(asset).slice(0, 12)
  });

  res.status(201).json({
    memo_hash: memoHash,
    destination: destination || MERCHANT_WALLET,
    expires_in_seconds: MEMO_EXPIRY_MS / 1000,
    horizon_url: HORIZON_URL
  });
});

// Verify / confirm a payment by memo_hash
app.post("/payment/verify", async (req, res) => {
  const { memo_hash } = req.body;
  const paymentSig = sanitizeHeader(req.get("X-Payment-Signature"));

  if (!memo_hash || typeof memo_hash !== "string") {
    return res.status(400).json({ error: "memo_hash is required" });
  }

  // Only hex, exactly 64 chars
  if (!/^[a-f0-9]{64}$/.test(memo_hash)) {
    return res.status(400).json({ error: "Invalid memo_hash format" });
  }

  // Check replay: if memo was already used, reject
  const memoEntry = memoStore.get(memo_hash);
  if (!memoEntry) {
    return res.status(400).json({ error: "memo_hash unknown or expired" });
  }
  if (memoEntry.used) {
    log("warn", "replay_attempt", { memo: memo_hash.slice(0, 8) + "..." });
    return res.status(400).json({ error: "memo_hash already used (replay rejected)" });
  }

  // Check cache first
  const cached = paymentCache.get(memo_hash);
  if (cached) {
    return res.json(cached);
  }

  // Query Horizon for the payment
  try {
    const url = `${HORIZON_URL}/accounts/${memoEntry.destination}/payments?limit=20&order=desc`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      log("error", "horizon_error", { status: response.status });
      return res.status(502).json({ error: "Horizon API error" });
    }

    const data = await response.json();
    const records = data._embedded?.records || [];

    const match = records.find((r) => {
      if (r.type !== "payment") return false;
      if (r.amount !== memoEntry.amount) return false;
      return true;
    });

    if (match) {
      // Mark as used (anti-replay)
      memoEntry.used = true;
      memoStore.set(memo_hash, memoEntry);

      const result = {
        verified: true,
        amount: match.amount,
        asset: match.asset_code || "XLM",
        from: match.from?.slice(0, 8) + "...",
        tx: match.transaction_hash?.slice(0, 12) + "..."
      };
      paymentCache.set(memo_hash, result);

      log("info", "payment_verified", { memo: memo_hash.slice(0, 8) + "..." });
      return res.json(result);
    }

    res.json({ verified: false, message: "Payment not found yet" });
  } catch (err) {
    log("error", "verify_error", { msg: err.message });
    res.status(500).json({ error: "Verification failed" });
  }
});

// Reject unsanitized custom headers on any route
app.use((req, res, next) => {
  const sig = req.get("X-Payment-Signature");
  if (sig !== undefined && sanitizeHeader(sig) === null) {
    log("warn", "header_injection_blocked", { ip: maskIP(req.ip) });
    return res.status(400).json({ error: "Invalid header value" });
  }
  next();
});

// 404 fallback
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Global error handler
app.use((err, _req, res, _next) => {
  log("error", "unhandled", { msg: err.message });
  res.status(500).json({ error: "Internal server error" });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const server = app.listen(PORT, "127.0.0.1", () => {
  log("info", "started", { port: PORT, env: process.env.NODE_ENV });
});

// Graceful shutdown
function shutdown(signal) {
  log("info", "shutting_down", { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

module.exports = app;
